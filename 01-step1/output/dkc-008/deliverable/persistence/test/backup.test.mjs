/**
 * DKC-008 — backup og gendannelse er afprøvet.
 *
 * En konsistent backup tages, målet ødelægges, og gendannelsen verificeres mod
 * integritet og rækkeantal. En korrupt eller ufuldstændig backup afvises.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../src/db.mjs";
import { migrateDatabase } from "../src/identities.mjs";
import { backupDatabase, restoreDatabase, tableCounts, exerciseBackupRestore } from "../src/backup.mjs";
import { createSqliteApprovalStore } from "../src/adapters/approvals.mjs";
import { createSqliteAuditLog } from "../src/adapters/audit.mjs";

function seed(db) {
  const store = createSqliteApprovalStore({ db });
  store.save({ id: "r1", tenantId: "acme", decision: { state: "approved" } });
  store.save({ id: "r2", tenantId: "globex", decision: { state: "pending" } });
  const audit = createSqliteAuditLog({ db });
  audit.append({ tenantId: "acme", type: "created" });
  audit.append({ tenantId: "acme", type: "decided" });
}

test("backup kan gendannes og verificeres mod rækkeantal", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dkc-persist-backup-"));
  const dbPath = join(dir, "live.db");
  try {
    const db = openDatabase({ path: dbPath });
    migrateDatabase(db);
    seed(db);
    const before = tableCounts(db);

    const backupPath = join(dir, "snapshots", "live.db");
    const taken = await backupDatabase(db, backupPath);
    assert.ok(taken.pages > 0);
    assert.ok(existsSync(backupPath));

    // Ødelæg den kørende database efter backup.
    db.exec("DELETE FROM approval_requests");
    db.exec("DELETE FROM audit_events");
    db.close();
    assert.equal(tableCounts(openDatabase({ path: dbPath, readOnly: true })).approval_requests, 0);

    const restored = await restoreDatabase({ backupPath, targetPath: dbPath, expectedCounts: before });
    assert.equal(restored.ok, true);
    assert.equal(restored.integrity, "ok");
    assert.equal(restored.counts.approval_requests, before.approval_requests);
    assert.equal(restored.counts.audit_events, before.audit_events);

    const verify = openDatabase({ path: dbPath, readOnly: true });
    assert.equal(verify.get("SELECT COUNT(*) AS n FROM approval_requests").n, 2);
    verify.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("gendannelse afvises hvis backupen ikke matcher forventningen", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dkc-persist-backup-mismatch-"));
  try {
    const db = openDatabase({ path: join(dir, "live.db") });
    migrateDatabase(db);
    seed(db);
    const backupPath = join(dir, "snap.db");
    await backupDatabase(db, backupPath);
    db.close();

    await assert.rejects(
      () => restoreDatabase({ backupPath, targetPath: join(dir, "target.db"), expectedCounts: { approval_requests: 99 } }),
      /backup-verifikation fejlede/
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("backup/gendannelsesøvelse kører mod flere databaser", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dkc-persist-exercise-"));
  try {
    const approvalsDb = openDatabase({ path: join(dir, "approvals.db") });
    const auditDb = openDatabase({ path: join(dir, "audit.db") });
    migrateDatabase(approvalsDb);
    migrateDatabase(auditDb);
    createSqliteApprovalStore({ db: approvalsDb }).save({ id: "r1", tenantId: "acme", decision: { state: "pending" } });
    createSqliteAuditLog({ db: auditDb }).append({ tenantId: "acme", type: "created" });

    const report = await exerciseBackupRestore({
      databases: { approvals: approvalsDb, audit: auditDb },
      backupDir: join(dir, "backups"),
      targetDir: join(dir, "restored"),
    });
    assert.equal(report.approvals.ok, true);
    assert.equal(report.audit.ok, true);
    assert.equal(report.approvals.counts.approval_requests, 1);
    assert.equal(report.audit.counts.audit_events, 1);
    approvalsDb.close();
    auditDb.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
