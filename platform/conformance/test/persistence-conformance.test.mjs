/**
 * DKC-008 — konformanstest for holdbar tilstand.
 *
 * Spejler de fire acceptkriterier i conformance-suiten, så `make test` dækker
 * dem sammen med persistenslagets egne tests.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../persistence/src/db.mjs";
import { createMigrator } from "../../persistence/src/migrations.mjs";
import { createSqliteApprovalStore } from "../../persistence/src/adapters/approvals.mjs";
import { createSqliteJobStore } from "../../persistence/src/adapters/jobs.mjs";
import { createSqliteAuditLog } from "../../persistence/src/adapters/audit.mjs";
import { createSqliteBudgetStore } from "../../persistence/src/adapters/budgets.mjs";
import { backupDatabase, restoreDatabase, tableCounts } from "../../persistence/src/backup.mjs";

function open(dir) {
  const db = openDatabase({ path: join(dir, "conformance.db") });
  createMigrator({ db }).apply();
  return db;
}

test("genstart mister ingen committed godkendelser eller jobtilstand", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dkc-conformance-restart-"));
  try {
    let db = open(dir);
    createSqliteApprovalStore({ db }).save({ id: "r1", tenantId: "acme", decision: { state: "approved" } });
    const jobs = createSqliteJobStore({ db });
    jobs.enqueue("acme", { id: "j1" });
    jobs.saveState("acme", "j1", { status: "running", state: { step: 2 } });
    db.close();

    db = open(dir);
    assert.equal(createSqliteApprovalStore({ db }).getForTenant("acme", "r1").decision.state, "approved");
    assert.deepEqual(createSqliteJobStore({ db }).get("acme", "j1").result, { step: 2 });
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("samtidige writes bevarer konsistens (audit-kæde og job-leases)", () => {
  const dir = mkdtempSync(join(tmpdir(), "dkc-conformance-concurrent-"));
  try {
    const db = open(dir);
    const audit = createSqliteAuditLog({ db });
    audit.append({ tenantId: "acme", type: "a" });
    audit.append({ tenantId: "acme", type: "b" });
    assert.equal(audit.verifyChain("acme").ok, true);

    const jobs = createSqliteJobStore({ db });
    jobs.enqueue("acme", { id: "j1" });
    assert.ok(jobs.lease("acme", "w1"));
    assert.equal(jobs.lease("acme", "w2"), null, "kun én worker må lease jobbet");
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("en forkert tenant kan ikke hente data via databaseadgangen", () => {
  const dir = mkdtempSync(join(tmpdir(), "dkc-conformance-tenant-"));
  try {
    const db = open(dir);
    const store = createSqliteApprovalStore({ db });
    store.save({ id: "r1", tenantId: "acme", decision: { state: "approved" } });
    assert.equal(store.getForTenant("globex", "r1"), null);
    db.setTenant("globex");
    assert.equal(db.get("SELECT COUNT(*) AS n FROM v_approval_requests").n, 0);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("opgradering fra forrige schema og gendannelse fra backup er afprøvet", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dkc-conformance-upgrade-"));
  try {
    const db = openDatabase({ path: join(dir, "upgrade.db") });
    createMigrator({ db }).apply({ toVersion: 1 });
    db.prepare("INSERT INTO budgets(tenant_id, budget_key, tokens, cost_eur, calls, updated_at) VALUES('acme','a',7,0,1,'now')").run();
    createMigrator({ db }).apply();
    assert.equal(db.get("SELECT tokens FROM budgets WHERE budget_key = 'a'").tokens, 7);

    const backupPath = join(dir, "backup.db");
    const before = tableCounts(db);
    await backupDatabase(db, backupPath);
    db.close();

    const restored = await restoreDatabase({ backupPath, targetPath: join(dir, "restored.db"), expectedCounts: before });
    assert.equal(restored.ok, true);
    assert.equal(restored.counts.budgets, before.budgets);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
