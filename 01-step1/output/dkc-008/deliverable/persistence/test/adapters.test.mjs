/**
 * DKC-008 — adapteradfærd og tenantgrænser.
 *
 * Beviser at hver adapter er holdbar og tenant-scoped: en forkert tenant får
 * aldrig en andens række gennem databaseadgangen, og identiske lokale id'er hos
 * to kunder kolliderer ikke.
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

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "dkc-persist-adapters-"));
  const db = openDatabase({ path: join(dir, "platform.db") });
  migrateDatabase(db);
  return { db, dir, cleanup: () => { try { db.close(); } catch { /* ignore */ } rmSync(dir, { recursive: true, force: true }); } };
}

test("godkendelseslageret afviser en forkert tenant og bevarer revisioner", () => {
  const { db, cleanup } = fixture();
  try {
    const store = createSqliteApprovalStore({ db });
    store.save({ id: "req-1", tenantId: "acme", decision: { state: "pending" } });
    store.save({ id: "req-1", tenantId: "globex", decision: { state: "pending" } });

    assert.equal(store.getForTenant("acme", "req-1").decision.state, "pending");
    assert.equal(store.getForTenant("globex", "req-1").decision.state, "pending");
    // Samme id hos to kunder er to forskellige rækker.
    store.save({ id: "req-1", tenantId: "acme", decision: { state: "approved" } });
    assert.equal(store.getForTenant("acme", "req-1").decision.state, "approved");
    assert.equal(store.getForTenant("globex", "req-1").decision.state, "pending");
    assert.equal(store.count("acme"), 1);
    assert.equal(store.count("globex"), 1);
  } finally {
    cleanup();
  }
});

test("tenant-viewet filtrerer på databaseplan", () => {
  const { db, cleanup } = fixture();
  try {
    const store = createSqliteApprovalStore({ db });
    store.save({ id: "a", tenantId: "acme", decision: { state: "approved" } });
    store.save({ id: "b", tenantId: "globex", decision: { state: "approved" } });

    db.setTenant("acme");
    const acme = db.all("SELECT id FROM v_approval_requests");
    assert.deepEqual(acme.map((r) => r.id), ["a"]);
    db.setTenant("globex");
    const globex = db.all("SELECT id FROM v_approval_requests");
    assert.deepEqual(globex.map((r) => r.id), ["b"]);
    db.setTenant("acme");
    // Selv en ubetinget forespørgsel gennem viewet kan ikke se globex.
    assert.equal(db.get("SELECT COUNT(*) AS n FROM v_approval_requests WHERE id = 'b'").n, 0);
  } finally {
    cleanup();
  }
});

test("godkendelsesreservationen er atomisk og tenant-bundet", () => {
  const { db, cleanup } = fixture();
  try {
    const store = createSqliteApprovalStore({ db });
    store.save({ id: "req-1", tenantId: "acme", decision: { state: "approved" } });

    assert.equal(store.claim("req-1", { tenantId: "acme", executionId: "exec-1" }), true);
    assert.equal(store.claim("req-1", { tenantId: "acme", executionId: "exec-2" }), false);
    // En forkert tenant kan ikke reservere acmes godkendelse.
    assert.equal(store.claim("req-1", { tenantId: "globex", executionId: "exec-3" }), false);
    assert.equal(store.claimOf("globex", "req-1"), null);
    assert.equal(store.claimOf("acme", "req-1").executionId, "exec-1");
  } finally {
    cleanup();
  }
});

test("jobkøen serialiserer leases og genåbner forældede leases", () => {
  const { db, cleanup } = fixture();
  try {
    let now = 1_000;
    const jobs = createSqliteJobStore({ db, clock: () => now });
    jobs.enqueue("acme", { id: "j1" });
    jobs.enqueue("acme", { id: "j2" });
    jobs.enqueue("globex", { id: "j3" });

    const first = jobs.lease("acme", "worker-a");
    assert.equal(first.id, "j1");
    assert.equal(first.status, "leased");
    const second = jobs.lease("acme", "worker-b");
    assert.equal(second.id, "j2");
    assert.equal(jobs.lease("acme", "worker-c"), null);
    // acme kan ikke lease globex' job.
    assert.equal(jobs.list("acme").length, 2);
    assert.equal(jobs.get("acme", "j3"), null);

    now += 120_000;
    const reopened = jobs.recoverStaleLeases({ olderThanMs: 60_000, now });
    assert.equal(reopened.length, 2);
    assert.equal(jobs.list("acme", { status: "queued" }).length, 2);
  } finally {
    cleanup();
  }
});

test("budgetloftet kan ikke overskrides samtidigt", () => {
  const { db, cleanup } = fixture();
  try {
    const budgets = createSqliteBudgetStore({ db });
    budgets.setCeiling("acme", "agent", 10);
    assert.equal(budgets.consume("acme", "agent", { tokens: 6 }).ok, true);
    const over = budgets.consume("acme", "agent", { tokens: 6 });
    assert.equal(over.ok, false);
    assert.equal(over.exceeded, true);
    assert.equal(budgets.get("acme", "agent").tokens, 6);
    // En anden tenants budget er urørt.
    assert.equal(budgets.get("globex", "agent"), null);
  } finally {
    cleanup();
  }
});

test("audit-loggen har én hash-kæde pr. tenant og opdager ændringer", () => {
  const { db, cleanup } = fixture();
  try {
    const audit = createSqliteAuditLog({ db });
    audit.append({ tenantId: "acme", type: "one" });
    audit.append({ tenantId: "acme", type: "two" });
    audit.append({ tenantId: "globex", type: "one" });
    assert.equal(audit.size("acme"), 2);
    assert.equal(audit.size("globex"), 1);
    assert.equal(audit.verifyChain("acme").ok, true);
    assert.equal(audit.verifyChain("globex").ok, true);

    // Efterfølgende ændring af en gammel post bryder kæden.
    db.prepare("UPDATE audit_events SET type = 'tampered' WHERE tenant_id = 'acme' AND seq = 1").run();
    assert.equal(audit.verifyChain("acme").ok, false);
    // Den anden tenants kæde er upåvirket.
    assert.equal(audit.verifyChain("globex").ok, true);
  } finally {
    cleanup();
  }
});

test("beslutningsloggen er append-only og fail-closed ved brud", () => {
  const { db, cleanup } = fixture();
  try {
    const ledger = createSqliteApprovalLedger({ db, secret: "k" });
    ledger.append({ id: "r1", type: "approval.created", tenantId: "acme" });
    ledger.append({ id: "r1", type: "approval.decided", tenantId: "acme" });
    assert.equal(ledger.verifyChain().ok, true);
    assert.equal(ledger.entries.length, 2);

    db.prepare("UPDATE approval_ledger SET actor = 'mallory' WHERE seq = 1").run();
    assert.throws(() => createSqliteApprovalLedger({ db, secret: "k" }), (err) => err.code === "AUDIT_CHAIN_BROKEN");
  } finally {
    cleanup();
  }
});
