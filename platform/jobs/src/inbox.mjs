/**
 * DKC-040 — forbrugerens inbox med dedup, ack og logisk rækkefølge.
 *
 * Inboxen er den vedvarende modpart til outboxen. Den giver:
 *
 *   - **Dedup:** (tenant, consumer, event_id) er unik. En genleveret begivenhed
 *     kan derfor ikke give en dobbelt sideeffekt.
 *   - **Rækkefølge pr. ressource:** en forsinket begivenhed (version ≤ den
 *     behandlede) afvises som `stale`, og et hul i versionsrækken udsætter
 *     behandlingen (`deferred`) frem for at anvende begivenheder i forkert
 *     rækkefølge.
 *   - **Ack efter sideeffekt:** rækken skrives `received` *før* handleren kaldes
 *     og markeres `processed` (med ressource-versionen) *efter* handleren er
 *     færdig. Et nedbrud mellem de to efterlader et `processing`-spor, som
 *     kræver reconciliation — en irreversibel begivenhed genudføres aldrig
 *     blindt.
 */
import { normalizeTenantId } from "../../identity/src/tenant.mjs";
import { assertTenantBound, eventDigest, resourceOf } from "./events.mjs";

function iso(ms) {
  return new Date(ms).toISOString();
}

export function createSqliteInbox({ db, clock = () => Date.now(), maxAttempts = 8 } = {}) {
  if (!db) throw new Error("createSqliteInbox kræver en database");

  const getStmt = db.prepare("SELECT * FROM event_inbox WHERE tenant_id = ? AND consumer = ? AND event_id = ?");
  const listStmt = db.prepare("SELECT * FROM event_inbox WHERE tenant_id = ? AND consumer = ? ORDER BY received_at, event_id");
  const insertStmt = db.prepare(`INSERT INTO event_inbox(
      tenant_id, consumer, event_id, event_type, resource_type, resource_id, resource_version,
      payload_digest, status, received_at, processed_at, attempts, last_error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, NULL)`);
  const beginStmt = db.prepare("UPDATE event_inbox SET status = 'processing', attempts = attempts + 1 WHERE tenant_id = ? AND consumer = ? AND event_id = ?");
  const ackStmt = db.prepare("UPDATE event_inbox SET status = 'processed', processed_at = ?, last_error = NULL WHERE tenant_id = ? AND consumer = ? AND event_id = ?");
  const skipStmt = db.prepare("UPDATE event_inbox SET status = 'skipped', processed_at = ?, last_error = ? WHERE tenant_id = ? AND consumer = ? AND event_id = ?");
  const retryStmt = db.prepare("UPDATE event_inbox SET status = 'received', last_error = ? WHERE tenant_id = ? AND consumer = ? AND event_id = ?");
  const deadStmt = db.prepare("UPDATE event_inbox SET status = 'dead-letter', last_error = ? WHERE tenant_id = ? AND consumer = ? AND event_id = ?");
  const versionGetStmt = db.prepare("SELECT version FROM resource_versions WHERE tenant_id = ? AND resource_type = ? AND resource_id = ?");
  const versionSetStmt = db.prepare(`INSERT INTO resource_versions(tenant_id, resource_type, resource_id, version, last_event_id, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(tenant_id, resource_type, resource_id) DO UPDATE SET
      version = MAX(resource_versions.version, excluded.version),
      last_event_id = excluded.last_event_id, updated_at = excluded.updated_at`);
  const insertDeadStmt = db.prepare(`INSERT OR REPLACE INTO event_dead_letters(tenant_id, consumer, event_id, reason, attempts, payload, created_at, redriven_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`);
  const getDeadStmt = db.prepare("SELECT * FROM event_dead_letters WHERE tenant_id = ? AND consumer = ? AND event_id = ?");
  const listDeadStmt = db.prepare("SELECT * FROM event_dead_letters WHERE tenant_id = ? AND consumer = ? ORDER BY created_at, event_id");
  const redriveStmt = db.prepare("UPDATE event_inbox SET status = 'received', last_error = NULL WHERE tenant_id = ? AND consumer = ? AND event_id = ? AND status = 'dead-letter'");
  const markRedrivenStmt = db.prepare("UPDATE event_dead_letters SET redriven_at = ? WHERE tenant_id = ? AND consumer = ? AND event_id = ?");

  function parse(row) {
    if (!row) return null;
    return {
      tenantId: row.tenant_id,
      consumer: row.consumer,
      eventId: row.event_id,
      eventType: row.event_type,
      resource: { type: row.resource_type, id: row.resource_id, version: row.resource_version },
      digest: row.payload_digest,
      status: row.status,
      receivedAt: row.received_at,
      processedAt: row.processed_at,
      attempts: row.attempts,
      lastError: row.last_error,
    };
  }

  const inbox = {
    kind: "sqlite-inbox",
    maxAttempts,

    get(tenantId, consumer, eventId) {
      return parse(getStmt.get(normalizeTenantId(tenantId), consumer, eventId));
    },

    list(tenantId, consumer, { status } = {}) {
      return listStmt.all(normalizeTenantId(tenantId), consumer).map(parse).filter((r) => (status ? r.status === status : true));
    },

    /**
     * Modtag en begivenhed. Returnerer `{ received }`, `{ duplicate }`,
     * `{ skipped, stale }` eller `{ deferred, gap }` uden at kalde nogen
     * handler. Kalleren afgør hvad der skal ske.
     */
    receive(tenantId, { consumer, event, ordered = true, now = clock() } = {}) {
      const tenant = normalizeTenantId(tenantId);
      assertTenantBound(event, tenant);
      const resource = resourceOf(event);
      const digest = eventDigest(event);
      const at = iso(now);
      return db.transaction(() => {
        const existing = parse(getStmt.get(tenant, consumer, event.id));
        if (existing) return { duplicate: true, status: existing.status, row: existing };

        if (ordered) {
          const current = versionGetStmt.get(tenant, resource.type, resource.id)?.version ?? 0;
          if ((resource.version ?? 0) <= current) {
            insertStmt.run(tenant, consumer, event.id, event.type, resource.type, resource.id, resource.version, digest, "received", at);
            skipStmt.run(at, `forsinket begivenhed (version ${resource.version} ≤ ${current})`, tenant, consumer, event.id);
            return { received: false, skipped: true, stale: true, currentVersion: current, row: parse(getStmt.get(tenant, consumer, event.id)) };
          }
          if ((resource.version ?? 0) > current + 1) {
            return { received: false, deferred: true, gap: true, expectedVersion: current + 1, gotVersion: resource.version };
          }
        }

        insertStmt.run(tenant, consumer, event.id, event.type, resource.type, resource.id, resource.version, digest, "received", at);
        return { received: true, row: parse(getStmt.get(tenant, consumer, event.id)) };
      });
    },

    /** Markér behandlingen som i gang (efter receive, før sideeffekt). */
    begin(tenantId, { consumer, eventId } = {}) {
      beginStmt.run(normalizeTenantId(tenantId), consumer, eventId);
      return parse(getStmt.get(normalizeTenantId(tenantId), consumer, eventId));
    },

    /**
     * Kvittér efter sideeffekten. Ressource-versionen opdateres først her, så et
     * nedbrud før ack ikke låser efterfølgende versioner ude.
     */
    ack(tenantId, { consumer, eventId, now = clock() } = {}) {
      const tenant = normalizeTenantId(tenantId);
      const at = iso(now);
      return db.transaction(() => {
        const row = parse(getStmt.get(tenant, consumer, eventId));
        if (!row) return null;
        ackStmt.run(at, tenant, consumer, eventId);
        versionSetStmt.run(tenant, row.resource.type, row.resource.id, row.resource.version, eventId, at);
        return parse(getStmt.get(tenant, consumer, eventId));
      });
    },

    /** Registrér en fejl; flyt til dead-letter efter forsøgsgrænsen. */
    fail(tenantId, { consumer, event, eventId, error, now = clock() } = {}) {
      const tenant = normalizeTenantId(tenantId);
      const at = iso(now);
      const message = error == null ? "behandling fejlede" : String(error?.message ?? error);
      return db.transaction(() => {
        const row = parse(getStmt.get(tenant, consumer, eventId));
        if (!row) return null;
        if (row.attempts >= maxAttempts) {
          deadStmt.run(message, tenant, consumer, eventId);
          insertDeadStmt.run(tenant, consumer, eventId, message, row.attempts, JSON.stringify(event ?? row), at);
          return { status: "dead-letter", row: parse(getStmt.get(tenant, consumer, eventId)) };
        }
        retryStmt.run(message, tenant, consumer, eventId);
        return { status: "received", row: parse(getStmt.get(tenant, consumer, eventId)) };
      });
    },

    /** Flyt direkte til dead-letter (poison-isolation). */
    deadLetter(tenantId, { consumer, event, eventId, reason = "poison message", now = clock() } = {}) {
      const tenant = normalizeTenantId(tenantId);
      const at = iso(now);
      return db.transaction(() => {
        const row = parse(getStmt.get(tenant, consumer, eventId));
        if (!row) return null;
        deadStmt.run(reason, tenant, consumer, eventId);
        insertDeadStmt.run(tenant, consumer, eventId, reason, row.attempts, JSON.stringify(event ?? row), at);
        return parse(getStmt.get(tenant, consumer, eventId));
      });
    },

    deadLetters(tenantId, consumer) {
      return listDeadStmt.all(normalizeTenantId(tenantId), consumer).map((r) => ({
        tenantId: r.tenant_id,
        consumer: r.consumer,
        eventId: r.event_id,
        reason: r.reason,
        attempts: r.attempts,
        payload: JSON.parse(r.payload),
        createdAt: r.created_at,
        redrivenAt: r.redriven_at,
      }));
    },

    getDeadLetter(tenantId, consumer, eventId) {
      return getDeadStmt.get(normalizeTenantId(tenantId), consumer, eventId) ?? null;
    },

    /** Genindlæs en dead-letter-begivenhed for en ny runde (operatørhandling). */
    redrive(tenantId, consumer, eventId, { now = clock() } = {}) {
      const tenant = normalizeTenantId(tenantId);
      const at = iso(now);
      return db.transaction(() => {
        const changed = redriveStmt.run(tenant, consumer, eventId).changes;
        if (!changed) return null;
        markRedrivenStmt.run(at, tenant, consumer, eventId);
        return parse(getStmt.get(tenant, consumer, eventId));
      });
    },

    /**
     * Behandl en begivenhed med dedup, rækkefølge og ack.
     *
     * Ved et genfundet `processing`/`received`-spor kaldes `reconcile` (hvis
     * givet) for at afgøre den faktiske sandhed. Uden reconciliation og for en
     * irreversibel begivenhed går den til dead-letter — den genudføres ikke
     * blindt.
     */
    async deliver(tenantId, { consumer, event, ordered = true, handler, reconcile = null, irreversible = false, now = clock() } = {}) {
      if (typeof handler !== "function") throw new Error("deliver kræver en handler");
      const tenant = normalizeTenantId(tenantId);
      const received = inbox.receive(tenant, { consumer, event, ordered, now });
      if (received.skipped) return { status: "skipped", stale: true, ...received };
      if (received.deferred) return { status: "deferred", ...received };
      if (received.duplicate) {
        if (received.status === "processed" || received.status === "skipped") {
          return { status: "replayed", duplicate: true, priorStatus: received.status, row: received.row };
        }
        if (reconcile) {
          const resolved = await reconcile({ event, prior: received.row, tenantId: tenant });
          if (resolved?.resolved && resolved.state === "processed") {
            const row = inbox.ack(tenant, { consumer, eventId: event.id, now });
            return { status: "reconciled", row };
          }
        }
        const dead = inbox.deadLetter(tenant, { consumer, event, eventId: event.id, reason: "uafklaret tidligere behandling — kræver menneskelig reconciliation", now });
        return { status: "dead-letter", row: dead };
      }

      inbox.begin(tenant, { consumer, eventId: event.id });
      try {
        const result = await handler(event);
        const row = inbox.ack(tenant, { consumer, eventId: event.id, now });
        return { status: "processed", result, row };
      } catch (err) {
        const outcome = inbox.fail(tenant, { consumer, event, eventId: event.id, error: err, now });
        return { status: outcome?.status ?? "failed", error: err.message, row: outcome?.row, irreversible };
      }
    },
  };

  return inbox;
}
