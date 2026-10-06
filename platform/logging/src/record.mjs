/**
 * DKC-049 — den komplette logpost.
 *
 * `buildLogRecord` er den ene vej til en post: den udfylder metadata, fjerner
 * hemmeligheder og skjult ræsonnering, minimerer persondata, og afviser en post
 * der ikke består de semantiske krav. `recordProblems` er den rene kontrol, som
 * både byggeren og conformance-validatoren bruger.
 */
import { randomUUID } from "node:crypto";
import { parseResourceId } from "../../identity/src/tenant.mjs";
import { buildCorrelation, correlationProblems } from "./correlation.mjs";
import { provenanceProblems } from "./provenance.mjs";
import { assertNoHiddenReasoning, assertNoSecrets, redactLogRecord, DEFAULT_FORBIDDEN_REASONING_KEYS } from "./redact.mjs";
import { digest } from "./canonical.mjs";

export const LOG_RECORD_KIND = "LogRecord";
export const LOG_RECORD_SCHEMA_VERSION = "1.0";

const ENVIRONMENTS = new Set(["dev", "staging", "prod"]);
const RETENTION_CLASSES = new Set(["operational", "personal", "security"]);
const HEX64 = /^[a-f0-9]{64}$/;

const iso = (ms) => new Date(ms).toISOString();

function parseTime(value) {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Semantiske problemer for en logpost. Formhåndhævelse sker i JSON Schema;
 * her efterprøves de beslutninger skemaet ikke kan udtrykke.
 */
export function recordProblems(record, { now = Date.now(), maxSkewSeconds = 300, policy = null } = {}) {
  const problems = [];
  if (!record || typeof record !== "object") return [{ path: "/", message: "logposten er ikke et objekt" }];

  for (const field of ["schemaVersion", "kind", "id", "occurredAt", "recordedAt", "correlation", "scope", "provenance", "dataClassification", "retentionClass", "minimized", "redactions"]) {
    if (record[field] === undefined || record[field] === null || record[field] === "") problems.push({ path: `/${field}`, message: "obligatorisk felt mangler" });
  }
  if (record.kind !== undefined && record.kind !== LOG_RECORD_KIND) problems.push({ path: "/kind", message: `skal være '${LOG_RECORD_KIND}'` });
  if (record.minimized !== true) problems.push({ path: "/minimized", message: "en logpost skal være minimeret" });
  if (!Array.isArray(record.redactions)) problems.push({ path: "/redactions", message: "redactions skal være et array" });

  problems.push(...correlationProblems(record.correlation));
  problems.push(...provenanceProblems(record));

  // Scope: tenant og ressource skal stemme, og ressourcen skal være en rigtig ID.
  const scope = record.scope ?? {};
  if (typeof scope.service !== "string" || scope.service.length === 0) problems.push({ path: "/scope/service", message: "scope.service mangler" });
  if (!ENVIRONMENTS.has(scope.environment)) problems.push({ path: "/scope/environment", message: `ukendt miljø '${scope.environment}'` });
  if (!RETENTION_CLASSES.has(record.retentionClass)) problems.push({ path: "/retentionClass", message: `ukendt retention-klasse '${record.retentionClass}'` });
  try {
    const parsed = parseResourceId(scope.resource);
    if (parsed.tenantId !== scope.tenantId) {
      problems.push({ path: "/scope/resource", message: `ressourcen tilhører '${parsed.tenantId}', ikke '${scope.tenantId}'` });
    }
  } catch (err) {
    problems.push({ path: "/scope/resource", message: err.message });
  }

  // Tid og tidsynkronisering.
  const occurred = parseTime(record.occurredAt);
  const recorded = parseTime(record.recordedAt);
  if (occurred === null) problems.push({ path: "/occurredAt", message: "ugyldigt tidsstempel" });
  if (recorded === null) problems.push({ path: "/recordedAt", message: "ugyldigt tidsstempel" });
  if (occurred !== null && recorded !== null) {
    if (recorded < occurred - maxSkewSeconds * 1000) problems.push({ path: "/recordedAt", message: "posten er registreret før den skete (tidsforskydning)" });
    if (recorded > now + maxSkewSeconds * 1000) problems.push({ path: "/recordedAt", message: "posten er registreret i fremtiden" });
  }

  // Muterende handlinger kræver den holdbare kvittering der blev skrevet FØR mutationen.
  if (record.action?.mutating === true) {
    const receipt = record.receipt;
    if (!receipt || typeof receipt !== "object") {
      problems.push({ path: "/receipt", message: "en muterende handling kræver en holdbar auditkvittering" });
    } else {
      if (!receipt.intentId) problems.push({ path: "/receipt/intentId", message: "kvitteringen mangler et intentId" });
      if (!receipt.idempotencyId) problems.push({ path: "/receipt/idempotencyId", message: "kvitteringen mangler et idempotencyId" });
      if (!["pending", "succeeded", "failed", "unknown"].includes(receipt.state)) problems.push({ path: "/receipt/state", message: "ukendt kvitteringstilstand" });
    }
  }

  // Verificerede resultater skal bære en rigtig digest.
  if (record.provenance === "verified" && record.verification && !HEX64.test(String(record.verification.artifactDigest ?? ""))) {
    problems.push({ path: "/verification/artifactDigest", message: "artifactDigest skal være en SHA-256 digest" });
  }
  if (record.model && record.model.responseDigest != null && !HEX64.test(String(record.model.responseDigest))) {
    problems.push({ path: "/model/responseDigest", message: "responseDigest skal være en SHA-256 digest" });
  }

  try {
    assertNoSecrets(record);
  } catch (err) {
    problems.push({ path: "/", message: err.message });
  }
  try {
    assertNoHiddenReasoning(record, policy?.redaction?.forbiddenReasoningKeys ?? DEFAULT_FORBIDDEN_REASONING_KEYS);
  } catch (err) {
    problems.push({ path: "/", message: err.message });
  }
  return problems;
}

/**
 * Byg én komplet, minimeret logpost. Kaster hvis posten ikke består de
 * semantiske krav, så en ufuldstændig post ikke kan snige sig ind i loggen.
 */
export function buildLogRecord(input, { now = Date.now(), forbiddenKeys = DEFAULT_FORBIDDEN_REASONING_KEYS, policy = null } = {}) {
  if (!input || typeof input !== "object") throw new TypeError("buildLogRecord kræver et objekt");
  const base = {
    schemaVersion: LOG_RECORD_SCHEMA_VERSION,
    kind: LOG_RECORD_KIND,
    id: input.id ?? randomUUID(),
    occurredAt: input.occurredAt ?? iso(now),
    recordedAt: input.recordedAt ?? iso(now),
    ...input,
  };
  if (base.correlation) base.correlation = buildCorrelation(base.correlation);
  const { record, redactions, reasoningRemoved, personalDataDigest } = redactLogRecord(base, { forbiddenKeys });
  const built = {
    ...record,
    minimized: true,
    redactions,
    ...(personalDataDigest ? { personalDataDigest } : {}),
  };
  const problems = recordProblems(built, { now, policy });
  if (problems.length) {
    const error = new Error(`ugyldig logpost: ${problems.map((p) => `${p.path} ${p.message}`).join("; ")}`);
    error.name = "LogRecordError";
    error.problems = problems;
    error.reasoningRemoved = reasoningRemoved;
    throw error;
  }
  return built;
}

/** SHA-256 over postens kanoniske indhold (uden ledger-/arkivmetadata). */
export function recordDigest(record) {
  const { ledger, archive, ...rest } = record ?? {};
  return digest(rest);
}

/**
 * Den digest der binder en menneskelig godkendelse til et forløb. Et
 * modeludsagn kan kun udføre en muterende handling, hvis der findes en
 * godkendelsespost i samme execution med præcis denne digest.
 */
export function approvalDigestOf(humanRecord) {
  const human = humanRecord?.human ?? {};
  return digest({
    correlationId: humanRecord?.correlation?.correlationId ?? null,
    executionId: humanRecord?.correlation?.executionId ?? null,
    subject: human.subject ?? null,
    role: human.role ?? null,
    decision: human.decision ?? null,
    decidedAt: human.decidedAt ?? null,
  });
}
