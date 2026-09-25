/**
 * DKC-008 — holdbar, append-only audit-log.
 *
 * Hver tenant har sin egen hash-kæde i `audit_events`. At skrive sker i en
 * `BEGIN IMMEDIATE`-transaktion, hvor den sidste hash læses og den nye post
 * indsættes, så samtidige skrivere ikke kan producere en kæde med to forgreninger
 * eller samme sekvensnummer. `verifyChain` genberegner kæden og opdager enhver
 * efterfølgende ændring.
 */
import { createHash, randomUUID } from "node:crypto";

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
}

function digest(prevHash, event) {
  return createHash("sha256").update(`${prevHash}|${canonical(event)}`).digest("hex");
}

export function createSqliteAuditLog({ db, genesis = "0".repeat(64), clock = () => Date.now(), kind = "sqlite-audit-log" } = {}) {
  if (!db) throw new Error("createSqliteAuditLog kræver en database");

  const lastStmt = db.prepare("SELECT hash FROM audit_events WHERE tenant_id IS ? ORDER BY seq DESC LIMIT 1");
  const insertStmt = db.prepare(`INSERT INTO audit_events(id, tenant_id, at, type, verb, actor, payload, prev_hash, hash, trace_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const eventsStmt = db.prepare("SELECT * FROM audit_events WHERE tenant_id IS ? ORDER BY seq ASC");
  const countStmt = db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE tenant_id IS ?");
  const tenantsStmt = db.prepare("SELECT DISTINCT tenant_id FROM audit_events");

  function lastHashFor(tenantId) {
    const row = lastStmt.get(tenantId ?? null);
    return row?.hash ?? genesis;
  }

  function parse(row) {
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
        };
        const hash = digest(prevHash, event);
        insertStmt.run(event.id, tenant, event.at, event.type, event.verb, event.actor, JSON.stringify(event.payload), prevHash, hash, event.traceId);
        return { ...event, hash };
      });
    },
    events(tenantId = null) {
      return eventsStmt.all(tenantId ?? null).map(parse);
    },
    size(tenantId = null) {
      return countStmt.get(tenantId ?? null).n;
    },
    lastHash(tenantId = null) {
      return lastHashFor(tenantId ?? null);
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
