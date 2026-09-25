/**
 * DKC-045 — versionerede og signerede runbooks.
 *
 * En runbook er ikke en fri tekstvejledning. Den er den præcise kontrakt, en
 * forhåndsgodkendt selvreparation må udføre inden for:
 *
 *   - scope (verber, mål, miljøer, kunder),
 *   - parametergrænser (lukket skema + eksplicitte maksima),
 *   - forudsætninger der skal være opfyldt før handlingen,
 *   - maksimal påvirkning (blast radius, antal mål, varighed, kundesynlighed),
 *   - udløb og maksimal alder for den menneskelige godkendelse,
 *   - et begrænset antal forsøg inden for et tidsvindue,
 *   - rollback (testet) og postchecks.
 *
 * Signaturen dækker hele det kanoniske indhold undtagen signaturfeltet selv.
 * Den beregnes med en nøgle fra et nøglesæt; i produktion leveres nøglen af
 * KMS/HSM (ekstern integration), i test og demo af en injiceret nøgle. En
 * runbook uden gyldig signatur må aldrig resolveres til eksekvering.
 *
 * Modulet er ren logik uden netværk og bruges både af approval-servicen, af
 * change-servicen, af runtimen og af konformanssuiten.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { stableStringify } from "./binding.mjs";

export const RUNBOOK_API_VERSION = "contracts.platform/v1alpha1";
export const RUNBOOK_KIND = "Runbook";
export const CHANGE_REQUEST_KIND = "ChangeRequest";
export const CHANGE_FLOWS = ["standard", "normal", "emergency"];
export const CHANGE_STATES = ["draft", "approval", "scheduled", "implementing", "implemented", "rolled_back", "cancelled", "rejected"];
export const BLAST_RADII = ["single-target", "single-service", "tenant", "platform"];
export const RUNBOOK_ALGORITHMS = ["hmac-sha256"];

/** Kanonisk form: hele runbooken undtagen signaturfeltet. */
export function canonicalRunbook(runbook) {
  const { signature, ...rest } = runbook ?? {};
  return JSON.parse(JSON.stringify(rest));
}

/** SHA-256 over det kanoniske indhold. Samme indhold giver samme digest. */
export function runbookDigest(runbook) {
  return createHash("sha256").update(stableStringify(canonicalRunbook(runbook))).digest("hex");
}

/** Den fulde, versionsstemplede reference, som en godkendelse bindes til. */
export function runbookRef(runbook) {
  return `${runbook?.metadata?.name}@${runbook?.metadata?.version}`;
}

/** Signér en runbook med en HMAC-nøgle. Returnerer en kopi med signatur. */
export function signRunbook(runbook, { keyId, secret, signedAt = new Date().toISOString() } = {}) {
  if (!keyId) throw new Error("signRunbook kræver keyId");
  if (!secret) throw new Error("signRunbook kræver en signeringsnøgle (secret)");
  const value = createHmac("sha256", secret).update(stableStringify(canonicalRunbook(runbook))).digest("hex");
  return { ...structuredClone(canonicalRunbook(runbook)), signature: { algorithm: "hmac-sha256", keyId, value, signedAt } };
}

/**
 * Verificér signaturen. `keyring` er enten `{ [keyId]: secret }` eller
 * `{ keys: [{ keyId, secret, revokedAt? }] }`. Ukendt eller tilbagekaldt nøgle
 * afvises altid.
 */
export function verifyRunbookSignature(runbook, keyring) {
  const signature = runbook?.signature;
  if (!signature) return { ok: false, reason: "runbooken er ikke signeret" };
  if (!RUNBOOK_ALGORITHMS.includes(signature.algorithm)) return { ok: false, reason: `ukendt signaturalgoritme '${signature.algorithm}'` };
  const entry = lookupKey(keyring, signature.keyId);
  if (!entry) return { ok: false, reason: `signeringsnøglen '${signature.keyId}' er ikke kendt` };
  if (entry.revokedAt) return { ok: false, reason: `signeringsnøglen '${signature.keyId}' er tilbagekaldt` };
  const expected = createHmac("sha256", entry.secret).update(stableStringify(canonicalRunbook(runbook))).digest("hex");
  const a = Buffer.from(String(signature.value), "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "runbookens signatur matcher ikke indholdet" };
  return { ok: true, keyId: signature.keyId, digest: runbookDigest(runbook) };
}

function lookupKey(keyring, keyId) {
  if (!keyring || !keyId) return null;
  if (Array.isArray(keyring.keys)) return keyring.keys.find((k) => k.keyId === keyId) ?? null;
  return keyring[keyId] ? { keyId, secret: keyring[keyId] } : null;
}

/* -------------------------------------------------------------------------- */
/* Semantiske regler                                                          */
/* -------------------------------------------------------------------------- */

function problem(path, message) {
  return { path, message };
}

const MUTATING_HINT = /^(restart|scale|drain|upgrade|config\.|rollback|restore|migrate|rotate|deploy|patch|subject\.)/;

/** Er verbet i runbookens scope muterende? Bruges til at kræve A4-beskyttelse. */
export function looksMutating(verb) {
  return typeof verb === "string" && MUTATING_HINT.test(verb);
}

/**
 * Semantiske problemer for en runbook ud over JSON-skemaet. Den fanger bl.a.:
 * manglende signatur/genkendt nøgle, udløb før godkendelse, forkerte flow-krav,
 * utestet rollback og et scope der ikke er lukket.
 */
export function runbookProblems(runbook, { now = Date.now(), keyring = null, strictSignature = true } = {}) {
  const problems = [];
  const rb = runbook ?? {};
  const at = (suffix) => `/${suffix.replace(/^\//, "")}`;

  if (rb.apiVersion !== RUNBOOK_API_VERSION) problems.push(problem("/apiVersion", `apiVersion skal være '${RUNBOOK_API_VERSION}'`));
  if (rb.kind !== RUNBOOK_KIND) problems.push(problem("/kind", `kind skal være '${RUNBOOK_KIND}'`));

  const meta = rb.metadata ?? {};
  if (!meta.name) problems.push(problem("/metadata/name", "runbooken mangler et navn"));
  if (!meta.version) problems.push(problem("/metadata/version", "runbooken mangler en version"));
  if (!meta.description || String(meta.description).length < 10) problems.push(problem("/metadata/description", "runbooken mangler en beskrivelse"));
  if (!meta.owner?.subject && !meta.owner?.team) problems.push(problem("/metadata/owner", "runbooken skal have en teknisk ejer"));
  if (!meta.accountableHuman?.subject) problems.push(problem("/metadata/accountableHuman", "runbooken skal have et navngivet menneske som ansvarlig"));

  // Scope skal være lukket: mindst ét verbum, ét mål og ét miljø.
  const scope = rb.scope ?? {};
  if (!Array.isArray(scope.verbs) || scope.verbs.length === 0) problems.push(problem("/scope/verbs", "runbooken skal dække mindst ét verbum"));
  if (!Array.isArray(scope.targets) || scope.targets.length === 0) problems.push(problem("/scope/targets", "runbooken skal dække mindst ét mål"));
  if (!Array.isArray(scope.environments) || scope.environments.length === 0) problems.push(problem("/scope/environments", "runbooken skal dække mindst ét miljø"));
  if (!Array.isArray(scope.tenants) || scope.tenants.length === 0) problems.push(problem("/scope/tenants", "runbooken skal angive en kundeliste ('*' for alle)"));

  // Parametergrænser.
  const params = rb.parameters ?? {};
  if (!params.schema || typeof params.schema !== "object") problems.push(problem("/parameters/schema", "runbooken mangler et lukket parameterskema"));
  else if (params.schema.additionalProperties !== false) problems.push(problem("/parameters/schema/additionalProperties", "parameterskemaet skal være lukket (additionalProperties: false)"));
  const limits = params.limits ?? {};
  if (!(limits.maxDurationSeconds > 0)) problems.push(problem("/parameters/limits/maxDurationSeconds", "runbooken skal have en positiv maksimal varighed"));
  if (!(limits.maxTargets > 0)) problems.push(problem("/parameters/limits/maxTargets", "runbooken skal have et positivt maksimalt antal mål"));

  // Forudsætninger skal være navngivne og have en forventet værdi.
  if (!Array.isArray(rb.preconditions) || rb.preconditions.length === 0) problems.push(problem("/preconditions", "runbooken skal have mindst én forudsætning"));
  else
    for (const [i, pre] of rb.preconditions.entries()) {
      if (!pre?.id || !pre?.check) problems.push(problem(`/preconditions/${i}`, "forudsætningen mangler id eller check"));
      if (pre?.expect === undefined) problems.push(problem(`/preconditions/${i}/expect`, "forudsætningen mangler en forventet værdi"));
    }

  // Maksimal påvirkning.
  const impact = rb.maxImpact ?? {};
  if (!BLAST_RADII.includes(impact.blastRadius)) problems.push(problem("/maxImpact/blastRadius", `ukendt blast radius '${impact.blastRadius}'`));
  if (!(impact.maxTargets > 0)) problems.push(problem("/maxImpact/maxTargets", "maksimal påvirkning skal angive et positivt antal mål"));
  if (typeof impact.customerVisible !== "boolean") problems.push(problem("/maxImpact/customerVisible", "maksimal påvirkning skal angive om den er kundesynlig"));
  if (!(impact.maxDurationSeconds > 0)) problems.push(problem("/maxImpact/maxDurationSeconds", "maksimal påvirkning skal angive en positiv varighed"));

  // Udløb: godkendelsen må ikke være udløbet på forhånd, og maksimal alder skal
  // respekteres.
  const expiry = rb.expiry ?? {};
  const approvedAt = Date.parse(expiry.approvedAt ?? "");
  const expiresAt = Date.parse(expiry.expiresAt ?? "");
  if (!Number.isFinite(approvedAt)) problems.push(problem("/expiry/approvedAt", "runbooken mangler et gyldigt approvedAt"));
  if (!Number.isFinite(expiresAt)) problems.push(problem("/expiry/expiresAt", "runbooken mangler et gyldigt expiresAt"));
  if (Number.isFinite(approvedAt) && Number.isFinite(expiresAt) && expiresAt <= approvedAt) problems.push(problem("/expiry/expiresAt", "udløb skal ligge efter godkendelsen"));
  if (!(expiry.maxAgeSeconds > 0)) problems.push(problem("/expiry/maxAgeSeconds", "runbooken skal have en positiv maksimal alder"));
  else if (Number.isFinite(approvedAt) && Number.isFinite(expiresAt) && (expiresAt - approvedAt) / 1000 > expiry.maxAgeSeconds) {
    problems.push(problem("/expiry/expiresAt", "godkendelsesvinduet er længere end den maksimale alder"));
  }
  if (Number.isFinite(expiresAt) && expiresAt <= now) problems.push(problem("/expiry/expiresAt", "runbookens godkendelse er udløbet"));

  // Forsøg.
  const attempts = rb.attempts ?? {};
  if (!(attempts.maxAttempts > 0)) problems.push(problem("/attempts/maxAttempts", "runbooken skal have et positivt maksimalt antal forsøg"));
  if (!(attempts.windowSeconds > 0)) problems.push(problem("/attempts/windowSeconds", "runbooken skal have et positivt forsøgsvindue"));

  // Rollback og postchecks.
  const rollback = rb.rollback ?? {};
  if (rollback.required !== true) problems.push(problem("/rollback/required", "runbooken skal kræve rollback"));
  if (!rollback.method) problems.push(problem("/rollback/method", "runbooken mangler en rollback-metode"));
  if (rollback.tested !== true) problems.push(problem("/rollback/tested", "rollback skal være testet før runbooken kan forhåndsgodkendes"));
  if (!Array.isArray(rb.postchecks) || rb.postchecks.length === 0) problems.push(problem("/postchecks", "runbooken skal have mindst én postcheck"));
  else
    for (const [i, post] of rb.postchecks.entries()) {
      if (!post?.id || !post?.check) problems.push(problem(`/postchecks/${i}`, "postchecken mangler id eller check"));
      if (post?.expect === undefined) problems.push(problem(`/postchecks/${i}/expect`, "postchecken mangler en forventet værdi"));
      if (!["rollback", "escalate"].includes(post?.onFailure)) problems.push(problem(`/postchecks/${i}/onFailure`, "postchecken skal ved fejl rulle tilbage eller eskalere"));
    }

  // Flow-krav.
  const approval = rb.approval ?? {};
  if (!CHANGE_FLOWS.includes(approval.flow)) problems.push(problem("/approval/flow", `ukendt change-flow '${approval.flow}'`));
  if (typeof approval.preApproved !== "boolean") problems.push(problem("/approval/preApproved", "runbooken skal angive om den er forhåndsgodkendt"));
  if (!(approval.requiredApprovals >= 1)) problems.push(problem("/approval/requiredApprovals", "runbooken skal kræve mindst én godkendelse"));
  if (!Array.isArray(approval.eligibleGroups) || approval.eligibleGroups.length === 0) problems.push(problem("/approval/eligibleGroups", "runbooken skal angive godkendergrupper"));
  if (approval.flow === "standard" && approval.preApproved !== true) problems.push(problem("/approval/preApproved", "en standard change skal være forhåndsgodkendt"));
  if (approval.flow === "standard" && !approval.preApprovalRef) problems.push(problem("/approval/preApprovalRef", "en forhåndsgodkendt standard change skal referere til sin godkendelse"));

  // Signatur.
  if (strictSignature) {
    if (!rb.signature) problems.push(problem("/signature", "runbooken skal være signeret"));
    else if (keyring) {
      const verified = verifyRunbookSignature(rb, keyring);
      if (!verified.ok) problems.push(problem("/signature", verified.reason));
    }
  }

  return problems;
}

/** Lukket scope-matchning: verbum OG mål OG miljø (OG kunde) skal være dækket. */
export function scopeCovers(runbook, { verb, target, environment, tenantId = null } = {}) {
  const scope = runbook?.scope ?? {};
  if (!Array.isArray(scope.verbs) || !scope.verbs.includes(verb)) return false;
  if (!Array.isArray(scope.environments) || !scope.environments.includes(environment)) return false;
  const tenants = scope.tenants ?? [];
  if (!tenants.includes("*") && tenantId !== null && !tenants.includes(tenantId)) return false;
  return (scope.targets ?? []).some((pattern) => targetMatches(pattern, target));
}

/** Forankret glob-matchning: `service/*` dækker `service/a`, men ikke `service`. */
export function targetMatches(pattern, target) {
  const p = String(pattern);
  const t = String(target);
  if (p === t) return true;
  if (!/[?*]/.test(p)) return false;
  const rx = new RegExp("^" + p.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]") + "(/|$)");
  return rx.test(t);
}

/**
 * Kontrollér parametre mod runbookens lukkede skema. Skemaet er en delmængde af
 * JSON Schema; vi understøtter type, enum, minimum/maximum, minLength,
 * minItems og additionalProperties:false, hvilket er nok til driftsrunbooks og
 * undgår en tung afhængighed i runtime-stien.
 */
export function parameterProblems(runbook, parameters = {}) {
  const problems = [];
  const schema = runbook?.parameters?.schema ?? { type: "object", additionalProperties: false };
  const value = parameters ?? {};
  if (schema.type === "object") {
    if (typeof value !== "object" || Array.isArray(value) || value === null) {
      return [problem("/parameters", "parametre skal være et objekt")];
    }
    const props = schema.properties ?? {};
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in props)) problems.push(problem(`/parameters/${key}`, `parameteren '${key}' er ikke tilladt i runbooken`));
      }
    }
    for (const [key, sub] of Object.entries(props)) {
      if (!(key in value)) {
        if (sub.required === true) problems.push(problem(`/parameters/${key}`, `den påkrævede parameter '${key}' mangler`));
        continue;
      }
      problems.push(...checkValue(value[key], sub, `/parameters/${key}`));
    }
  } else {
    problems.push(...checkValue(value, schema, "/parameters"));
  }
  return problems;
}

function checkValue(value, schema, at) {
  const problems = [];
  if (schema.type && typeof value !== schema.type) {
    // heltal er en gyldig integer
    if (!(schema.type === "integer" && Number.isInteger(value))) {
      problems.push(problem(at, `forventede type '${schema.type}', fik '${Array.isArray(value) ? "array" : typeof value}'`));
      return problems;
    }
  }
  if (schema.enum && !schema.enum.includes(value)) problems.push(problem(at, `værdien er ikke blandt ${JSON.stringify(schema.enum)}`));
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) problems.push(problem(at, `værdien er under minimum ${schema.minimum}`));
    if (schema.maximum !== undefined && value > schema.maximum) problems.push(problem(at, `værdien er over maksimum ${schema.maximum}`));
  }
  if (typeof value === "string" && schema.minLength !== undefined && value.length < schema.minLength) problems.push(problem(at, `strengen er kortere end ${schema.minLength}`));
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) problems.push(problem(at, `listen har færre end ${schema.minItems} elementer`));
    if (schema.maxItems !== undefined && value.length > schema.maxItems) problems.push(problem(at, `listen har flere end ${schema.maxItems} elementer`));
  }
  return problems;
}

/** Er den menneskelige forhåndsgodkendelse stadig gyldig på tidspunktet `at`? */
export function preApprovalValid(preApproval, runbook, at = Date.now()) {
  if (!preApproval) return { ok: false, reason: "der findes ingen forhåndsgodkendelse" };
  if (preApproval.digest !== runbookDigest(runbook)) return { ok: false, reason: "forhåndsgodkendelsen er bundet til en anden runbookversion" };
  if (!preApproval.approvedAt) return { ok: false, reason: "forhåndsgodkendelsen mangler godkendelsestidspunkt" };
  const expiresAt = Date.parse(preApproval.expiresAt ?? "");
  if (!Number.isFinite(expiresAt)) return { ok: false, reason: "forhåndsgodkendelsen mangler udløb" };
  if (at >= expiresAt) return { ok: false, reason: "forhåndsgodkendelsen er udløbet" };
  if ((preApproval.attempts ?? 0) >= (runbook.attempts?.maxAttempts ?? 0)) return { ok: false, reason: "forhåndsgodkendelsens forsøgsgrænse er nået" };
  return { ok: true };
}
