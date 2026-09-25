/**
 * DKC-008/DKC-009 — holdbar, append-only audit-log.
 *
 * Hver tenant har sin egen hash-kæde i `audit_events`. At skrive sker i en
 * `BEGIN IMMEDIATE`-transaktion, hvor den sidste hash læses og den nye post
 * indsættes, så samtidige skrivere ikke kan producere en kæde med to forgreninger
 * eller samme sekvensnummer. `verifyChain` genberegner kæden og opdager enhver
 * efterfølgende ændring.
 *
 * DKC-009 udvider kæden med intent/outcome-felter (idempotency_id, intent_id,
 * phase, outcome), retention-klasse og payload-digest. Felterne indgår kun i
 * hash-beregningen når de har en værdi, så en kæde skrevet før migrationen
 * forbliver gyldig.
 */
import { createHash, randomUUID } from "node:crypto";

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
}

/**
 * Den præcise begivenhed der indgår i hash-kæden. De nye DKC-009-felter
 * udelades når de er NULL, så ældre kæder (før v3) forbliver gyldige.
 */
function chainEvent(event) {
  const out = {
    id: event.id,
    tenantId: event.tenantId,
    at: event.at,
    type: event.type,
    verb: event.verb ?? null,
    actor: event.actor ?? null,
    payload: event.payload ?? {},
    traceId: event.traceId ?? null,
    prevHash: event.prevHash,
  };
  if (event.idempotencyId != null) out.idempotencyId = event.idempotencyId;
  if (event.intentId != null) out.intentId = event.intentId;
  if (event.phase != null) out.phase = event.phase;
  if (event.outcome != null) out.outcome = event.outcome;
  if (event.retentionClass != null) out.retentionClass = event.retentionClass;
  if (event.payloadDigest != null) out.payloadDigest = event.payloadDigest;
  if (event.personalDataDigest != null) out.personalDataDigest = event.personalDataDigest;
  return out;
}

function digest(prevHash, event) {
  return createHash("sha256").update(`${prevHash}|${canonical(chainEvent(event))}`).digest("hex");
}

/**
 * Genberegn hash-kædens digest for en begivenhed. Eksporteret så checkpoint-
 * modulet kan verificere den forankrede præfiks med præcis samme funktion som
 * loggen selv bruger.
 */
export function computeChainHash(prevHash, event) {
  return digest(prevHash, event);
}

export function createSqliteAuditLog({ db, genesis = "0".repeat(64), clock = () => Date.now(), kind = "sqlite-audit-log" } = {}) {
  if (!db) throw new Error("createSqliteAuditLog kræver en database");

  const lastStmt = db.prepare("SELECT hash FROM audit_events WHERE tenant_id IS ? ORDER BY seq DESC LIMIT 1");
  const insertStmt = db.prepare(`INSERT INTO audit_events(id, tenant_id, at, type, verb, actor, payload, prev_hash, hash, trace_id,
      idempotency_id, intent_id, phase, outcome, retention_class, payload_digest, personal_data_digest)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const eventsStmt = db.prepare("SELECT * FROM audit_events WHERE tenant_id IS ? ORDER BY seq ASC");
  const countStmt = db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE tenant_id IS ?");
  const tenantsStmt = db.prepare("SELECT DISTINCT tenant_id FROM audit_events");
  const byIdStmt = db.prepare("SELECT * FROM audit_events WHERE tenant_id IS ? AND id = ?");
  const byIdemStmt = db.prepare("SELECT * FROM audit_events WHERE tenant_id IS ? AND idempotency_id = ? ORDER BY seq ASC");

  function lastHashFor(tenantId) {
    const row = lastStmt.get(tenantId ?? null);
    return row?.hash ?? genesis;
  }

  function parse(row) {
    if (!row) return null;
    return {
      seq: row.seq,
      id: row.id,
      tenantId: row.tenant_id,
      at: row.at,
      type: row.type,
      verb: row.verb,
      actor: row.actor,
      payload: JSON.parse(row.payload),
      traceId: row.trace_id,
      prevHash: row.prev_hash,
      hash: row.hash,
      idempotencyId: row.idempotency_id ?? null,
      intentId: row.intent_id ?? null,
      phase: row.phase ?? null,
      outcome: row.outcome ?? null,
      retentionClass: row.retention_class ?? null,
      payloadDigest: row.payload_digest ?? null,
      personalDataDigest: row.personal_data_digest ?? null,
    };
  }

  return {
    kind,
    genesis,
    append({ tenantId = null, ...input } = {}) {
      const tenant = tenantId ?? null;
      return db.transaction(() => {
        const prevHash = lastHashFor(tenant);
        const event = {
          id: input.id ?? randomUUID(),
          tenantId: tenant,
          at: input.at ?? new Date(clock()).toISOString(),
          type: input.type,
          verb: input.verb ?? null,
          actor: input.actor ?? null,
          payload: input.payload ?? {},
          traceId: input.traceId ?? null,
          prevHash,
          idempotencyId: input.idempotencyId ?? null,
          intentId: input.intentId ?? null,
          phase: input.phase ?? null,
          outcome: input.outcome ?? null,
          retentionClass: input.retentionClass ?? null,
          payloadDigest: input.payloadDigest ?? null,
          personalDataDigest: input.personalDataDigest ?? null,
        };
        const hash = digest(prevHash, event);
        insertStmt.run(
          event.id,
          tenant,
          event.at,
          event.type,
          event.verb,
          event.actor,
          JSON.stringify(event.payload),
          prevHash,
          hash,
          event.traceId,
          event.idempotencyId,
          event.intentId,
          event.phase,
          event.outcome,
          event.retentionClass,
          event.payloadDigest,
          event.personalDataDigest
        );
        return { ...event, hash };
      });
    },
    events(tenantId = null) {
      return eventsStmt.all(tenantId ?? null).map(parse);
    },
    byId(tenantId, id) {
      return parse(byIdStmt.get(tenantId ?? null, id));
    },
    byIdempotencyId(tenantId, idempotencyId) {
      return byIdemStmt.all(tenantId ?? null, idempotencyId).map(parse);
    },
    size(tenantId = null) {
      return countStmt.get(tenantId ?? null).n;
    },
    lastHash(tenantId = null) {
      return lastHashFor(tenantId ?? null);
    },
    last(tenantId = null) {
      const rows = eventsStmt.all(tenantId ?? null);
      return rows.length ? parse(rows[rows.length - 1]) : null;
    },
    verifyChain(tenantId = null) {
      let prev = genesis;
      const events = eventsStmt.all(tenantId ?? null);
      for (const row of events) {
        const { hash, seq, ...event } = parse(row);
        const expected = digest(prev, event);
        if (expected !== hash) return { ok: false, brokenAt: seq, length: events.length };
        prev = hash;
      }
      return { ok: true, length: events.length };
    },
    verifyAll() {
      const tenants = tenantsStmt.all().map((r) => r.tenant_id);
      const results = {};
      for (const tenant of tenants) results[tenant ?? "__global__"] = this.verifyChain(tenant);
      return results;
    },
    tenants() {
      return tenantsStmt.all().map((r) => r.tenant_id);
    },
  };
}
