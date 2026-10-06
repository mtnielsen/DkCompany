/**
 * DKC-010 — holdbar tilbagekaldelsesliste.
 *
 * Implementerer den `store`-grænseflade `credentials/src/revocation.mjs` bruger:
 * `put`, `get`, `all`, `remove`. Verifikationssiden slår op her, så et
 * tilbagekaldt credential afvises selvom signaturen og TTL stadig er gyldige.
 */
export function createSqliteRevocationStore({ db, kind = "sqlite-revocation-store" } = {}) {
  if (!db) throw new Error("createSqliteRevocationStore kræver en database");

  const putStmt = db.prepare(`INSERT INTO revocations(key, scope, jti, spiffe_id, tenant_id, reason, revoked_by, revoked_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET scope = excluded.scope, jti = excluded.jti, spiffe_id = excluded.spiffe_id,
      tenant_id = excluded.tenant_id, reason = excluded.reason, revoked_by = excluded.revoked_by,
      revoked_at = excluded.revoked_at, expires_at = excluded.expires_at`);
  const getStmt = db.prepare("SELECT * FROM revocations WHERE key = ?");
  const allStmt = db.prepare("SELECT * FROM revocations ORDER BY revoked_at");
  const removeStmt = db.prepare("DELETE FROM revocations WHERE key = ?");

  const parse = (row) =>
    row
      ? { key: row.key, scope: row.scope, jti: row.jti, spiffeId: row.spiffe_id, tenantId: row.tenant_id, reason: row.reason, revokedBy: row.revoked_by, revokedAt: row.revoked_at, expiresAt: row.expires_at }
      : null;

  return {
    kind,
    put(entry) {
      db.transaction(() => {
        putStmt.run(entry.key, entry.scope, entry.jti ?? null, entry.spiffeId ?? null, entry.tenantId ?? null, entry.reason ?? null, entry.revokedBy ?? null, entry.revokedAt, entry.expiresAt ?? null);
      });
      return entry;
    },
    get(key) {
      return parse(getStmt.get(key));
    },
    all() {
      return allStmt.all().map(parse);
    },
    remove(key) {
      return db.transaction(() => removeStmt.run(key).changes > 0);
    },
  };
}
