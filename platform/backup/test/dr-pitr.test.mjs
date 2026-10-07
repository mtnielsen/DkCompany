import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../persistence/src/index.mjs";
import {
  aclAsOf,
  createWalArchive,
  pitrReconciliationProblems,
  planPointInTimeRecovery,
  reconcileAcl,
  recoverToPointInTime,
} from "../src/dr/pitr.mjs";

const BASE_AT = "2026-09-20T02:00:00Z";

function seed(path) {
  const db = openDatabase({ path: path ?? ":memory:" });
  db.exec("CREATE TABLE acl_entries(subject TEXT PRIMARY KEY, role TEXT, updated_at TEXT)");
  db.exec("CREATE TABLE recovery_data(id INTEGER PRIMARY KEY, tenant_id TEXT, value TEXT, at TEXT)");
  db.run("INSERT INTO acl_entries(subject, role, updated_at) VALUES (?, ?, ?)", "oidc|anna.andersen", "platform-owner", BASE_AT);
  db.run("INSERT INTO recovery_data(id, tenant_id, value, at) VALUES (?, ?, ?, ?)", 1, "acme", "a", BASE_AT);
  db.run("INSERT INTO recovery_data(id, tenant_id, value, at) VALUES (?, ?, ?, ?)", 2, "acme", "b", BASE_AT);
  return db;
}

function archive(dir) {
  const wal = createWalArchive({ dir, engine: "postgresql" });
  wal.append({ at: "2026-09-20T02:01:00Z", tenantId: "acme", table: "recovery_data", sql: "INSERT INTO recovery_data(id, tenant_id, value, at) VALUES (?, ?, ?, ?)", params: [3, "acme", "c", "2026-09-20T02:01:00Z"] });
  wal.append({ at: "2026-09-20T02:02:00Z", tenantId: "acme", table: "recovery_data", sql: "INSERT INTO recovery_data(id, tenant_id, value, at) VALUES (?, ?, ?, ?)", params: [4, "acme", "d", "2026-09-20T02:02:00Z"] });
  wal.append({ at: "2026-09-20T02:04:00Z", tenantId: "acme", kind: "acl", table: "acl_entries", sql: "INSERT INTO acl_entries(subject, role, updated_at) VALUES (?, ?, ?)", params: ["oidc|cont.officer", "continuity-officer", "2026-09-20T02:04:00Z"] });
  return wal;
}

async function withWork(fn) {
  const dir = mkdtempSync(join(tmpdir(), "dkc-dr-pitr-"));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("WAL-arkivet er append-only og hash-kædet", () => {
  withWork((dir) => {
    const wal = archive(dir);
    assert.equal(wal.verify().ok, true);
    assert.equal(wal.count(), 3);
    assert.equal(wal.entriesUpTo("2026-09-20T02:02:30Z").length, 2);
    // Ændring af en post opdages.
    appendFileSync(wal.path, JSON.stringify({ seq: 4, at: "2026-09-20T02:05:00Z", sql: "SELECT 1", prevHash: "deadbeef", hash: "deadbeef" }) + "\n");
    assert.equal(wal.verify().ok, false);
  });
});

test("PITR vælger den nyeste base før det valgte tidspunkt", () => {
  withWork((dir) => {
    const wal = archive(dir);
    const plan = planPointInTimeRecovery({
      baseBackups: [{ id: "b1", at: "2026-09-20T01:00:00Z" }, { id: "b2", at: "2026-09-20T02:00:00Z" }],
      walArchive: wal,
      targetTime: "2026-09-20T02:02:30Z",
      recoveryWindowHours: 24,
    });
    assert.equal(plan.baseBackupId, "b2");
    assert.equal(plan.appliedSegments, 2);
    assert.equal(plan.lastAppliedAt, "2026-09-20T02:02:00.000Z");
  });
});

test("rekonstruktion rammer det valgte tidspunkt og afstemmer data og ACL", async () => {
  await withWork(async (dir) => {
    const wal = archive(dir);
    const baseDb = seed(join(dir, "base.db"));
    const report = await recoverToPointInTime({
      baseDb,
      baseBackupId: "b2",
      baseBackupAt: BASE_AT,
      walArchive: wal,
      targetTime: "2026-09-20T02:02:30Z",
      destDir: join(dir, "recovered"),
      baseAcl: { "oidc|anna.andersen": "platform-owner" },
      quiescence: { quiesced: true, includes: ["database", "config"], maxPauseSeconds: 30 },
      recoveryWindowHours: 24,
    });
    baseDb.close();
    assert.equal(report.kind, "PitrReconciliation");
    assert.equal(report.status, "pass", JSON.stringify(report.reasons));
    assert.equal(report.data.rowCounts.recovery_data, 4);
    assert.equal(report.acl.reconciled, true);
    assert.deepEqual(report.acl.actual, { "oidc|anna.andersen": "platform-owner" });
    assert.deepEqual(pitrReconciliationProblems(report), []);
  });
});

test("ACL-afvigelse giver en blocked PITR", async () => {
  await withWork(async (dir) => {
    const wal = archive(dir);
    const baseDb = seed(join(dir, "base.db"));
    const report = await recoverToPointInTime({
      baseDb,
      baseBackupId: "b2",
      baseBackupAt: BASE_AT,
      walArchive: wal,
      targetTime: "2026-09-20T02:02:30Z",
      destDir: join(dir, "recovered"),
      expectedAcl: { "oidc|anna.andersen": "viewer" },
      quiescence: { quiesced: true, includes: ["database", "config"], maxPauseSeconds: 30 },
    });
    baseDb.close();
    assert.equal(report.status, "blocked");
    assert.equal(report.acl.reconciled, false);
    assert.ok(report.reasons.some((r) => /ACL/.test(r)));
    assert.deepEqual(pitrReconciliationProblems(report), []);
  });
});

test("et fremtidigt tidspunkt afvises", () => {
  withWork((dir) => {
    const wal = archive(dir);
    assert.throws(() => planPointInTimeRecovery({ baseBackups: [{ id: "b2", at: BASE_AT }], walArchive: wal, targetTime: "2999-01-01T00:00:00Z" }), /fremtiden/);
  });
});

test("aclAsOf og reconcileAcl rekonstruerer den forventede matrix", () => {
  withWork((dir) => {
    const wal = archive(dir);
    const asOfBefore = aclAsOf({ baseAcl: { "oidc|anna.andersen": "platform-owner" }, walArchive: wal, baseAt: BASE_AT, targetTime: "2026-09-20T02:02:30Z" });
    assert.equal(asOfBefore["oidc|cont.officer"], undefined);
    const asOfAfter = aclAsOf({ baseAcl: { "oidc|anna.andersen": "platform-owner" }, walArchive: wal, baseAt: BASE_AT, targetTime: "2026-09-20T02:05:00Z" });
    assert.equal(asOfAfter["oidc|cont.officer"], "continuity-officer");
    const db = openDatabase({ path: ":memory:" });
    db.exec("CREATE TABLE acl_entries(subject TEXT PRIMARY KEY, role TEXT)");
    db.run("INSERT INTO acl_entries VALUES (?, ?)", "oidc|anna.andersen", "platform-owner");
    assert.equal(reconcileAcl({ db, expected: { "oidc|anna.andersen": "platform-owner" } }).reconciled, true);
    assert.equal(reconcileAcl({ db, expected: { "oidc|anna.andersen": "viewer" } }).reconciled, false);
    db.close();
  });
});
