/**
 * DKC-008 — holdbare budgetter.
 *
 * Budgettællere (tokens, EUR, kald) ligger i databasen og opdateres atomisk i
 * en `BEGIN IMMEDIATE`-transaktion. `consume` kan sætte et hårdt loft: to
 * samtidige workers kan ikke begge overskride det, fordi læsning af den
 * aktuelle saldo og skrivningen sker under samme skrivelås.
 */
import { normalizeTenantId } from "../../../identity/src/tenant.mjs";

export function createSqliteBudgetStore({ db, clock = () => Date.now(), kind = "sqlite-budget-store" } = {}) {
  if (!db) throw new Error("createSqliteBudgetStore kræver en database");

  const getStmt = db.prepare("SELECT tenant_id, budget_key, tokens, cost_eur, calls, ceiling_tokens, updated_at FROM budgets WHERE tenant_id = ? AND budget_key = ?");
  const upsertStmt = db.prepare(`INSERT INTO budgets(tenant_id, budget_key, tokens, cost_eur, calls, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(tenant_id, budget_key) DO UPDATE SET
      tokens = budgets.tokens + excluded.tokens,
      cost_eur = budgets.cost_eur + excluded.cost_eur,
      calls = budgets.calls + excluded.calls,
      updated_at = excluded.updated_at`);
  const ceilingStmt = db.prepare(`INSERT INTO budgets(tenant_id, budget_key, tokens, cost_eur, calls, ceiling_tokens, updated_at)
    VALUES (?, ?, 0, 0, 0, ?, ?)
    ON CONFLICT(tenant_id, budget_key) DO UPDATE SET ceiling_tokens = excluded.ceiling_tokens, updated_at = excluded.updated_at`);

  function toRecord(row) {
    if (!row) return null;
    return { tenantId: row.tenant_id, key: row.budget_key, tokens: row.tokens, costEur: row.cost_eur, calls: row.calls, ceilingTokens: row.ceiling_tokens, updatedAt: row.updated_at };
  }

  return {
    kind,
    get(tenantId, key) {
      return toRecord(getStmt.get(normalizeTenantId(tenantId), key));
    },
    setCeiling(tenantId, key, ceilingTokens) {
      const at = new Date(clock()).toISOString();
      db.transaction(() => ceilingStmt.run(normalizeTenantId(tenantId), key, ceilingTokens ?? null, at));
      return this.get(tenantId, key);
    },
    /**
     * Atomisk forbrug. Returnerer `{ ok: false, exceeded: true }` hvis loftet
     * ville blive overskredet; intet skrives i så fald.
     */
    consume(tenantId, key, { tokens = 0, costEur = 0, calls = 1 } = {}) {
      const tenant = normalizeTenantId(tenantId);
      const at = new Date(clock()).toISOString();
      return db.transaction(() => {
        const current = toRecord(getStmt.get(tenant, key));
        const nextTokens = (current?.tokens ?? 0) + tokens;
        const nextCost = (current?.costEur ?? 0) + costEur;
        const nextCalls = (current?.calls ?? 0) + calls;
        if (current?.ceilingTokens !== null && current?.ceilingTokens !== undefined && nextTokens > current.ceilingTokens) {
          return { ok: false, exceeded: true, ceilingTokens: current.ceilingTokens, attemptedTokens: nextTokens, record: current };
        }
        upsertStmt.run(tenant, key, tokens, costEur, calls, at);
        return { ok: true, exceeded: false, record: toRecord(getStmt.get(tenant, key)) };
      });
    },
    /** Læs alle budgetter for tenanten. */
    list(tenantId) {
      return db
        .all("SELECT tenant_id, budget_key, tokens, cost_eur, calls, ceiling_tokens, updated_at FROM budgets WHERE tenant_id = ? ORDER BY budget_key", normalizeTenantId(tenantId))
        .map(toRecord);
    },
  };
}
