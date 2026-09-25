/**
 * DKC-017 — telemetri med tenantadgang og minimering.
 *
 * Telemetri (metrics, logs, traces) er den ene strøm der både driver dashboards
 * og sikkerhedsstatus. Den må derfor aldrig:
 *
 *   1. bære hemmeligheder eller persondata videre end formålet kræver,
 *   2. kunne læses på tværs af kunder uden en eksplicit, scopet platformrolle.
 *
 * `ingestTelemetry` minimerer hvert signal rekursivt (hemmeligheder fjernes,
 * personfelter erstattes og deres digest bevares til korrelation). `queryTelemetry`
 * udleder tenanten fra den **verificerede** principal via `requireTenantContext`
 * og returnerer kun poster for den tenant — en fremmed tenant afvises, ikke
 * blot filtreres væk.
 *
 * Modulet er rene funktioner ud over tenant-konteksten og kan efterprøves uden
 * en kørende OTel-collector.
 */
import { createHash } from "node:crypto";
import { isPersonalKey, isSecretKey, redactSecrets, REDACTED } from "../../persistence/src/redact.mjs";
import { normalizeTenantId, requireTenantContext } from "../../identity/src/tenant.mjs";

export const SIGNALS = ["metric", "log", "trace"];
const MINIMIZED = "[MINIMIZED]";

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
}

function digestOf(value) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

/**
 * Minimér et vilkårligt payload rekursivt.
 *
 * @returns {{ operational: any, removed: string[], redactions: string[], personalDigest: string }}
 *   `operational` er den minimerede kopi, `removed` er stierne til de fjernede
 *   personfelter, `redactions` er stierne til fjernede hemmeligheder, og
 *   `personalDigest` er en SHA-256 over de fjernede personværdier (så en sag
 *   kan korreleres uden at opbevare dem).
 */
export function minimizePayload(payload) {
  const secretPaths = [];
  // Første pass fjerner hemmeligheder på feltnavn og værdimønster.
  const withoutSecrets = redactSecrets(payload, { redactions: secretPaths });
  const removed = [];
  const personalValues = {};

  function walk(node, path) {
    if (node === null || typeof node !== "object") return node;
    if (Array.isArray(node)) return node.map((item, i) => walk(item, `${path}/${i}`));
    const out = {};
    for (const [key, value] of Object.entries(node)) {
      const child = `${path}/${key}`;
      if (isPersonalKey(key)) {
        removed.push(child);
        personalValues[child] = value;
        out[key] = MINIMIZED;
        continue;
      }
      out[key] = walk(value, child);
    }
    return out;
  }

  const operational = walk(withoutSecrets, "");
  return {
    operational,
    removed,
    redactions: secretPaths,
    personalDigest: digestOf(personalValues),
  };
}

/**
 * Minimér én telemetri-post.
 *
 * Hemmeligheder fjernes overalt i posten (feltnavn og værdimønster). Frie
 * personfelter i `attributes` erstattes, og deres digest bevares, så en sag kan
 * korreleres uden at rå persondata bredes ud. Strukturerede felter som
 * `metric.name`, `log.event` og `trace.spanId` bevares, fordi de er nødvendige
 * for signalet; en rå personidentifikator i `subject.name` afvises i stedet for
 * at blive gemt.
 */
export function minimizeTelemetryRecord(record) {
  const secretPaths = [];
  const withoutSecrets = redactSecrets(record, { redactions: secretPaths });
  const minimized = minimizePayload(withoutSecrets.attributes ?? {});
  return {
    ...withoutSecrets,
    attributes: minimized.operational,
    minimized: true,
    personalData: {
      removed: minimized.removed.map((p) => `attributes${p}`),
      redactions: secretPaths,
      digest: minimized.personalDigest,
    },
  };
}

function assertSignalShape(record) {
  if (!SIGNALS.includes(record.signal)) {
    throw new TypeError(`ukendt signal '${record.signal}' (forventer ${SIGNALS.join(", ")})`);
  }
  const block = record[record.signal];
  if (!block || typeof block !== "object") {
    throw new TypeError(`telemetri-post '${record.id}' mangler sin '${record.signal}'-blok`);
  }
  if (record.signal === "metric" && (!block.name || typeof block.value !== "number")) {
    throw new TypeError(`metrik '${record.id}' skal have name og en numerisk value`);
  }
  if (record.signal === "log" && !block.event) {
    throw new TypeError(`logpost '${record.id}' skal have en event`);
  }
  if (record.signal === "trace" && (!block.traceId || !block.spanId || typeof block.durationMs !== "number")) {
    throw new TypeError(`trace '${record.id}' skal have traceId, spanId og durationMs`);
  }
}

/** En tenant-synlig emne-streng må ikke være en rå personidentifikator. */
export function assertPseudonymousSubject(subject) {
  if (!subject) return subject;
  const name = String(subject.name ?? "");
  if (name.includes("@") || /\+?\d{6,}/.test(name)) {
    throw new TypeError(`telemetri-emnet '${name}' ser ud som en rå personidentifikator; brug et pseudonym`);
  }
  return subject;
}

/**
 * Minimér og valider en række rå telemetri-poster. Kaster hvis en post er
 * ugyldig eller mangler en tenant, så en halv-minimeret post ikke kan snige sig
 * ind i læsevejen.
 */
export function ingestTelemetry(records = [], { knownTenants = null } = {}) {
  return records.map((raw, i) => {
    if (!raw || typeof raw !== "object") throw new TypeError(`telemetri-post ${i} er ikke et objekt`);
    if (!raw.id) throw new TypeError(`telemetri-post ${i} mangler id`);
    const tenantId = normalizeTenantId(raw.tenantId);
    if (knownTenants && !knownTenants.has(tenantId)) {
      throw new TypeError(`telemetri-post ${i} peger på den ukendte tenant '${tenantId}'`);
    }
    assertSignalShape(raw);
    assertPseudonymousSubject(raw.subject);
    const record = minimizeTelemetryRecord({ ...raw, tenantId });
    return Object.freeze({ apiVersion: "contracts.platform/v1alpha1", kind: "TelemetryRecord", ...record });
  });
}

/**
 * Læs telemetri for den tenant den verificerede principal tilhører.
 *
 * En kunde kan ikke se en andens telemetri: en påstand om en fremmed tenant
 * afvises af `requireTenantContext`, og resultatet filtreres altid på den
 * udledte tenant. Kun en scopet platformrolle kan læse på tværs, og det
 * markeres i resultatet.
 */
export function queryTelemetry({ principal, requestedTenantId = null, records = [], signal = null, since = null, limit = null } = {}) {
  const context = requireTenantContext({
    principal,
    claimed: requestedTenantId ? [requestedTenantId] : [],
    source: "telemetry-read",
  });
  const sinceMs = since ? Date.parse(since) : null;
  let rows = records.filter((r) => r.tenantId === context.tenantId);
  if (signal) rows = rows.filter((r) => r.signal === signal);
  if (sinceMs !== null && Number.isFinite(sinceMs)) {
    rows = rows.filter((r) => Number.isFinite(Date.parse(r.capturedAt)) && Date.parse(r.capturedAt) >= sinceMs);
  }
  rows = [...rows].sort((a, b) => String(a.capturedAt).localeCompare(String(b.capturedAt)));
  if (Number.isInteger(limit) && limit >= 0) rows = rows.slice(0, limit);
  // Sidste sikkerhedsnet: ingen post må bære en anden tenant end konteksten.
  for (const row of rows) {
    if (row.tenantId !== context.tenantId) {
      throw new Error(`tenant-lækage: post '${row.id}' tilhører '${row.tenantId}', ikke '${context.tenantId}'`);
    }
  }
  return { tenantId: context.tenantId, crossTenant: context.crossTenant, subject: context.subject, records: rows };
}

/** Kort, tenant-scopet aggregat til dashboards (antal pr. signal). */
export function telemetryCounts(records = []) {
  const counts = { metric: 0, log: 0, trace: 0 };
  for (const r of records) if (counts[r.signal] !== undefined) counts[r.signal] += 1;
  return counts;
}

export { REDACTED };
