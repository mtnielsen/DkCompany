/**
 * DKC-007 — validering ved runtimegrænsen.
 *
 * Runtimen er den sidste kode, der ser et manifest, en task og et PDP-svar før
 * en executor kan køre. Den må ikke antage at nogen af delene er velformede:
 * et ukendt eller tomt PDP-svar, en ugyldig environment eller et scope, der
 * peger uden for de ejede komponenter, skal afvises — ikke fortolkes.
 *
 * Validatorerne er rene funktioner, så de kan kaldes både af runtimen, af
 * CLI'en og af conformance-suiten.
 */
import { digestOf } from "./digest.mjs";
import { capabilityWithinOwned, isProtectedResource, normalizeResource, withinScope } from "./classification.mjs";
import { validateRoleManifest } from "../../agent-registry/src/roles.mjs";

export class RuntimeBoundaryError extends Error {
  constructor(message, violations = []) {
    super(message);
    this.name = "RuntimeBoundaryError";
    this.violations = violations;
  }
}

export const ENVIRONMENTS = ["dev", "staging", "prod"];
export const DATA_CATEGORIES = ["none", "operational", "pseudonymised", "personal", "special-category"];
export const EVIDENCE_LABELS = ["policy-allow", "tests-pass", "dry-run-clean", "rollback-tested", "restore-verified", "scan-clean"];
export const AUTONOMY_CLASSES = ["A0", "A1", "A2", "A3"];
export const DECISIONS = ["allow", "allow-with-approval", "deny"];
export const OBLIGATIONS = ["audit-event", "dual-control", "auto-rollback", "notify", "manual-review"];

const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;
const isHex = (v, len) => typeof v === "string" && new RegExp(`^[a-f0-9]{${len}}$`).test(v);

function collect(errors, path, condition, message) {
  if (!condition) errors.push({ path, message });
}

/** Validér et agent-manifest før nogen capability bruges. */
export function validateManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== "object") {
    return { ok: false, errors: [{ path: "/", message: "manifest mangler eller er ikke et objekt" }] };
  }
  collect(errors, "/apiVersion", manifest.apiVersion === "contracts.platform/v1alpha1", "ukendt apiVersion");
  collect(errors, "/kind", manifest.kind === "AgentManifest", "kind skal være AgentManifest");
  collect(errors, "/metadata/name", isNonEmptyString(manifest.metadata?.name), "metadata.name mangler");
  collect(errors, "/identity/spiffeId", /^spiffe:\/\//.test(manifest.identity?.spiffeId ?? ""), "identity.spiffeId skal være en SPIFFE-ID");
  collect(errors, "/identity/credentialMode", manifest.identity?.credentialMode === "just-in-time", "credentialMode skal være just-in-time");

  const owned = manifest.scope?.ownedComponents;
  collect(errors, "/scope/ownedComponents", Array.isArray(owned) && owned.length > 0 && owned.every(isNonEmptyString), "scope.ownedComponents skal være en ikke-tom liste");
  const envs = manifest.scope?.environments;
  collect(errors, "/scope/environments", Array.isArray(envs) && envs.length > 0 && envs.every((e) => ENVIRONMENTS.includes(e)), "scope.environments skal være en ikke-tom liste af dev/staging/prod");
  if (manifest.scope?.dataCategories !== undefined) {
    collect(errors, "/scope/dataCategories", Array.isArray(manifest.scope.dataCategories) && manifest.scope.dataCategories.every((d) => DATA_CATEGORIES.includes(d)), "scope.dataCategories har ukendte kategorier");
  }

  const caps = manifest.capabilities;
  if (!Array.isArray(caps) || caps.length === 0) {
    errors.push({ path: "/capabilities", message: "capabilities skal være en ikke-tom liste" });
  } else {
    for (const [i, cap] of caps.entries()) {
      collect(errors, `/capabilities/${i}/verb`, isNonEmptyString(cap?.verb), "capability.verb mangler");
      collect(errors, `/capabilities/${i}/target`, isNonEmptyString(cap?.target), "capability.target mangler");
      collect(errors, `/capabilities/${i}/autonomyClass`, AUTONOMY_CLASSES.includes(cap?.autonomyClass), "capability.autonomyClass skal være A0-A3 (A4 kan ikke deklareres)");
      if (cap?.requiredEvidence !== undefined) {
        collect(errors, `/capabilities/${i}/requiredEvidence`, Array.isArray(cap.requiredEvidence) && cap.requiredEvidence.every((e) => EVIDENCE_LABELS.includes(e)), "capability.requiredEvidence har ukendte bevislabels");
      }
    }
  }

  // DKC-055: præcis én uforanderlig rolle. Rollen begrænser hvilke verber der
  // overhovedet må deklareres, og en godkenderrolle for en AI afvises.
  for (const e of validateRoleManifest(manifest).errors) errors.push(e);

  return { ok: errors.length === 0, errors };
}

/** Validér taskens form (ikke scope; scope afgøres pr. handling efter A4). */
export function validateTaskShape(task) {
  const errors = [];
  if (!task || typeof task !== "object") {
    return { ok: false, errors: [{ path: "/", message: "task mangler eller er ikke et objekt" }] };
  }
  collect(errors, "/apiVersion", task.apiVersion === "contracts.platform/v1alpha1", "ukendt apiVersion");
  collect(errors, "/kind", task.kind === "AgentTask", "kind skal være AgentTask");
  collect(errors, "/taskId", isNonEmptyString(task.taskId), "taskId mangler");
  collect(errors, "/tenantId", isNonEmptyString(task.tenantId), "tenantId mangler");
  collect(errors, "/agentRef", isNonEmptyString(task.agentRef), "agentRef mangler");
  collect(errors, "/objective", isNonEmptyString(task.objective), "objective mangler");

  if (task.evidenceIndex !== undefined) {
    if (!task.evidenceIndex || typeof task.evidenceIndex !== "object" || Array.isArray(task.evidenceIndex)) {
      errors.push({ path: "/evidenceIndex", message: "evidenceIndex skal være et objekt" });
    } else {
      for (const [label, entry] of Object.entries(task.evidenceIndex)) {
        if (!EVIDENCE_LABELS.includes(label)) errors.push({ path: `/evidenceIndex/${label}`, message: `ukendt bevislabel '${label}'` });
        const e = entry ?? {};
        collect(errors, `/evidenceIndex/${label}/uri`, isNonEmptyString(e.uri), "bevis-reference mangler uri");
        collect(errors, `/evidenceIndex/${label}/sha256`, isHex(e.sha256, 64), "bevis-reference mangler en sha256 på 64 hex");
        if (e.commit !== undefined) collect(errors, `/evidenceIndex/${label}/commit`, isHex(e.commit, 40), "commit skal være 40 hex");
        if (e.status !== undefined) collect(errors, `/evidenceIndex/${label}/status`, ["pass", "fail", "clean", "findings", "not-run", "partial"].includes(e.status), "ukendt bevisstatus");
      }
    }
  }

  const actions = task.actions;
  if (!Array.isArray(actions) || actions.length === 0) {
    errors.push({ path: "/actions", message: "actions skal være en ikke-tom liste" });
    return { ok: errors.length === 0, errors };
  }
  for (const [i, action] of actions.entries()) {
    collect(errors, `/actions/${i}/verb`, isNonEmptyString(action?.verb), "action.verb mangler");
    collect(errors, `/actions/${i}/target`, isNonEmptyString(action?.target), "action.target mangler");
    collect(errors, `/actions/${i}/environment`, ENVIRONMENTS.includes(action?.environment), "action.environment skal være dev/staging/prod");
    if (action?.tool !== undefined) {
      collect(errors, `/actions/${i}/tool`, isNonEmptyString(action.tool), "action.tool skal være en ikke-tom streng");
    }
    if (action?.untrustedContext !== undefined) {
      collect(errors, `/actions/${i}/untrustedContext`, action.untrustedContext !== null && typeof action.untrustedContext === "object", "action.untrustedContext skal være en ubetroet konvolut eller en liste af dem");
    }
    if (action?.evidence !== undefined) {
      collect(errors, `/actions/${i}/evidence`, Array.isArray(action.evidence) && action.evidence.every((e) => EVIDENCE_LABELS.includes(e)), "action.evidence har ukendte bevislabels");
    }
    if (action?.dataCategories !== undefined) {
      collect(errors, `/actions/${i}/dataCategories`, Array.isArray(action.dataCategories) && action.dataCategories.every((d) => DATA_CATEGORIES.includes(d)), "action.dataCategories har ukendte kategorier");
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Validér én handling mod manifestets scope. Kaldes efter A4-kontrollen, så et
 * A4-brud altid rapporteres som A4 og ikke som et scope-problem.
 */
export function validateActionBoundary(action, { manifest } = {}) {
  const errors = [];
  const capability = (manifest?.capabilities ?? []).find((c) => c.verb === action?.verb);
  if (!capability) {
    errors.push({ path: "/verb", message: `verbet '${action?.verb}' er ikke deklareret i manifestet` });
    return { ok: false, errors, capability: null, target: normalizeResource(action?.target) };
  }

  const environments = manifest?.scope?.environments ?? [];
  if (!environments.includes(action.environment)) {
    errors.push({ path: "/environment", message: `miljøet '${action.environment}' er ikke i manifestets scope [${environments.join(", ")}]` });
  }

  const owned = manifest?.scope?.ownedComponents ?? [];
  if (!capabilityWithinOwned(capability.target, owned)) {
    errors.push({ path: "/capabilities/target", message: `capability-scope '${capability.target}' ligger uden for ownedComponents [${owned.join(", ")}]` });
  }
  if (!withinScope(action.target, capability.target)) {
    errors.push({ path: "/target", message: `target '${action.target}' ligger uden for capability-scope '${capability.target}' (scope er ensrettet)` });
  }
  if (!owned.some((c) => withinScope(action.target, c))) {
    errors.push({ path: "/target", message: `target '${action.target}' ligger uden for ownedComponents [${owned.join(", ")}]` });
  }

  const allowed = manifest?.scope?.dataCategories;
  if (Array.isArray(allowed)) {
    for (const category of action.dataCategories ?? []) {
      if (!allowed.includes(category)) errors.push({ path: "/dataCategories", message: `datakategori '${category}' er ikke i manifestets scope [${allowed.join(", ")}]` });
    }
  }

  return { ok: errors.length === 0, errors, capability, target: normalizeResource(action.target) };
}

/**
 * Validér et PDP-svar. Et ukendt, tomt eller mangelfuldt svar er ikke en
 * tilladelse — det er en grænsefejl og skal stoppe handlingen. Svaret bindes
 * desuden til det input, runtimen faktisk sendte (inputSha256).
 */
export function validatePolicyDecision(decision, { input } = {}) {
  const errors = [];
  if (!decision || typeof decision !== "object") {
    return { ok: false, errors: [{ path: "/", message: "PDP-svaret er tomt eller ikke et objekt" }] };
  }
  if (!DECISIONS.includes(decision.decision)) {
    errors.push({ path: "/decision", message: `ukendt eller manglende beslutning '${decision.decision ?? ""}' (kun allow, allow-with-approval, deny)` });
  }

  const pdp = decision.pdp ?? {};
  collect(errors, "/pdp/name", isNonEmptyString(pdp.name), "pdp.name mangler");
  collect(errors, "/pdp/version", isNonEmptyString(pdp.version), "pdp.version mangler");
  collect(errors, "/pdp/bundleVersion", isNonEmptyString(pdp.bundleVersion), "pdp.bundleVersion mangler");
  collect(errors, "/matchedRules", Array.isArray(decision.matchedRules), "matchedRules skal være en liste");
  collect(errors, "/inputSha256", isHex(decision.inputSha256, 64), "inputSha256 mangler eller er ikke 64 hex");

  if (input !== undefined) {
    const expected = digestOf(input);
    if (isHex(decision.inputSha256, 64) && decision.inputSha256 !== expected) {
      errors.push({ path: "/inputSha256", message: "PDP-svaret gælder et andet input end det, runtimen sendte (binding brudt)" });
    }
  }

  if (decision.decision === "allow-with-approval") {
    collect(errors, "/requiredApprovals", Number.isInteger(decision.requiredApprovals) && decision.requiredApprovals >= 1, "allow-with-approval kræver requiredApprovals >= 1");
  }
  if (decision.decision === "deny") {
    collect(errors, "/reasons", Array.isArray(decision.reasons) && decision.reasons.length > 0, "deny kræver mindst én begrundelse");
  }
  if (decision.requiredEvidence !== undefined) {
    collect(errors, "/requiredEvidence", Array.isArray(decision.requiredEvidence) && decision.requiredEvidence.every((e) => EVIDENCE_LABELS.includes(e)), "requiredEvidence har ukendte bevislabels");
  }
  if (decision.obligations !== undefined) {
    collect(errors, "/obligations", Array.isArray(decision.obligations) && decision.obligations.every((o) => OBLIGATIONS.includes(o?.type)), "obligations har ukendte typer");
  }
  return { ok: errors.length === 0, errors };
}

/** Er målet A4-beskyttet? Eksporteret så runtimen kan bruge samme regel. */
export { isProtectedResource };
