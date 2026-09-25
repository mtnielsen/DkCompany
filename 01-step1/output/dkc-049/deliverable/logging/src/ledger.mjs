/**
 * DKC-049 — den append-only log-ledger.
 *
 * Ledgeren lægger sig oven på den holdbare, hash-kædede audit-log fra DKC-009 i
 * stedet for at bygge en parallel sandhed. Den tilføjer:
 *
 *   - en strøm pr. tenant + execution, så enkelte forløb kan læses og
 *     verificeres samlet,
 *   - en læseflade der ALDRIG muterer: der findes ingen update/delete-metode, og
 *     agenten kan derfor ikke omskrive eller slette sin egen historik,
 *   - monotone sekvenser og hash-kæde, efterprøvet af `verify`.
 *
 * `append` kræver en audit-log der returnerer `seq` og `hash`; en log der ikke
 * kan give en holdbar kvittering afvises, så en upålidelig skrivevej ikke kan
 * give et falsk bevis.
 */
import { buildCorrelation } from "./correlation.mjs";

export class LedgerError extends Error {
  constructor(message, code = "ledger_error") {
    super(message);
    this.name = "LedgerError";
    this.code = code;
  }
}

export const LOG_EVENT_TYPE = "log.record";

export function streamOf(record) {
  const tenant = record?.scope?.tenantId ?? "__global__";
  const execution = record?.correlation?.executionId ?? "unbound";
  return `${tenant}/${execution}`;
}

async function listEvents(audit, tenantId) {
  if (typeof audit.events === "function") return await audit.events(tenantId);
  if (Array.isArray(audit.events)) {
    return audit.events.filter((e) => (tenantId === undefined || tenantId === null ? true : e.tenantId === tenantId));
  }
  throw new LedgerError("audit-loggen har ingen events()-funktion", "bad_audit_log");
}

function withLedger(event) {
  const record = event.payload ?? {};
  return {
    ...record,
    ledger: {
      stream: streamOf(record),
      seq: event.seq,
      prevHash: event.prevHash ?? null,
      hash: event.hash ?? null,
    },
  };
}

export function createLogLedger({ audit, clock = () => Date.now(), kind = "logging-ledger" } = {}) {
  if (!audit || typeof audit.append !== "function") throw new LedgerError("createLogLedger kræver en audit-log med append()", "missing_audit");

  async function append(record) {
    if (!record?.scope?.tenantId || !record?.correlation?.executionId) {
      throw new LedgerError("logposten mangler tenant eller execution-ID", "unbound_record");
    }
    const event = await audit.append({
      tenantId: record.scope.tenantId,
      at: record.recordedAt,
      type: LOG_EVENT_TYPE,
      verb: record.action?.tool?.verb ?? record.observation?.source ?? "log",
      actor: record.human?.subject ?? record.reader?.subject ?? null,
      payload: record,
      traceId: record.correlation.traceId ?? null,
    });
    if (!event || event.seq === undefined || event.seq === null || !event.hash) {
      throw new LedgerError("audit-loggen gav ingen holdbar sekvens/hash", "not_durable");
    }
    return { record: withLedger(event), event };
  }

  async function read({ tenantId = null, stream = null, correlationId = null, executionId = null, resource = null, provenance = null, since = null, limit = null } = {}) {
    const events = await listEvents(audit, tenantId);
    let records = events.filter((e) => e.type === LOG_EVENT_TYPE && e.payload?.kind === "LogRecord").map(withLedger);
    if (stream) records = records.filter((r) => r.ledger.stream === stream);
    if (correlationId) records = records.filter((r) => r.correlation?.correlationId === correlationId);
    if (executionId) records = records.filter((r) => r.correlation?.executionId === executionId);
    if (resource) records = records.filter((r) => r.scope?.resource === resource);
    if (provenance) records = records.filter((r) => r.provenance === provenance);
    if (since) {
      const sinceMs = Date.parse(since);
      if (Number.isFinite(sinceMs)) records = records.filter((r) => Date.parse(r.occurredAt) >= sinceMs);
    }
    records.sort((a, b) => (a.ledger.seq ?? 0) - (b.ledger.seq ?? 0));
    if (Number.isInteger(limit) && limit >= 0) records = records.slice(0, limit);
    return records;
  }

  async function streams(tenantId = null) {
    const records = await read({ tenantId });
    const map = new Map();
    for (const record of records) {
      const stream = record.ledger.stream;
      const entry = map.get(stream) ?? { stream, count: 0, firstSeq: record.ledger.seq, lastSeq: record.ledger.seq, lastHash: record.ledger.hash };
      entry.count += 1;
      entry.lastSeq = record.ledger.seq;
      entry.lastHash = record.ledger.hash;
      map.set(stream, entry);
    }
    return [...map.values()].sort((a, b) => a.stream.localeCompare(b.stream));
  }

  async function head(tenantId = null) {
    const records = await read({ tenantId });
    return records[records.length - 1] ?? null;
  }

  async function verify(tenantId = null) {
    const problems = [];
    let chain = { ok: true, length: null };
    if (typeof audit.verifyChain === "function") {
      chain = await audit.verifyChain(tenantId);
      if (chain && chain.ok === false) problems.push({ type: "chain", detail: `hash-kæden er brudt ved #${chain.brokenAt}` });
    }
    const records = await read({ tenantId });
    const byStream = new Map();
    for (const record of records) {
      const ledger = record.ledger;
      if (!Number.isInteger(ledger.seq)) {
        problems.push({ type: "sequence", detail: `posten '${record.id}' mangler en sekvens` });
        continue;
      }
      const stream = ledger.stream;
      const last = byStream.get(stream);
      if (last !== undefined && ledger.seq <= last) {
        problems.push({ type: "sequence", detail: `sekvensen for '${stream}' er ikke monoton (${ledger.seq} efter ${last})` });
      }
      byStream.set(stream, ledger.seq);
    }
    return { ok: problems.length === 0, chain, streams: byStream.size, records: records.length, problems };
  }

  return {
    kind,
    appendOnly: true,
    capabilities() {
      return { append: true, read: true, verify: true, update: false, delete: false };
    },
    append,
    read,
    streams,
    head,
    verify,
  };
}

export { buildCorrelation };
