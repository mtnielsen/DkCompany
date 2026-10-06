/**
 * DKC-008/DKC-012 — holdbare og bindende budgetter.
 *
 * Budgettællere (tokens, EUR, kald) ligger i databasen og opdateres atomisk i
 * en `BEGIN IMMEDIATE`-transaktion. Et loft kontrolleres mod både det forbrugte
 * og det reserverede, så to samtidige workers ikke kan bruge den samme
 * resterende budgetpost.
 *
 * DKC-012 tilføjer en reservationsmodel:
 *
 *   reserve()  holder et maksimalt beløb (fx route'ens max-output + estimeret
 *              input) atomisk. Returnerer `exceeded` hvis `forbrug + reserveret
 *              + ny reservation` ville bryde loftet — intet skrives i så fald.
 *   settle()   bogfører det faktiske forbrug, frigiver forskellen mellem
 *              reservation og faktisk brug og markerer reservationen `settled`.
 *   release()  frigiver hele reservationen (timeout, afbrudt kald, fejl).
 *
 * Reservationen er holdbar, så et nedbrud midt i et kald ikke kan efterlade et
 * forbrug uden afregning.
 */
import { normalizeTenantId } from "../../../identity/src/tenant.mjs";

export class BudgetError extends Error {
  constructor(message) {
    super(message);
    this.name = "BudgetError";
  }
}

export function createSqliteBudgetStore({ db, clock = () => Date.now(), kind = "sqlite-budget-store" } = {}) {
  if (!db) throw new Error("createSqliteBudgetStore kræver en database");

  const getStmt = db.prepare("SELECT tenant_id, budget_key, tokens, cost_eur, calls, ceiling_tokens, ceiling_cost_eur, reserved_tokens, reserved_cost_eur, updated_at FROM budgets WHERE tenant_id = ? AND budget_key = ?");
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
  const ceilingCostStmt = db.prepare(`INSERT INTO budgets(tenant_id, budget_key, tokens, cost_eur, calls, ceiling_cost_eur, updated_at)
    VALUES (?, ?, 0, 0, 0, ?, ?)
    ON CONFLICT(tenant_id, budget_key) DO UPDATE SET ceiling_cost_eur = excluded.ceiling_cost_eur, updated_at = excluded.updated_at`);
  const ensureStmt = db.prepare(`INSERT INTO budgets(tenant_id, budget_key, tokens, cost_eur, calls, reserved_tokens, reserved_cost_eur, updated_at)
    VALUES (?, ?, 0, 0, 0, 0, 0, ?)
    ON CONFLICT(tenant_id, budget_key) DO NOTHING`);
  const addReservedStmt = db.prepare(`UPDATE budgets SET
      reserved_tokens = reserved_tokens + ?,
      reserved_cost_eur = reserved_cost_eur + ?,
      updated_at = ?
    WHERE tenant_id = ? AND budget_key = ?`);
  const releaseReservedStmt = db.prepare(`UPDATE budgets SET
      reserved_tokens = reserved_tokens - ?,
      reserved_cost_eur = reserved_cost_eur - ?,
      updated_at = ?
    WHERE tenant_id = ? AND budget_key = ?`);
  const settleStmt = db.prepare(`UPDATE budgets SET
      reserved_tokens = reserved_tokens - ?,
      reserved_cost_eur = reserved_cost_eur - ?,
      tokens = tokens + ?,
      cost_eur = cost_eur + ?,
      calls = calls + 1,
      updated_at = ?
    WHERE tenant_id = ? AND budget_key = ?`);
  const insertReservationStmt = db.prepare(`INSERT INTO budget_reservations(
      reservation_id, tenant_id, budget_key, tokens, cost_eur, state, created_at, updated_at, settled_tokens, settled_cost_eur, idempotency_key)
    VALUES (?, ?, ?, ?, ?, 'held', ?, ?, 0, 0, ?)`);
  const getReservationStmt = db.prepare("SELECT * FROM budget_reservations WHERE reservation_id = ?");
  const finishReservationStmt = db.prepare(`UPDATE budget_reservations SET
      state = ?, settled_tokens = ?, settled_cost_eur = ?, updated_at = ?
    WHERE reservation_id = ?`);
  const listReservationsStmt = db.prepare("SELECT * FROM budget_reservations WHERE tenant_id = ? AND budget_key = ? ORDER BY created_at DESC");

  function toRecord(row) {
    if (!row) return null;
    return {
      tenantId: row.tenant_id,
      key: row.budget_key,
      tokens: row.tokens,
      costEur: row.cost_eur,
      calls: row.calls,
      ceilingTokens: row.ceiling_tokens,
      ceilingCostEur: row.ceiling_cost_eur,
      reservedTokens: row.reserved_tokens,
      reservedCostEur: row.reserved_cost_eur,
      updatedAt: row.updated_at,
    };
  }

  function toReservation(row) {
    if (!row) return null;
    return {
      reservationId: row.reservation_id,
      tenantId: row.tenant_id,
      key: row.budget_key,
      tokens: row.tokens,
      costEur: row.cost_eur,
      state: row.state,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      settledTokens: row.settled_tokens,
      settledCostEur: row.settled_cost_eur,
      idempotencyKey: row.idempotency_key ?? null,
    };
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
    setCostCeiling(tenantId, key, ceilingCostEur) {
      const at = new Date(clock()).toISOString();
      db.transaction(() => ceilingCostStmt.run(normalizeTenantId(tenantId), key, ceilingCostEur ?? null, at));
      return this.get(tenantId, key);
    },
    /**
     * Atomisk forbrug uden reservation (bagudkompatibelt). Loftet kontrolleres
     * mod både forbrug og reserveret forbrug, så et direkte `consume` ikke kan
     * stjæle det en igangværende reservation holder.
     */
    consume(tenantId, key, { tokens = 0, costEur = 0, calls = 1 } = {}) {
      const tenant = normalizeTenantId(tenantId);
      const at = new Date(clock()).toISOString();
      return db.transaction(() => {
        const current = toRecord(getStmt.get(tenant, key));
        const nextTokens = (current?.tokens ?? 0) + tokens;
        const nextCost = (current?.costEur ?? 0) + costEur;
        if (current?.ceilingTokens !== null && current?.ceilingTokens !== undefined && nextTokens + (current?.reservedTokens ?? 0) > current.ceilingTokens) {
          return { ok: false, exceeded: true, ceilingTokens: current.ceilingTokens, attemptedTokens: nextTokens, record: current };
        }
        if (current?.ceilingCostEur !== null && current?.ceilingCostEur !== undefined && nextCost + (current?.reservedCostEur ?? 0) > current.ceilingCostEur) {
          return { ok: false, exceeded: true, ceilingCostEur: current.ceilingCostEur, attemptedCostEur: nextCost, record: current };
        }
        upsertStmt.run(tenant, key, tokens, costEur, calls, at);
        return { ok: true, exceeded: false, record: toRecord(getStmt.get(tenant, key)) };
      });
    },
    /**
     * Atomisk reservation. Returnerer `{ ok: false, exceeded: true }` hvis
     * loftet ville blive overskredet; intet skrives i så fald. `ceilingTokens`
     * og `ceilingCostEur` sættes samtidig (serverstyret route-loft), så den
     * samme transaktion både konfigurerer og håndhæver budgettet.
     */
    reserve(tenantId, key, { tokens = 0, costEur = 0, reservationId, idempotencyKey = null, ceilingTokens, ceilingCostEur } = {}) {
      if (!reservationId) throw new BudgetError("reserve kræver et reservationId");
      const tenant = normalizeTenantId(tenantId);
      const at = new Date(clock()).toISOString();
      return db.transaction(() => {
        ensureStmt.run(tenant, key, at);
        if (ceilingTokens !== undefined) ceilingStmt.run(tenant, key, ceilingTokens ?? null, at);
        if (ceilingCostEur !== undefined) ceilingCostStmt.run(tenant, key, ceilingCostEur ?? null, at);
        const current = toRecord(getStmt.get(tenant, key));
        const nextReservedTokens = (current?.reservedTokens ?? 0) + tokens;
        const nextReservedCost = (current?.reservedCostEur ?? 0) + costEur;
        if (current?.ceilingTokens !== null && current?.ceilingTokens !== undefined && current.tokens + nextReservedTokens > current.ceilingTokens) {
          return { ok: false, exceeded: true, reservationId, ceilingTokens: current.ceilingTokens, availableTokens: Math.max(0, current.ceilingTokens - current.tokens - (current.reservedTokens ?? 0)), record: current };
        }
        if (current?.ceilingCostEur !== null && current?.ceilingCostEur !== undefined && current.costEur + nextReservedCost > current.ceilingCostEur) {
          return { ok: false, exceeded: true, reservationId, ceilingCostEur: current.ceilingCostEur, availableCostEur: Math.max(0, current.ceilingCostEur - current.costEur - (current.reservedCostEur ?? 0)), record: current };
        }
        insertReservationStmt.run(reservationId, tenant, key, tokens, costEur, at, at, idempotencyKey);
        addReservedStmt.run(tokens, costEur, at, tenant, key);
        return { ok: true, exceeded: false, reservation: toReservation(getReservationStmt.get(reservationId)), record: toRecord(getStmt.get(tenant, key)) };
      });
    },
    /**
     * Afregn en reservation med det faktiske forbrug. Reserven frigives i
     * samme transaktion. Et faktisk forbrug større end reservationen bogføres
     * alligevel (med `overage: true`), så forbrug aldrig underskrives.
     */
    settle(reservationId, { tokens = 0, costEur = 0 } = {}) {
      const at = new Date(clock()).toISOString();
      return db.transaction(() => {
        const reservation = getReservationStmt.get(reservationId);
        if (!reservation) return { ok: false, reason: "not-found", reservationId };
        if (reservation.state !== "held") return { ok: false, reason: `already-${reservation.state}`, reservation: toReservation(reservation) };
        const overage = tokens > reservation.tokens || costEur > reservation.cost_eur;
        settleStmt.run(reservation.tokens, reservation.cost_eur, tokens, costEur, at, reservation.tenant_id, reservation.budget_key);
        finishReservationStmt.run("settled", tokens, costEur, at, reservationId);
        return { ok: true, state: "settled", overage, reservation: toReservation(getReservationStmt.get(reservationId)), record: toRecord(getStmt.get(reservation.tenant_id, reservation.budget_key)) };
      });
    },
    /** Frigiv en reservation uden forbrug (timeout, afbrudt kald, leverandørfejl). */
    release(reservationId, { reason = null } = {}) {
      const at = new Date(clock()).toISOString();
      return db.transaction(() => {
        const reservation = getReservationStmt.get(reservationId);
        if (!reservation) return { ok: false, reason: "not-found", reservationId };
        if (reservation.state !== "held") return { ok: false, reason: `already-${reservation.state}`, reservation: toReservation(reservation) };
        releaseReservedStmt.run(reservation.tokens, reservation.cost_eur, at, reservation.tenant_id, reservation.budget_key);
        finishReservationStmt.run("released", 0, 0, at, reservationId);
        return { ok: true, state: "released", reason, reservation: toReservation(getReservationStmt.get(reservationId)), record: toRecord(getStmt.get(reservation.tenant_id, reservation.budget_key)) };
      });
    },
    getReservation(reservationId) {
      return toReservation(getReservationStmt.get(reservationId));
    },
    listReservations(tenantId, key) {
      return listReservationsStmt.all(normalizeTenantId(tenantId), key).map(toReservation);
    },
    /** Læs alle budgetter for tenanten. */
    list(tenantId) {
      return db
        .all("SELECT tenant_id, budget_key, tokens, cost_eur, calls, ceiling_tokens, ceiling_cost_eur, reserved_tokens, reserved_cost_eur, updated_at FROM budgets WHERE tenant_id = ? ORDER BY budget_key", normalizeTenantId(tenantId))
        .map(toRecord);
    },
  };
}
