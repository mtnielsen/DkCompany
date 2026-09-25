/**
 * DKC-040 — singletonjobs med lease og monotonisk fencing-token.
 *
 * Et singletonjob (fx en schedulet backup eller en rebalancer) må kun køre ét
 * sted ad gangen. Leasen er tidsbegrænset, og hver overtagelse hæver
 * `fencing_token`. En worker skal vise sit token umiddelbart før en sideeffekt;
 * et gammelt token afvises, selv om workeren troede den stadig havde leasen.
 * Det forhindrer to samtidige udførere efter en netværkspartition eller et
 * langt GC-pause.
 */
import { normalizeTenantId } from "../../identity/src/tenant.mjs";

function iso(ms) {
  return new Date(ms).toISOString();
}

export function createSingletonLeases({ db, clock = () => Date.now() } = {}) {
  if (!db) throw new Error("createSingletonLeases kræver en database");

  const getStmt = db.prepare("SELECT * FROM singleton_leases WHERE tenant_id = ? AND name = ?");
  const insertStmt = db.prepare(`INSERT INTO singleton_leases(tenant_id, name, holder, fencing_token, lease_until, heartbeat_at, acquired_at, updated_at)
    VALUES (?, ?, ?, 1, ?, ?, ?, ?)`);
  const takeoverStmt = db.prepare(`UPDATE singleton_leases SET holder = ?, fencing_token = fencing_token + 1, lease_until = ?, heartbeat_at = ?, acquired_at = ?, updated_at = ?
    WHERE tenant_id = ? AND name = ?`);
  const refreshStmt = db.prepare("UPDATE singleton_leases SET lease_until = ?, heartbeat_at = ?, updated_at = ? WHERE tenant_id = ? AND name = ? AND holder = ? AND fencing_token = ?");
  const releaseStmt = db.prepare("UPDATE singleton_leases SET holder = NULL, lease_until = NULL, updated_at = ? WHERE tenant_id = ? AND name = ? AND holder = ? AND fencing_token = ?");

  function parse(row) {
    if (!row) return null;
    return {
      tenantId: row.tenant_id,
      name: row.name,
      holder: row.holder,
      fencingToken: row.fencing_token,
      leaseUntil: row.lease_until,
      heartbeatAt: row.heartbeat_at,
      acquiredAt: row.acquired_at,
      updatedAt: row.updated_at,
    };
  }

  return {
    kind: "sqlite-singleton-leases",

    get(tenantId, name) {
      return parse(getStmt.get(normalizeTenantId(tenantId), name));
    },

    /** Tag leasen hvis den er fri eller udløbet. Hæver fencing-token ved overtagelse. */
    acquire(tenantId, name, { holder, leaseMs = 30_000, now = clock() } = {}) {
      const tenant = normalizeTenantId(tenantId);
      if (typeof holder !== "string" || holder.trim() === "") throw new Error("acquire kræver en holder");
      const at = iso(now);
      const until = iso(now + leaseMs);
      return db.transaction(() => {
        const row = parse(getStmt.get(tenant, name));
        if (!row) {
          insertStmt.run(tenant, name, holder, until, at, at, at);
          return { acquired: true, row: parse(getStmt.get(tenant, name)) };
        }
        const expired = !row.leaseUntil || row.leaseUntil < at;
        if (expired) {
          takeoverStmt.run(holder, until, at, at, at, tenant, name);
          return { acquired: true, row: parse(getStmt.get(tenant, name)) };
        }
        if (row.holder === holder) {
          refreshStmt.run(until, at, at, tenant, name, holder, row.fencingToken);
          return { acquired: true, refreshed: true, row: parse(getStmt.get(tenant, name)) };
        }
        return { acquired: false, row };
      });
    },

    /** Forlæng leasen. Kun indehaveren med det rigtige token kan forlænge. */
    heartbeat(tenantId, name, { holder, fencingToken, leaseMs = 30_000, now = clock() } = {}) {
      const at = iso(now);
      return refreshStmt.run(iso(now + leaseMs), at, at, normalizeTenantId(tenantId), name, holder, fencingToken).changes > 0;
    },

    /** Er dette token stadig det aktuelle for indehaveren? Tjek FØR sideeffekt. */
    isValid(tenantId, name, { holder, fencingToken, now = clock() } = {}) {
      const row = parse(getStmt.get(normalizeTenantId(tenantId), name));
      if (!row) return false;
      if (row.holder !== holder || row.fencingToken !== fencingToken) return false;
      if (!row.leaseUntil || row.leaseUntil < iso(now)) return false;
      return true;
    },

    release(tenantId, name, { holder, fencingToken, now = clock() } = {}) {
      return releaseStmt.run(iso(now), normalizeTenantId(tenantId), name, holder, fencingToken).changes > 0;
    },
  };
}
