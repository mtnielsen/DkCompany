/**
 * DKC-008 — holdbart lager for godkendelser.
 *
 * Implementerer samme interface som `approvals/src/store.mjs`, men lægger
 * tilstanden i SQLite. Hver række er tenant-scoped via den sammensatte nøgle
 * `(tenant_id, id)`, og `getForTenant`/`listForTenant` læser aldrig uden for
 * tenanten. Reservationen (`claim`) er en atomisk `INSERT OR IGNORE` i en
 * `BEGIN IMMEDIATE`-transaktion, så to samtidige workers ikke kan forbruge
 * samme godkendelse.
 */
import { normalizeTenantId } from "../../../identity/src/tenant.mjs";

function nowIso(clock) {
  return new Date(clock()).toISOString();
}

export function createSqliteApprovalStore({ db, clock = () => Date.now(), kind = "sqlite" } = {}) {
  if (!db) throw new Error("createSqliteApprovalStore kræver en database");

  const getStmt = db.prepare("SELECT data FROM approval_requests WHERE tenant_id = ? AND id = ?");
  const listStmt = db.prepare("SELECT data FROM approval_requests WHERE tenant_id = ? ORDER BY id");
  const listAllStmt = db.prepare("SELECT data FROM approval_requests ORDER BY tenant_id, id");
  const upsertStmt = db.prepare(`INSERT INTO approval_requests(tenant_id, id, state, data, revision, updated_at)
    VALUES (?, ?, ?, ?, 1, ?)
    ON CONFLICT(tenant_id, id) DO UPDATE SET
      state = excluded.state,
      data = excluded.data,
      revision = approval_requests.revision + 1,
      updated_at = excluded.updated_at`);
  const deleteStmt = db.prepare("DELETE FROM approval_requests WHERE tenant_id = ? AND id = ?");
  const claimStmt = db.prepare(`INSERT OR IGNORE INTO approval_claims(tenant_id, approval_id, execution_id, data, claimed_at)
    VALUES (?, ?, ?, ?, ?)`);
  const claimOfStmt = db.prepare("SELECT data FROM approval_claims WHERE tenant_id = ? AND approval_id = ?");
  const markConsumedStmt = db.prepare("UPDATE approval_requests SET consumed_at = ?, updated_at = ? WHERE tenant_id = ? AND id = ?");

  function tenantOf(request) {
    return normalizeTenantId(request?.tenantId);
  }

  function save(request) {
    if (!request?.id) throw new Error("save kræver et id");
    const tenantId = tenantOf(request);
    db.transaction(() => {
      upsertStmt.run(tenantId, request.id, request.decision?.state ?? "pending", JSON.stringify(request), nowIso(clock));
    });
    return request;
  }

  return {
    kind,
    save,
    load({ tenantId } = {}) {
      const rows = tenantId ? listStmt.all(normalizeTenantId(tenantId)) : listAllStmt.all();
      return rows.map((r) => JSON.parse(r.data));
    },
    /** Tenant-scoped læsning: en forkert tenant får aldrig en andens række. */
    getForTenant(tenantId, id) {
      const row = getStmt.get(normalizeTenantId(tenantId), id);
      return row ? JSON.parse(row.data) : null;
    },
    /** Bagudkompatibel `get(id)`: findes kun for enhedstests af adapteren. */
    get(id) {
      const row = db.prepare("SELECT data FROM approval_requests WHERE id = ?").get(id);
      return row ? JSON.parse(row.data) : null;
    },
    listForTenant(tenantId) {
      return listStmt.all(normalizeTenantId(tenantId)).map((r) => JSON.parse(r.data));
    },
    ids(tenantId) {
      return (tenantId ? listStmt.all(normalizeTenantId(tenantId)) : listAllStmt.all()).map((r) => JSON.parse(r.data).id);
    },
    remove(...args) {
      let tenantId;
      let id;
      if (args.length === 1) {
        id = args[0];
        const row = db.get("SELECT tenant_id FROM approval_requests WHERE id = ?", id);
        if (!row) return false;
        tenantId = row.tenant_id;
      } else {
        [tenantId, id] = args;
      }
      return db.transaction(() => {
        const removed = deleteStmt.run(normalizeTenantId(tenantId), id).changes > 0;
        db.prepare("DELETE FROM approval_claims WHERE tenant_id = ? AND approval_id = ?").run(normalizeTenantId(tenantId), id);
        return removed;
      });
    },
    /**
     * Atomisk reservation. `record.tenantId` skal stemme med rækkens tenant.
     * Returnerer false hvis den allerede er taget af en anden worker.
     */
    claim(id, record = {}) {
      const tenantId = normalizeTenantId(record.tenantId);
      const row = getStmt.get(tenantId, id);
      if (!row) return false;
      return db.transaction(() => {
        const inserted = claimStmt.run(tenantId, id, record.executionId ?? null, JSON.stringify(record), nowIso(clock)).changes > 0;
        if (inserted) markConsumedStmt.run(nowIso(clock), nowIso(clock), tenantId, id);
        return inserted;
      });
    },
    claimOf(tenantId, id) {
      const row = claimOfStmt.get(normalizeTenantId(tenantId), id);
      return row ? JSON.parse(row.data) : null;
    },
    count(tenantId) {
      const row = tenantId
        ? db.get("SELECT COUNT(*) AS n FROM approval_requests WHERE tenant_id = ?", normalizeTenantId(tenantId))
        : db.get("SELECT COUNT(*) AS n FROM approval_requests");
      return row.n;
    },
  };
}
