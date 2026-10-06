/**
 * DKC-008 — holdbar jobkø.
 *
 * Jobs overlever procesnedbrud og kan leases af flere replikaer samtidigt uden
 * at samme job udføres to gange. Leasing sker i en `BEGIN IMMEDIATE`-
 * transaktion: den ene worker vinder, de øvrige ser jobbet som `leased`.
 * `recoverStaleLeases` genåbner leases fra en worker der er død (heartbeat for
 * gammelt), så et nedbrud ikke taber jobtilstanden.
 */
import { randomUUID } from "node:crypto";
import { normalizeTenantId } from "../../../identity/src/tenant.mjs";

function iso(ms) {
  return new Date(ms).toISOString();
}

export function createSqliteJobStore({ db, clock = () => Date.now(), kind = "sqlite-job-store" } = {}) {
  if (!db) throw new Error("createSqliteJobStore kræver en database");

  const insertStmt = db.prepare(`INSERT INTO jobs(tenant_id, id, kind, payload, status, attempts, enqueued_at, updated_at, priority)
    VALUES (?, ?, ?, ?, 'queued', 0, ?, ?, ?)`);
  const ensureStmt = db.prepare(`INSERT OR IGNORE INTO jobs(tenant_id, id, kind, payload, status, attempts, enqueued_at, updated_at, priority)
    VALUES (?, ?, ?, ?, 'queued', 0, ?, ?, ?)`);
  const stateStmt = db.prepare(`UPDATE jobs SET status = ?, result = ?, error = ?, heartbeat_at = ?, updated_at = ?
    WHERE tenant_id = ? AND id = ?`);
  const getStmt = db.prepare("SELECT * FROM jobs WHERE tenant_id = ? AND id = ?");
  const listStmt = db.prepare("SELECT * FROM jobs WHERE tenant_id = ? ORDER BY enqueued_at, id");
  const nextQueuedStmt = db.prepare(`SELECT id FROM jobs WHERE tenant_id = ? AND status = 'queued'
    ORDER BY priority ASC, enqueued_at ASC, id ASC LIMIT 1`);
  const leaseStmt = db.prepare(`UPDATE jobs SET status = 'leased', leased_by = ?, leased_at = ?, heartbeat_at = ?,
    attempts = attempts + 1, updated_at = ? WHERE tenant_id = ? AND id = ?`);
  const heartbeatStmt = db.prepare("UPDATE jobs SET heartbeat_at = ?, updated_at = ? WHERE tenant_id = ? AND id = ? AND leased_by = ?");
  const finishStmt = db.prepare(`UPDATE jobs SET status = ?, result = ?, error = ?, updated_at = ?,
    leased_by = NULL, leased_at = NULL, heartbeat_at = NULL WHERE tenant_id = ? AND id = ?`);
  const staleStmt = db.prepare(`SELECT id FROM jobs WHERE status = 'leased'
    AND COALESCE(heartbeat_at, leased_at) < ? AND tenant_id = ?`);
  const requeueStmt = db.prepare(`UPDATE jobs SET status = 'queued', leased_by = NULL, leased_at = NULL, heartbeat_at = NULL,
    updated_at = ? WHERE tenant_id = ? AND id = ?`);

  function parse(row) {
    if (!row) return null;
    return {
      ...row,
      payload: row.payload === null ? null : JSON.parse(row.payload),
      result: row.result === null ? null : JSON.parse(row.result),
    };
  }

  return {
    kind,
    enqueue(tenantId, job = {}) {
      const tenant = normalizeTenantId(tenantId);
      const id = job.id ?? randomUUID();
      const at = iso(clock());
      db.transaction(() => {
        insertStmt.run(tenant, id, job.kind ?? "task", JSON.stringify(job.payload ?? null), at, at, job.priority ?? 100);
      });
      return this.get(tenant, id);
    },
    get(tenantId, id) {
      return parse(getStmt.get(normalizeTenantId(tenantId), id));
    },
    /** Opret jobbet hvis det ikke findes (idempotent genoptagelse efter genstart). */
    ensure(tenantId, job = {}) {
      const tenant = normalizeTenantId(tenantId);
      const id = job.id ?? randomUUID();
      const at = iso(clock());
      db.transaction(() => {
        ensureStmt.run(tenant, id, job.kind ?? "task", JSON.stringify(job.payload ?? null), at, at, job.priority ?? 100);
      });
      return this.get(tenant, id);
    },
    /** Gem et delvist job-state (status + akkumuleret resultat) holdbart. */
    saveState(tenantId, id, { status = "running", state = null, error = null } = {}) {
      const tenant = normalizeTenantId(tenantId);
      const at = iso(clock());
      const changes = stateStmt.run(status, state === null ? null : JSON.stringify(state), error, at, at, tenant, id).changes;
      return changes ? parse(getStmt.get(tenant, id)) : null;
    },
    list(tenantId, { status } = {}) {
      const rows = listStmt.all(normalizeTenantId(tenantId));
      return rows.map(parse).filter((j) => (status ? j.status === status : true));
    },
    /**
     * Lease næste ledige job for tenanten. Returnerer null hvis der intet er.
     * Atomisk på tværs af processer takket være `BEGIN IMMEDIATE`.
     */
    lease(tenantId, workerId, { kinds } = {}) {
      const tenant = normalizeTenantId(tenantId);
      return db.transaction(() => {
        let candidate = nextQueuedStmt.get(tenant);
        if (!candidate && kinds) {
          const rows = db.all("SELECT id, kind FROM jobs WHERE tenant_id = ? AND status = 'queued' ORDER BY priority, enqueued_at", tenant);
          candidate = rows.find((r) => kinds.includes(r.kind)) ?? null;
        }
        if (!candidate) return null;
        const at = iso(clock());
        leaseStmt.run(workerId ?? null, at, at, at, tenant, candidate.id);
        return parse(getStmt.get(tenant, candidate.id));
      });
    },
    heartbeat(tenantId, id, workerId) {
      const at = iso(clock());
      return heartbeatStmt.run(at, at, normalizeTenantId(tenantId), id, workerId).changes > 0;
    },
    complete(tenantId, id, result = null) {
      const at = iso(clock());
      const changes = finishStmt.run("completed", JSON.stringify(result), null, at, normalizeTenantId(tenantId), id).changes;
      return changes ? parse(getStmt.get(normalizeTenantId(tenantId), id)) : null;
    },
    fail(tenantId, id, error) {
      const at = iso(clock());
      const message = error instanceof Error ? error.message : String(error);
      const changes = finishStmt.run("failed", null, message, at, normalizeTenantId(tenantId), id).changes;
      return changes ? parse(getStmt.get(normalizeTenantId(tenantId), id)) : null;
    },
    /**
     * Genåbn leases hvis heartbeat er ældre end `olderThanMs`. Kaldes ved
     * opstart, så et procesnedbrud ikke efterlader jobbet permanent låst.
     */
    recoverStaleLeases({ tenantId = null, olderThanMs = 60_000, now = clock() } = {}) {
      const cutoff = iso(now - olderThanMs);
      const reopened = [];
      const tenants = tenantId
        ? [normalizeTenantId(tenantId)]
        : db.all("SELECT DISTINCT tenant_id FROM jobs WHERE status = 'leased'").map((r) => r.tenant_id);
      db.transaction(() => {
        for (const tenant of tenants) {
          for (const row of staleStmt.all(cutoff, tenant)) {
            requeueStmt.run(iso(now), tenant, row.id);
            reopened.push({ tenantId: tenant, id: row.id });
          }
        }
      });
      return reopened;
    },
    count(tenantId, { status } = {}) {
      const rows = listStmt.all(normalizeTenantId(tenantId));
      return rows.filter((j) => (status ? j.status === status : true)).length;
    },
  };
}
