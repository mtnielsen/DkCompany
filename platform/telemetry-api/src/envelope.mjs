/**
 * DKC-066 — versioneret telemetri-envelope.
 *
 * Envelopen er den ene indgang for metrics/logs/traces (OpenTelemetry),
 * sikkerhedsfund, testkørsler, recovery-status og agenthandlinger.
 * `envelopeProblems` håndhæver det et JSON Schema ikke kan udtrykke alene:
 *
 *   - kun kendte, betroede kilder må levere pass-bærende signaler,
 *   - tidsstemplet skal være et sandsynligt `occurredAt` (ikke i fremtiden ud
 *     over en lille skævhed) — forældede hændelser markeres `late` og udelades
 *     fra friskhed, så de ikke kan forfalske en frisk status,
 *   - ressourcen og dens relationer skal være stabile ID'er inden for samme
 *     tenant (globale miljø-/host-ressourcer er tilladte),
 *   - hvert signal kræver sin strukturerede del (OTel-blok, `ref` eller
 *     principal).
 */
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { buildCorrelation } from "./resources.mjs";

export const ENVELOPE_KIND = "TelemetryEnvelope";
export const SUPPORTED_SCHEMA_VERSIONS = ["1.0"];
export const SOURCE_REGISTRY_PATH = "telemetry-api/collectors.json";

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
}

export function envelopeDigest(envelope) {
  return createHash("sha256").update(canonical(envelope)).digest("hex");
}

export function loadCollectorRegistry(root) {
  const path = join(root, SOURCE_REGISTRY_PATH);
  if (!existsSync(path)) throw new Error(`Mangler ${SOURCE_REGISTRY_PATH}`);
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Betroede kilder som et map id → definition. */
export function trustedSources(registry) {
  const map = new Map();
  for (const source of registry?.sources ?? []) {
    if (source.trusted === true) map.set(source.id, source);
  }
  return map;
}

export function collectorRegistryProblems(registry) {
  const problems = [];
  const sources = registry?.sources ?? [];
  if (sources.length === 0) problems.push("/sources: mindst én kilde kræves");
  const ids = new Set();
  for (const [i, s] of sources.entries()) {
    const at = `/sources/${i}`;
    if (!s.id) problems.push(`${at}/id: mangler`);
    if (ids.has(s.id)) problems.push(`${at}/id: dubleret kilde '${s.id}'`);
    ids.add(s.id);
    if (typeof s.trusted !== "boolean") problems.push(`${at}/trusted: skal være boolsk`);
    if (!Number.isFinite(s.expectedIntervalSeconds) || s.expectedIntervalSeconds <= 0) problems.push(`${at}/expectedIntervalSeconds: skal være positiv`);
    if (!Number.isFinite(s.maxAgeSeconds) || s.maxAgeSeconds < s.expectedIntervalSeconds) problems.push(`${at}/maxAgeSeconds: skal være ≥ det forventede interval`);
  }
  const bounds = registry?.bounds ?? {};
  for (const key of ["maxEnvelopesPerSecond", "maxBuffer", "maxCardinality", "maxEnvelopeBytes"]) {
    if (!Number.isFinite(bounds[key]) || bounds[key] <= 0) problems.push(`/bounds/${key}: skal være et positivt tal`);
  }
  return problems;
}

function err(path, message) {
  return { path, message };
}

const REQUIRED = ["schemaVersion", "kind", "id", "occurredAt", "signal", "source", "scope", "resource", "dataClassification"];
const SIGNALS = new Set(["metric", "log", "trace", "finding", "test-run", "recovery", "agent-action"]);

/**
 * Semantiske problemer for én envelope.
 *
 * @returns {{ problems: object[], late: boolean, trusted: boolean }}
 */
export function envelopeProblems(envelope, { now = Date.now(), registry = null, maxSkewSeconds = 300, maxAgeSeconds = 3600, allowGlobal = true } = {}) {
  const problems = [];
  if (!envelope || typeof envelope !== "object") return { problems: [err("/", "envelopen er ikke et objekt")], late: false, trusted: false };
  const at = typeof now === "string" ? Date.parse(now) : now instanceof Date ? now.getTime() : Number(now);

  for (const key of REQUIRED) {
    if (envelope[key] === undefined || envelope[key] === null || envelope[key] === "") problems.push(err(`/${key}`, "mangler"));
  }
  if (envelope.kind !== undefined && envelope.kind !== ENVELOPE_KIND) problems.push(err("/kind", `skal være '${ENVELOPE_KIND}'`));
  if (envelope.schemaVersion && !SUPPORTED_SCHEMA_VERSIONS.includes(envelope.schemaVersion)) {
    problems.push(err("/schemaVersion", `schemaVersion '${envelope.schemaVersion}' understøttes ikke (har ${SUPPORTED_SCHEMA_VERSIONS.join(", ")})`));
  }
  if (envelope.signal && !SIGNALS.has(envelope.signal)) problems.push(err("/signal", `ukendt signal '${envelope.signal}'`));

  let late = false;
  const occurred = Date.parse(envelope.occurredAt);
  if (Number.isFinite(occurred)) {
    if (occurred > at + maxSkewSeconds * 1000) problems.push(err("/occurredAt", "hændelsen er dateret i fremtiden"));
    if (at - occurred > maxAgeSeconds * 1000) late = true;
  } else {
    problems.push(err("/occurredAt", "ugyldigt tidsstempel"));
  }

  // Kilde og tillid.
  let trusted = false;
  const sourceId = envelope.source?.id;
  if (!sourceId) {
    problems.push(err("/source/id", "mangler"));
  } else if (registry) {
    trusted = trustedSources(registry).has(sourceId);
    if (!trusted) problems.push(err("/source/id", `kilden '${sourceId}' er ikke registreret som betroet`));
  } else {
    trusted = true;
  }

  // Ressource + relationer.
  let correlation = null;
  try {
    correlation = buildCorrelation({ root: envelope.resource, relations: envelope.relations ?? {}, allowGlobal });
  } catch (e) {
    problems.push(err("/resource", e.message));
  }

  // Signalets strukturerede del.
  if (envelope.signal === "metric" && !(envelope.otel && Number.isFinite(envelope.otel.metric?.value) && envelope.otel.metric?.name)) {
    problems.push(err("/otel/metric", "metrik-signalet kræver et OTel-metriknavn og en numerisk værdi"));
  }
  if (envelope.signal === "trace" && !(envelope.otel?.traceId && envelope.otel?.spanId)) {
    problems.push(err("/otel", "trace-signalet kræver traceId og spanId"));
  }
  if (envelope.signal === "log" && !(envelope.payload?.body || envelope.otel?.attributes?.message)) {
    problems.push(err("/payload", "log-signalet kræver en body eller et message-attribut"));
  }
  if (["finding", "test-run", "recovery"].includes(envelope.signal) && !envelope.ref?.contract) {
    problems.push(err("/ref", `'${envelope.signal}' kræver en struktureret ref.contract`));
  }
  if (envelope.signal === "agent-action" && !(envelope.ref?.contract === "cloud-event" || envelope.payload?.principal)) {
    problems.push(err("/payload", "agent-handlinger kræver en CloudEvent-reference eller en principal"));
  }

  return { problems, late, trusted, correlation };
}
