/**
 * DKC-012 — atomiske budgetreservationer og holdbar idempotens.
 *
 * Beviser at to samtidige kald ikke kan bruge den samme resterende budgetpost,
 * at timeout/afbrudte kald frigiver reservationen igen, og at en gentaget
 * idempotency-nøgle hverken kalder budgettet eller gemmer persondata to gange.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../src/db.mjs";
import { createMigrator } from "../src/migrations.mjs";
import { createSqliteBudgetStore } from "../src/adapters/budgets.mjs";
import { createSqliteGatewayCallStore } from "../src/adapters/gateway-calls.mjs";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "dkc-budget-reservations-"));
  const db = openDatabase({ path: join(dir, "budget.db") });
  createMigrator({ db }).apply();
  return { db, dir, cleanup: () => { try { db.close(); } catch { /* ignore */ } rmSync(dir, { recursive: true, force: true }); } };
}

test("en reservation holder budgettet og frigives ved settle", () => {
  const { db, cleanup } = fixture();
  try {
    const budgets = createSqliteBudgetStore({ db });
    const first = budgets.reserve("acme", "route-a", { tokens: 60, costEur: 0.6, reservationId: "r1", ceilingTokens: 100, ceilingCostEur: 1 });
    assert.equal(first.ok, true);
    assert.equal(first.record.reservedTokens, 60);
    assert.equal(budgets.get("acme", "route-a").tokens, 0, "forbrug bogføres først ved settle");

    // Den resterende mængde er nu 40; et nyt kald på 60 må ikke slippe igennem.
    const second = budgets.reserve("acme", "route-a", { tokens: 60, costEur: 0.6, reservationId: "r2", ceilingTokens: 100, ceilingCostEur: 1 });
    assert.equal(second.ok, false);
    assert.equal(second.exceeded, true);
    assert.equal(second.availableTokens, 40);

    const settled = budgets.settle("r1", { tokens: 12, costEur: 0.12 });
    assert.equal(settled.ok, true);
    const record = budgets.get("acme", "route-a");
    assert.equal(record.tokens, 12);
    assert.equal(record.calls, 1);
    assert.equal(record.reservedTokens, 0, "reservationen skal være frigivet");
    assert.equal(record.reservedCostEur, 0);
    assert.equal(budgets.getReservation("r1").state, "settled");
  } finally {
    cleanup();
  }
});

test("release frigiver hele reservationen (timeout/afbrudt)", () => {
  const { db, cleanup } = fixture();
  try {
    const budgets = createSqliteBudgetStore({ db });
    budgets.reserve("acme", "route-a", { tokens: 90, costEur: 0.9, reservationId: "r1", ceilingTokens: 100, ceilingCostEur: 1 });
    budgets.release("r1", { reason: "timeout" });
    assert.equal(budgets.get("acme", "route-a").reservedTokens, 0);
    assert.equal(budgets.get("acme", "route-a").tokens, 0);
    assert.equal(budgets.getReservation("r1").state, "released");
    // Budgettet er igen fuldt tilgængeligt.
    const again = budgets.reserve("acme", "route-a", { tokens: 100, costEur: 1, reservationId: "r2", ceilingTokens: 100, ceilingCostEur: 1 });
    assert.equal(again.ok, true);
  } finally {
    cleanup();
  }
});

test("to samtidige kald kan ikke bruge samme resterende budget", async () => {
  const { db, cleanup } = fixture();
  try {
    const budgets = createSqliteBudgetStore({ db });
    // Simulér to workers der reserverer i hver sin mikrotask tæt efter hinanden.
    const reserve = (id, tokens) =>
      new Promise((resolve) => setImmediate(() => resolve(budgets.reserve("acme", "route-a", { tokens, costEur: tokens / 100, reservationId: id, ceilingTokens: 100, ceilingCostEur: 1 }))));
    const [a, b] = await Promise.all([reserve("r1", 60), reserve("r2", 60)]);
    const okCount = [a, b].filter((r) => r.ok).length;
    assert.equal(okCount, 1, "kun ét af to samtidige kald må reservere");
    assert.equal(budgets.get("acme", "route-a").reservedTokens, 60);
  } finally {
    cleanup();
  }
});

test("idempotens: replay uden dobbeltforbrug, konflikt ved andet indhold", () => {
  const { db, cleanup } = fixture();
  try {
    const calls = createSqliteGatewayCallStore({ db });
    const route = { id: "route-a", provider: "anthropic", model: "claude", modelVersion: "1" };
    const first = calls.claim({ tenantId: "acme", idempotencyKey: "k1", requestDigest: "d1", route, dataClass: "internal" });
    assert.equal(first.status, "new");
    const inFlight = calls.claim({ tenantId: "acme", idempotencyKey: "k1", requestDigest: "d1", route, dataClass: "internal" });
    assert.equal(inFlight.status, "in-flight");
    calls.settle({ tenantId: "acme", idempotencyKey: "k1", tokens: 10, costEur: 0.1, response: { text: "hej" }, dataClass: "internal" });
    const replay = calls.claim({ tenantId: "acme", idempotencyKey: "k1", requestDigest: "d1", route, dataClass: "internal" });
    assert.equal(replay.status, "replay");
    assert.equal(replay.record.response.text, "hej");
    const conflict = calls.claim({ tenantId: "acme", idempotencyKey: "k1", requestDigest: "d2", route, dataClass: "internal" });
    assert.equal(conflict.status, "conflict");
  } finally {
    cleanup();
  }
});

test("personhenførbar dataklasse gemmer ikke rå modeltekst", () => {
  const { db, cleanup } = fixture();
  try {
    const calls = createSqliteGatewayCallStore({ db });
    const route = { id: "route-p", provider: "anthropic", model: "claude", modelVersion: "1" };
    calls.claim({ tenantId: "acme", idempotencyKey: "p1", requestDigest: "d1", route, dataClass: "personal" });
    calls.settle({ tenantId: "acme", idempotencyKey: "p1", tokens: 5, costEur: 0.05, response: { text: "Kunde: kunde@example.org" }, dataClass: "personal" });
    const record = calls.get("acme", "p1");
    assert.equal(record.response, null, "rå personaldata må ikke gemmes som standard");
    assert.equal(record.tokens, 5);
  } finally {
    cleanup();
  }
});
