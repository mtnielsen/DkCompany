/**
 * DKC-040 — transaktionel outbox med publisher confirms.
 *
 * En forretningsændring og dens begivenhed skrives i **samme** transaktion:
 * `append` kaldes inde i kalderens `db.transaction(...)` sammen med selve
 * ændringen, så en committed ændring altid har en begivenhed og en rullet
 * tilbage ændring aldrig efterlader en begivenhed alene.
 *
 * Udgivelse følger publisher-confirm-mønsteret:
 *   1. `claimBatch` tager en lease med et monotonisk `lease_token` (fencing),
 *   2. `publisher(event)` kaldes; kun hvis den **bekræfter** (returnerer uden
 *      fejl), markeres begivenheden `confirmed`,
 *   3. fejler udgivelsen, forbliver begivenheden `pending` med backoff og en
 *      synlig fejl — der er ingen falsk succes.
 *
 * En gammel udgiver hvis lease er overtaget kan ikke bekræfte, fordi
 * `lease_token` ikke længere matcher.
 */
import { normalizeTenantId } from "../../identity/src/tenant.mjs";
import { assertTenantBound, eventDigest, resourceOf } from "./events.mjs";

function iso(ms) {
  return new Date(ms).toISOString();
}

export const DEFAULT_OUTBOX_POLICY = {
  maxAttempts: 8,
  baseDelayMs: 500,
  maxDelayMs: 60_000,
  jitter: 0.2,
};

export function outboxBackoffMs(attempt, policy = DEFAULT_OUTBOX_POLICY, random = Math.random) {
  const base = policy.baseDelayMs ?? DEFAULT_OUTBOX_POLICY.baseDelayMs;
  const max = policy.maxDelayMs ?? DEFAULT_OUTBOX_POLICY.maxDelayMs;
  const raw = Math.min(max, base * 2 ** Math.max(0, attempt - 1));
  const jitter = raw * (policy.jitter ?? 0);
  return Math.round(raw - jitter + random() * 2 * jitter);
}

export function createSqliteOutbox({ db, clock = () => Date.now(), policy = DEFAULT_OUTBOX_POLICY } = {}) {
  if (!db) throw new Error("createSqliteOutbox kræver en database");

  const insertStmt = db.prepare(`INSERT INTO event_outbox(
      tenant_id, event_id, event_type, source, subject, resource_type, resource_id, resource_version,
      payload, dataclassification, trace_id, idempotency_key, status, attempts, next_attempt_at,
      claimed_by, claimed_at, lease_token, lease_until, confirmed_at, last_error, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, NULL, NULL, NULL, 0, NULL, NULL, NULL, ?, ?)`);
  const getStmt = db.prepare("SELECT * FROM event_outbox WHERE tenant_id = ? AND event_id = ?");
  const getIdemStmt = db.prepare("SELECT * FROM event_outbox WHERE tenant_id = ? AND idempotency_key = ?");
  const listStmt = db.prepare("SELECT * FROM event_outbox WHERE tenant_id = ? ORDER BY created_at, event_id");
  const dueStmt = db.prepare(`SELECT event_id FROM event_outbox
    WHERE tenant_id = ? AND status = 'pending'
      AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
      AND (lease_until IS NULL OR lease_until < ?)
    ORDER BY created_at ASC, event_id ASC LIMIT ?`);
  const claimStmt = db.prepare(`UPDATE event_outbox
    SET claimed_by = ?, claimed_at = ?, lease_token = lease_token + 1, lease_until = ?, attempts = attempts + 1, updated_at = ?
    WHERE tenant_id = ? AND event_id = ? AND status = 'pending'`);
  const confirmStmt = db.prepare(`UPDATE event_outbox
    SET status = 'confirmed', confirmed_at = ?, claimed_by = NULL, claimed_at = NULL, lease_until = NULL, last_error = NULL, updated_at = ?
    WHERE tenant_id = ? AND event_id = ? AND lease_token = ? AND status = 'pending'`);
  const retryStmt = db.prepare(`UPDATE event_outbox
    SET next_attempt_at = ?, last_error = ?, claimed_by = NULL, claimed_at = NULL, lease_until = NULL, updated_at = ?
    WHERE tenant_id = ? AND event_id = ? AND lease_token = ? AND status = 'pending'`);
  const failStmt = db.prepare(`UPDATE event_outbox
    SET status = 'failed', last_error = ?, claimed_by = NULL, claimed_at = NULL, lease_until = NULL, updated_at = ?
    WHERE tenant_id = ? AND event_id = ? AND lease_token = ? AND status = 'pending'`);
  const versionStmt = db.prepare(`INSERT INTO resource_versions(tenant_id, resource_type, resource_id, version, last_event_id, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(tenant_id, resource_type, resource_id) DO UPDATE SET
      version = MAX(resource_versions.version, excluded.version),
      last_event_id = excluded.last_event_id,
      updated_at = excluded.updated_at`);
  const currentVersionStmt = db.prepare("SELECT version FROM resource_versions WHERE tenant_id = ? AND resource_type = ? AND resource_id = ?");

  function parse(row) {
    if (!row) return null;
    return {
      tenantId: row.tenant_id,
      eventId: row.event_id,
      eventType: row.event_type,
      source: row.source,
      subject: row.subject,
      resource: { type: row.resource_type, id: row.resource_id, version: row.resource_version },
      event: JSON.parse(row.payload),
      dataclassification: row.dataclassification,
      traceId: row.trace_id,
      idempotencyKey: row.idempotency_key,
      status: row.status,
      attempts: row.attempts,
      nextAttemptAt: row.next_attempt_at,
      claimedBy: row.claimed_by,
      leaseToken: row.lease_token,
      leaseUntil: row.lease_until,
      confirmedAt: row.confirmed_at,
      lastError: row.last_error,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      digest: eventDigest(JSON.parse(row.payload)),
    };
  }

  const outbox = {
    kind: "sqlite-outbox",
    policy,

    /**
     * Skriv en begivenhed. Kaldes inde i den samme transaktion som den
     * forretningsmæssige ændring. `idempotencyKey` dedupliker samme logiske
     * begivenhed; som standard bruges begivenhedens id.
     */
    append(tenantId, event, { idempotencyKey = null, now = clock() } = {}) {
      const tenant = normalizeTenantId(tenantId);
      assertTenantBound(event, tenant);
      const resource = resourceOf(event);
      const key = idempotencyKey ?? event.id;
      const at = iso(now);
      return db.transaction(() => {
        const existing = key ? parse(getIdemStmt.get(tenant, key)) : null;
        if (existing) return { row: existing, created: false, deduplicated: true };
        const current = currentVersionStmt.get(tenant, resource.type, resource.id)?.version ?? 0;
        const version = Math.max(resource.version ?? 0, current + 1);
        const boundEvent = { ...event, data: { ...event.data, resource: { ...resource, version } } };
        versionStmt.run(tenant, resource.type, resource.id, version, event.id, at);
        insertStmt.run(
          tenant,
          event.id,
          event.type,
          event.source,
          event.subject ?? null,
          resource.type,
          resource.id,
          version,
          JSON.stringify(boundEvent),
          event.dataclassification ?? null,
          event.traceid ?? null,
          key,
          at,
          at
        );
        return { row: parse(getStmt.get(tenant, event.id)), created: true, deduplicated: false };
      });
    },

    get(tenantId, eventId) {
      return parse(getStmt.get(normalizeTenantId(tenantId), eventId));
    },

    getByIdempotencyKey(tenantId, key) {
      return parse(getIdemStmt.get(normalizeTenantId(tenantId), key));
    },

    list(tenantId, { status } = {}) {
      return listStmt.all(normalizeTenantId(tenantId)).map(parse).filter((r) => (status ? r.status === status : true));
    },

    /** Tag en batch til udgivelse med fencing-lease. */
    claimBatch(tenantId, { limit = 10, workerId = null, leaseMs = 30_000, now = clock() } = {}) {
      const tenant = normalizeTenantId(tenantId);
      const at = iso(now);
      return db.transaction(() => {
        const candidates = dueStmt.all(tenant, at, at, limit);
        const claimed = [];
        for (const { event_id: eventId } of candidates) {
          const changed = claimStmt.run(workerId, at, iso(now + leaseMs), at, tenant, eventId).changes;
          if (changed > 0) claimed.push(parse(getStmt.get(tenant, eventId)));
        }
        return claimed;
      });
    },

    /** Bekræft at brokeren har kvitteret begivenheden (publisher confirm). */
    confirm(tenantId, eventId, { leaseToken, now = clock() } = {}) {
      const at = iso(now);
      const changed = confirmStmt.run(at, at, normalizeTenantId(tenantId), eventId, leaseToken).changes;
      if (!changed) return { ok: false, reason: "lease-token matcher ikke eller begivenheden er ikke pending" };
      return { ok: true, row: parse(getStmt.get(normalizeTenantId(tenantId), eventId)) };
    },

    /** Registrér en fejlet udgivelse. Begivenheden forbliver synligt pending. */
    fail(tenantId, eventId, { leaseToken, error = null, now = clock() } = {}) {
      const tenant = normalizeTenantId(tenantId);
      const at = iso(now);
      const row = parse(getStmt.get(tenant, eventId));
      if (!row) return { ok: false, reason: "ukendt begivenhed" };
      if (row.leaseToken !== leaseToken) return { ok: false, reason: "lease-token matcher ikke" };
      const message = error == null ? "udgivelse fejlede" : String(error?.message ?? error);
      if (row.attempts >= policy.maxAttempts) {
        failStmt.run(message, at, tenant, eventId, leaseToken);
        return { ok: false, terminal: true, row: parse(getStmt.get(tenant, eventId)) };
      }
      const delayMs = outboxBackoffMs(row.attempts, policy);
      retryStmt.run(iso(now + delayMs), message, at, tenant, eventId, leaseToken);
      return { ok: false, terminal: false, delayMs, row: parse(getStmt.get(tenant, eventId)) };
    },

    /**
     * Udgiv alle forfaldne begivenheder for tenanten gennem `publisher`.
     * `publisher` er den eneste integrationsgrænse; en rigtig broker er
     * ekstern (NOT RUN), mens kontrakten efterprøves med en testdobbelt.
     */
    async publishPending(tenantId, { publisher, workerId = null, limit = 10, leaseMs = 30_000, now = clock() } = {}) {
      if (typeof publisher !== "function") throw new Error("publishPending kræver en publisher-funktion");
      const batch = outbox.claimBatch(tenantId, { limit, workerId, leaseMs, now });
      const results = [];
      for (const claimed of batch) {
        try {
          await publisher(claimed.event, { attempt: claimed.attempts, leaseToken: claimed.leaseToken });
          results.push({ eventId: claimed.eventId, confirmed: true, ...outbox.confirm(tenantId, claimed.eventId, { leaseToken: claimed.leaseToken, now }) });
        } catch (err) {
          results.push({ eventId: claimed.eventId, confirmed: false, ...outbox.fail(tenantId, claimed.eventId, { leaseToken: claimed.leaseToken, error: err, now }) });
        }
      }
      return results;
    },

    /** Antal begivenheder der endnu ikke er bekræftet. */
    backlog(tenantId) {
      return outbox.list(tenantId).filter((r) => r.status === "pending").length;
    },

    /** Alder på den ældste uafklarede begivenhed i ms (0 hvis ingen). */
    oldestPendingAgeMs(tenantId, { now = clock() } = {}) {
      const pending = outbox.list(tenantId).filter((r) => r.status === "pending");
      if (pending.length === 0) return 0;
      const oldest = Math.min(...pending.map((r) => Date.parse(r.createdAt)));
      return Math.max(0, now - oldest);
    },

    /** Genåbn leases fra en udgiver der er død. */
    recoverStaleClaims(tenantId, { olderThanMs = 60_000, now = clock() } = {}) {
      const tenant = normalizeTenantId(tenantId);
      const cutoff = iso(now - olderThanMs);
      const open = db.all("SELECT event_id FROM event_outbox WHERE tenant_id = ? AND status = 'pending' AND lease_until IS NOT NULL AND lease_until < ?", tenant, cutoff);
      return db.transaction(() => {
        for (const row of open) {
          db.prepare("UPDATE event_outbox SET claimed_by = NULL, claimed_at = NULL, lease_until = NULL, updated_at = ? WHERE tenant_id = ? AND event_id = ?").run(iso(now), tenant, row.event_id);
        }
        return open.map((r) => r.event_id);
      });
    },
  };

  return outbox;
}
