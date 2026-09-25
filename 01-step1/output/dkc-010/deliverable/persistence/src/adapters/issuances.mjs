/**
 * DKC-010 — holdbar udstedelsesjournal for credentials.
 *
 * Hvert udstedt token registreres med jti og det fulde scope, så det kan
 * revideres og afstemmes (reconciliation). Journalen indeholder ingen
 * hemmeligheder — kun metadata.
 */
export function createSqliteIssuanceLedger({ db, kind = "sqlite-issuance-ledger" } = {}) {
  if (!db) throw new Error("createSqliteIssuanceLedger kræver en database");

  const insertStmt = db.prepare(`INSERT OR REPLACE INTO credential_issuances(jti, tenant_id, spiffe_id, agent_ref, role, verb, resource, audience, environment, issued_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const listStmt = db.prepare("SELECT * FROM credential_issuances ORDER BY issued_at");
  const byJtiStmt = db.prepare("SELECT * FROM credential_issuances WHERE jti = ?");

  const parse = (row) =>
    row
      ? { jti: row.jti, tenantId: row.tenant_id, spiffeId: row.spiffe_id, agentRef: row.agent_ref, role: row.role, verb: row.verb, resource: row.resource, audience: row.audience, environment: row.environment, issuedAt: row.issued_at, expiresAt: row.expires_at }
      : null;

  return {
    kind,
    record(entry) {
      db.transaction(() => {
        insertStmt.run(entry.jti, entry.tenantId ?? null, entry.spiffeId, entry.agentRef ?? null, entry.role ?? null, entry.verb ?? null, entry.resource ?? null, entry.audience ?? null, entry.environment ?? null, entry.issuedAt, entry.expiresAt);
      });
      return entry;
    },
    list() {
      return listStmt.all().map(parse);
    },
    byJti(jti) {
      return parse(byJtiStmt.get(jti));
    },
  };
}
