/**
 * DKC-008 — genstart mister ingen committed tilstand.
 *
 * Hver test lukker forbindelsen (som et procesnedbrud) og åbner den samme fil
 * igen. Godkendelser, jobtilstand, budgetter og audit skal være intakte.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../src/db.mjs";
import { migrateDatabase } from "../src/identities.mjs";
import { createSqliteApprovalStore } from "../src/adapters/approvals.mjs";
import { createSqliteApprovalLedger } from "../src/adapters/approval-ledger.mjs";
import { createSqliteJobStore } from "../src/adapters/jobs.mjs";
import { createSqliteBudgetStore } from "../src/adapters/budgets.mjs";
import { createSqliteAuditLog } from "../src/adapters/audit.mjs";

function withDb(dir, fn) {
  const db = openDatabase({ path: join(dir, "state.db") });
  migrateDatabase(db);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

test("godkendelser, jobs, budgetter og audit overlever genstart", () => {
  const dir = mkdtempSync(join(tmpdir(), "dkc-persist-restart-"));
  try {
    // Første "proces".
    withDb(dir, (db) => {
      const store = createSqliteApprovalStore({ db });
      store.save({ id: "req-1", tenantId: "acme", decision: { state: "approved" } });
      store.claim("req-1", { tenantId: "acme", executionId: "exec-1" });

      const ledger = createSqliteApprovalLedger({ db, secret: "k" });
      ledger.append({ id: "req-1", type: "approval.created", tenantId: "acme" });
      ledger.append({ id: "req-1", type: "approval.decided", tenantId: "acme" });

      const jobs = createSqliteJobStore({ db });
      jobs.enqueue("acme", { id: "job-1", kind: "backup" });
      const leased = jobs.lease("acme", "worker-1");
      jobs.saveState("acme", leased.id, { status: "running", state: { step: 1 } });

      const budgets = createSqliteBudgetStore({ db });
      budgets.consume("acme", "agent", { tokens: 100, costEur: 2.5 });

      const audit = createSqliteAuditLog({ db });
      audit.append({ tenantId: "acme", type: "job.running" });
    });

    // Anden "proces" oven på samme fil.
    withDb(dir, (db) => {
      const store = createSqliteApprovalStore({ db });
      const restored = store.getForTenant("acme", "req-1");
      assert.equal(restored.decision.state, "approved");
      assert.equal(store.claimOf("acme", "req-1").executionId, "exec-1");

      const ledger = createSqliteApprovalLedger({ db, secret: "k" });
      assert.equal(ledger.verifyChain().ok, true);
      assert.equal(ledger.entries.length, 2);

      const jobs = createSqliteJobStore({ db });
      const job = jobs.get("acme", "job-1");
      assert.equal(job.status, "running");
      assert.deepEqual(job.result, { step: 1 });

      const budgets = createSqliteBudgetStore({ db });
      assert.equal(budgets.get("acme", "agent").tokens, 100);
      assert.equal(budgets.get("acme", "agent").costEur, 2.5);

      const audit = createSqliteAuditLog({ db });
      assert.equal(audit.size("acme"), 1);
      assert.equal(audit.verifyChain("acme").ok, true);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("et committet job er ikke tabt, og en forældet lease kan genoptages", () => {
  const dir = mkdtempSync(join(tmpdir(), "dkc-persist-restart-lease-"));
  try {
    let now = 1_000;
    withDb(dir, (db) => {
      const jobs = createSqliteJobStore({ db, clock: () => now });
      jobs.enqueue("acme", { id: "job-1" });
      jobs.enqueue("acme", { id: "job-2" });
      jobs.lease("acme", "worker-1");
    });
    now += 120_000;
    withDb(dir, (db) => {
      const jobs = createSqliteJobStore({ db, clock: () => now });
      // Efter "nedbrud": begge jobs er enten leased eller queued og kan leases igen.
      const reopened = jobs.recoverStaleLeases({ olderThanMs: 60_000, now });
      assert.equal(reopened.length, 1);
      assert.equal(jobs.list("acme", { status: "queued" }).length, 2);
      const a = jobs.lease("acme", "worker-2");
      const b = jobs.lease("acme", "worker-2");
      assert.equal(new Set([a.id, b.id]).size, 2);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
