/**
 * DKC-048 — håndhævelse af immutable data uden for agentens kontrol.
 *
 * Modulet forbinder DKC-047's rene guard med den **faktiske** lager- og
 * nøglehåndævelse: object-lock i `storage/src/object-store.mjs` og den
 * beskyttede KMS-nøglebutik. Det håndhæver:
 *
 *   - en rolle-/rettighedsmatrix hvor AI-agenter og app-konti er nægtet alle
 *     muterende operationer (skriv, slet, forkort retention, skift pointer,
 *     slet nøgle, livscyklus, serviceaccount, trust-config) og alle indirekte
 *     adminveje,
 *   - append-only audit-ingest adskilt fra administration,
 *   - GOVERNANCE-bypass kræver et navngivet menneske og to-personers godkendelse;
 *     COMPLIANCE kan aldrig omgås — heller ikke med en menneskelig godkendelse,
 *   - retention kan kun forlænges, aldrig forkortes,
 *   - en ny objektversion skjuler ikke den autoritative låste version,
 *   - beskyttelsespolitik og recovery-adgang kræver to-personers kontrol.
 *
 * Beslutningerne er deterministiske og efterprøves mod et rigtigt filsystem.
 * En **målt** verifikation på et levende S3-/objektlager er
 * `integration-immutable-live` og er NOT RUN.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createProtectedKeyStore } from "./key-protection.mjs";
import { evaluateProtectedData } from "./guard.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const defaultImmutablePolicyPath = join(here, "..", "enforcement", "immutable-policy.json");

export const MUTATING_OPERATIONS = [
  "append",
  "write",
  "update",
  "delete",
  "retention-extend",
  "retention-shorten",
  "pointer-switch",
  "key-rotate",
  "key-delete",
  "lifecycle-change",
  "serviceaccount-write",
  "trust-config-write",
  "protection-policy",
  "recovery-access",
];

export class ImmutableEnforcementError extends Error {
  constructor(message, reasons = [], code = "immutable_forbidden") {
    super(message);
    this.name = "ImmutableEnforcementError";
    this.reasons = reasons;
    this.code = code;
  }
}

export function loadImmutablePolicy(path = defaultImmutablePolicyPath) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function has(list, value) {
  return (list ?? []).includes(value);
}

/* -------------------------------------------------------------------------- */
/* Semantik                                                                   */
/* -------------------------------------------------------------------------- */

export function immutablePolicyProblems(policy) {
  const problems = [];
  if (!policy || typeof policy !== "object") return [{ path: "/", message: "politikken er ikke et objekt" }];
  const err = (path, message) => problems.push({ path, message });

  const product = policy.storageProduct ?? {};
  if (product.objectLock !== true) err("/storageProduct/objectLock", "storage-produktet skal håndhæve object-lock");
  if (product.versioning !== true) err("/storageProduct/versioning", "storage-produktet skal understøtte versioner");
  if (!(product.lockModes ?? []).includes("COMPLIANCE")) err("/storageProduct/lockModes", "COMPLIANCE-lock skal være tilgængelig");
  const verification = product.verification ?? {};
  if (verification.governanceBypassRequiresHuman !== true) err("/storageProduct/verification/governanceBypassRequiresHuman", "governance-bypass skal kræve et menneske");
  if (verification.complianceNonBypassable !== true) err("/storageProduct/verification/complianceNonBypassable", "COMPLIANCE må ikke kunne omgås");
  if (!(verification.evidenceRef ?? "").trim()) err("/storageProduct/verification/evidenceRef", "verifikationen skal have et evidensreference");

  const roles = policy.roles ?? [];
  const byId = new Map(roles.map((r) => [r.id, r]));
  if (roles.length < 3) err("/roles", "der kræves mindst tre adskilte roller");
  const aiRole = roles.find((r) => r.ai === true);
  if (!aiRole) err("/roles", "der skal være en AI-rolle at nægte");
  for (const op of ["write", "delete", "retention-shorten", "pointer-switch", "key-delete"]) {
    if (!has(aiRole?.forbiddenOperations, op)) err(`/roles/${aiRole?.id ?? "?"}/forbiddenOperations`, `AI-rollen skal forbyde '${op}'`);
  }

  const denials = policy.agentDenials ?? {};
  for (const op of ["write", "delete", "retention-shorten", "pointer-switch", "key-delete"]) {
    if (!has(denials.forbiddenOperations, op)) err("/agentDenials/forbiddenOperations", `agentnægtelsen mangler '${op}'`);
  }
  if ((denials.indirectAdminPaths ?? []).length < 3) err("/agentDenials/indirectAdminPaths", "indirekte adminveje skal være nægtet eksplicit");
  for (const kind of ["kms-key", "backup", "service-account", "trust-config"]) {
    if (!has(denials.protectedResourceKinds, kind)) err("/agentDenials/protectedResourceKinds", `agenten skal beskyttes mod '${kind}'`);
  }

  const ingest = policy.auditIngest ?? {};
  const ingestRole = byId.get(ingest.role);
  if (ingest.mode !== "append-only") err("/auditIngest/mode", "audit-ingest skal være append-only");
  if (ingest.cannotDelete !== true) err("/auditIngest/cannotDelete", "audit-ingest må ikke kunne slette");
  if (ingest.cannotUpdate !== true) err("/auditIngest/cannotUpdate", "audit-ingest må ikke kunne opdatere");
  if (ingest.separateFromAdmin !== true) err("/auditIngest/separateFromAdmin", "audit-ingest skal være adskilt fra administration");
  if (!ingestRole) err("/auditIngest/role", `audit-ingest-rollen '${ingest.role}' findes ikke`);
  else {
    if (ingestRole.kind !== "append-only") err(`/roles/${ingestRole.id}/kind`, "audit-ingest-rollen skal være append-only");
    if (has(ingestRole.allowedOperations, "delete") || has(ingestRole.allowedOperations, "update")) err(`/roles/${ingestRole.id}/allowedOperations`, "audit-ingest må ikke tillade delete/update");
  }

  for (const resource of policy.protectedResources ?? []) {
    if (resource.deletionProtected !== true) err(`/protectedResources/${resource.id}/deletionProtected`, "den beskyttede ressource skal være sletningsbeskyttet");
  }

  const tpc = policy.twoPersonControl ?? {};
  for (const key of ["protectionPolicy", "recoveryAccess", "governanceBypass"]) {
    if (tpc[key]?.required !== true) err(`/twoPersonControl/${key}/required`, `to-personers kontrol for '${key}' skal være påkrævet`);
    if (tpc[key]?.requesterMayNotApprove !== true) err(`/twoPersonControl/${key}/requesterMayNotApprove`, `anmoderen må ikke godkende '${key}' selv`);
  }

  const tests = policy.storageSemantics?.negativeTests ?? [];
  for (const op of ["delete", "retention-shorten", "pointer-switch", "key-delete"]) {
    if (!tests.some((t) => t.operation === op && t.expectation === "denied")) err("/storageSemantics/negativeTests", `der mangler en negativ test for '${op}'`);
  }
  if (!tests.some((t) => t.expectation === "preserved")) err("/storageSemantics/negativeTests", "der mangler en bevar-test for en ny version");

  return problems;
}

/* -------------------------------------------------------------------------- */
/* Roller og to-personers kontrol                                            */
/* -------------------------------------------------------------------------- */

export function resolveRole(policy, principal) {
  const roles = policy.roles ?? [];
  const explicit = principal?.role ?? principal?.roleId ?? null;
  if (explicit) return roles.find((r) => r.id === explicit) ?? null;
  const named = (principal?.roles ?? []).map((id) => roles.find((r) => r.id === id)).filter(Boolean);
  if (named.length) return named[0];
  if (principal?.kind === "agent" || principal?.ai === true) return roles.find((r) => r.kind === "agent" || r.ai === true) ?? null;
  return null;
}

export function authorizeTwoPerson({ policy, operation, principal, approval = null, control = null } = {}) {
  const key = control ?? (operation === "recovery-access" ? "recoveryAccess" : operation === "protection-policy" ? "protectionPolicy" : "governanceBypass");
  const rule = policy.twoPersonControl?.[key];
  if (!rule?.required) return { allowed: false, reasons: [`to-personers kontrol er ikke krævet for '${key}'`] };
  if (!approval?.approvedBy || !approval?.approvedAt) return { allowed: false, reasons: ["der mangler en navngivet godkender og tidspunkt"] };
  const requester = principal?.id ?? principal?.subject ?? null;
  if (String(approval.approvedBy) === String(requester)) return { allowed: false, reasons: ["godkenderen må ikke være den samme som anmoderen"] };
  if (rule.requesterMayNotApprove === true && !approval.approvedBy) return { allowed: false, reasons: ["anmoderen må ikke godkende"] };
  return { allowed: true, reasons: [] };
}

/* -------------------------------------------------------------------------- */
/* Håndhæver                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * @param {object} options
 * @param {object} options.policy     ImmutableEnforcement-politikken.
 * @param {Array}  [options.register] Beskyttelsesregisterets poster (til nøgler).
 * @param {object} [options.store]    `createStorageCluster(...)`.
 * @param {object} [options.keyStore] `createProtectedKeyStore(...)`.
 * @param {Function} [options.clock]
 */
export function createImmutableEnforcer({ policy, register = [], store = null, keyStore = null, clock = () => Date.now() } = {}) {
  if (!policy) throw new ImmutableEnforcementError("createImmutableEnforcer kræver en politik", ["politikken mangler"]);
  const keys = keyStore ?? createProtectedKeyStore({ policy, register, clock });
  const resourceById = new Map((policy.protectedResources ?? []).map((r) => [r.id, r]));
  const audit = [];

  function record(entry) {
    audit.push({ ...entry, at: new Date(clock()).toISOString() });
  }

  /**
   * Den rene beslutning. Default-deny: en operation skal være eksplicit tilladt
   * for principalens rolle, og AI/agent-rollen nægtes desuden eksplicit.
   */
  function evaluate({ principal, operation, record: protectedRecord = null, resource = null, approval = null } = {}) {
    const role = resolveRole(policy, principal);
    if (!role) return { allowed: false, reasons: [`principalen har ingen kendt rolle`], role: null };
    const op = String(operation ?? "").toLowerCase();
    const reasons = [];
    const obligations = [];

    // COMPLIANCE og retention kan ikke omgås af nogen rolle.
    if (op === "retention-shorten") reasons.push("retention kan kun forlænges, aldrig forkortes");

    if (role.ai === true || role.kind === "agent") {
      if (has(policy.agentDenials?.forbiddenOperations, op)) reasons.push(`AI-agenten må ikke udføre '${op}'`);
      for (const path of policy.agentDenials?.indirectAdminPaths ?? []) {
        if (op.includes("admin") || op.includes(path.replace(/-/g, ""))) reasons.push(`AI-agenten må ikke bruge den indirekte adminvej '${path}'`);
      }
    }
    if (has(role.forbiddenOperations, op)) reasons.push(`rollen '${role.id}' forbyder '${op}'`);
    if (!has(role.allowedOperations, op)) reasons.push(`rollen '${role.id}' tillader ikke '${op}'`);

    if ((op === "protection-policy" || op === "recovery-access") && role.twoPersonRequired !== true) {
      reasons.push(`'${op}' kræver en rolle med to-personers kontrol`);
    }

    if (resource?.deletionProtected === true && op === "delete") {
      if (!role.bypassGovernance && role.id !== "security-admin") reasons.push(`den beskyttede ressource '${resource.id}' må ikke slettes af rollen '${role.id}'`);
    }
    if (op === "key-delete") {
      if (role.ai === true || role.kind === "agent") reasons.push("AI/app-konto må ikke slette nøgler");
      if (role.id !== "security-admin") reasons.push("kun security-admin må slette KMS-nøgler");
    }
    if (op === "lifecycle-change" && role.ai === true) reasons.push("AI-agenten må ikke ændre lifecycle-politikken");
    if (op === "trust-config-write" && (role.ai === true || role.kind === "agent")) reasons.push("AI-agenten må ikke ændre trust-konfigurationen");

    if (role.twoPersonRequired === true && (op === "protection-policy" || op === "recovery-access")) {
      const tpc = authorizeTwoPerson({ policy, operation: op, principal, approval });
      if (!tpc.allowed) reasons.push(...tpc.reasons);
      else obligations.push("two-person-approval");
    }

    return { allowed: reasons.length === 0, reasons, role, obligations };
  }

  function authorize(options) {
    const decision = evaluate(options);
    if (!decision.allowed) {
      record({ type: "denied", operation: options?.operation, role: decision.role?.id ?? null, reasons: decision.reasons });
      throw new ImmutableEnforcementError(`operationen '${options?.operation}' blev afvist`, decision.reasons, "immutable_forbidden");
    }
    record({ type: "allowed", operation: options?.operation, role: decision.role.id, obligations: decision.obligations });
    return decision;
  }

  return {
    kind: "immutable-enforcer",
    policy,
    keyStore: keys,
    evaluate,
    authorize,

    /** Læg en WORM-lås på en version (kun menneske med rettighed). */
    lockVersion({ tenantId, key, version, mode = "COMPLIANCE", retainUntil = null, principal, approval = null } = {}) {
      if (!store) throw new ImmutableEnforcementError("ingen lagerinstans", ["store mangler"]);
      const op = mode === "COMPLIANCE" ? "retention-extend" : "retention-extend";
      const decision = evaluate({ principal, operation: op, approval });
      if (!decision.allowed) return { locked: false, reasons: decision.reasons };
      if (mode === "GOVERNANCE") {
        const tpc = authorizeTwoPerson({ policy, operation: "governance-bypass", principal, approval, control: "governanceBypass" });
        if (!tpc.allowed) return { locked: false, reasons: tpc.reasons };
      }
      const result = store.lockVersion(tenantId, key, version, { mode, retainUntil, now: clock() });
      record({ type: "lock", tenantId, key, version, mode, committed: result.committed });
      return result;
    },

    /**
     * Slet en version. Den mekaniske WORM-håndhævelse ligger i lageret; her
     * afgøres rollen. En GOVERNANCE-bypass kræver et menneske og to-personers
     * godkendelse; COMPLIANCE kan aldrig brydes.
     */
    deleteVersion({ tenantId, key, version, principal, approval = null } = {}) {
      if (!store) throw new ImmutableEnforcementError("ingen lagerinstans", ["store mangler"]);
      const role = resolveRole(policy, principal);
      const decision = evaluate({ principal, operation: "delete" });
      let bypassGovernance = false;
      if (role?.bypassGovernance && role.kind === "human") {
        const tpc = authorizeTwoPerson({ policy, operation: "governance-bypass", principal, approval, control: "governanceBypass" });
        bypassGovernance = tpc.allowed;
      }
      if (!decision.allowed && !bypassGovernance) return { deleted: false, reasons: decision.reasons };
      const result = store.deleteVersion(tenantId, key, version, { bypassGovernance, now: clock() });
      record({ type: "delete", tenantId, key, version, deleted: result.deleted, reason: result.reason ?? null, bypassGovernance });
      return result;
    },

    /** Skift current-pointer. AI er nægtet; den låste autoritative version bevares. */
    switchPointer({ tenantId, key, targetVersion, principal } = {}) {
      if (!store) throw new ImmutableEnforcementError("ingen lagerinstans", ["store mangler"]);
      const decision = evaluate({ principal, operation: "pointer-switch" });
      if (!decision.allowed) return { switched: false, reasons: decision.reasons };
      const authoritative = store.authoritative(tenantId, key);
      record({ type: "pointer-switch", tenantId, key, targetVersion, authoritative: authoritative.version });
      return { switched: true, authoritative, requested: targetVersion };
    },

    /** Slet en beskyttet KMS-nøgle (kun security-admin, to-personers). */
    deleteKey({ keyId, principal, approval = null } = {}) {
      const role = resolveRole(policy, principal);
      const decision = evaluate({ principal, operation: "key-delete", resource: { id: keyId, deletionProtected: true } });
      if (!decision.allowed) return { deleted: false, allowed: false, reasons: decision.reasons, reason: decision.reasons[0] ?? null };
      const result = keys.deleteKey(keyId, { principal, role, approval, now: clock() });
      if (result.allowed) return { deleted: true, allowed: true, reasons: [], obligations: result.obligations ?? [] };
      return { deleted: false, allowed: false, reasons: [result.reason].filter(Boolean), reason: result.reason ?? null };
    },

    /** To-personers ændring af beskyttelsespolitikken. */
    changeProtectionPolicy({ principal, approval = null, change = null } = {}) {
      const decision = evaluate({ principal, operation: "protection-policy", approval });
      if (!decision.allowed) return { changed: false, reasons: decision.reasons };
      record({ type: "protection-policy-change", change });
      return { changed: true, change, obligations: decision.obligations };
    },

    /** To-personers recovery-adgang. */
    requestRecoveryAccess({ principal, approval = null, scope = null } = {}) {
      const decision = evaluate({ principal, operation: "recovery-access", approval });
      if (!decision.allowed) return { granted: false, reasons: decision.reasons };
      record({ type: "recovery-access", scope });
      return { granted: true, scope, obligations: decision.obligations };
    },

    audit() {
      return audit.map((e) => ({ ...e }));
    },
  };
}

/**
 * Krydsreference mellem registerets poster og den håndhævede politik: hver
 * retention-locked post skal have en beskyttet ressource, og politikkens
 * ressource-kinds skal dække alle registrets nøgledomæner.
 */
export function enforcementRegisterProblems(policy, register = []) {
  const problems = [];
  const resourceKinds = new Set((policy.protectedResources ?? []).map((r) => r.kind));
  for (const kind of ["kms-key", "backup", "service-account", "trust-config"]) {
    if (!resourceKinds.has(kind)) problems.push(`politikken mangler en beskyttet ressource af typen '${kind}'`);
  }
  for (const record of register) {
    if (record.dataClass === "retention-locked" && record.storageEnforcement?.status !== "full") {
      problems.push(`${record.id}: retention-locked post erklærer ikke fuld lagerhåndhævelse`);
    }
  }
  return problems;
}
