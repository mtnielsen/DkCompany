import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixture, PRINCIPALS, AT } from "./helpers.mjs";
import { importBatch, reconcile } from "../src/import.mjs";
import { recordApproval } from "../src/approval.mjs";
import { planCutover, executeCutover, rollbackCutover, MigrationCutoverError } from "../src/cutover.mjs";
import { FileMigrationStore } from "../src/store.mjs";

function withDirs(fn) {
  const snapshot = mkdtempSync(join(tmpdir(), "dkc031-cut-"));
  const restored = mkdtempSync(join(tmpdir(), "dkc031-restore-"));
  try {
    return fn(snapshot, restored);
  } finally {
    rmSync(snapshot, { recursive: true, force: true });
    rmSync(restored, { recursive: true, force: true });
  }
}

test("cutover blokeres uden en pilotgodkendelse", () => {
  withDirs((snapshot) => {
    const { store, sourceById, objectsFor, coverage, cleanup } = fixture();
    const source = sourceById("files-acme");
    importBatch({ store, source, objects: objectsFor(source), coverage, at: AT });
    const reconciliation = reconcile({ store, source, objects: objectsFor(source), coverage, at: AT });
    const plan = planCutover({ store, source, reconciliation, operatorSubject: PRINCIPALS.operator.id });
    assert.equal(plan.status, "blocked");
    assert.ok(plan.problems.some((p) => /godkendt/.test(p.message)));
    void snapshot;
    cleanup();
  });
});

test("cutover blokeres af en uafklaret dubletkonflikt", () => {
  const { store, sourceById, objectsFor, coverage, cleanup } = fixture();
  const source = sourceById("crm-acme");
  importBatch({ store, source, objects: objectsFor(source), coverage, at: AT });
  const reconciliation = reconcile({ store, source, objects: objectsFor(source), coverage, at: AT });
  const plan = planCutover({ store, source, reconciliation, operatorSubject: PRINCIPALS.operator.id });
  assert.equal(plan.status, "blocked");
  assert.ok(plan.problems.some((p) => /dublet/.test(p.message)));
  cleanup();
});

test("cutover er klar efter afstemning og godkendelse, og viser tabt funktionalitet", () => {
  const { store, sourceById, objectsFor, coverage, cleanup } = fixture();
  const source = sourceById("files-acme");
  importBatch({ store, source, objects: objectsFor(source), coverage, at: AT });
  recordApproval({ store, principal: PRINCIPALS.ada, tenantId: "acme", appId: "files", contentApproved: true, aclApproved: true, evidenceRef: "evidence://pilot/files", at: AT });
  const reconciliation = reconcile({ store, source, objects: objectsFor(source), coverage, at: AT });
  const plan = planCutover({ store, source, reconciliation, operatorSubject: PRINCIPALS.operator.id });
  assert.equal(plan.status, "ready");
  assert.ok(plan.coverageLosses.length >= 1);
  assert.ok(plan.rollback.steps.length >= 3);
  assert.equal(plan.rollback.restoresRights, true);
  cleanup();
});

test("cutover og rollback gendanner poster og rettigheder", () => {
  withDirs((snapshot, restored) => {
    const { store, sourceById, objectsFor, coverage, cleanup } = fixture();
    const source = sourceById("files-acme");
    importBatch({ store, source, objects: objectsFor(source), coverage, at: AT });
    recordApproval({ store, principal: PRINCIPALS.ada, tenantId: "acme", appId: "files", contentApproved: true, aclApproved: true, evidenceRef: "evidence://pilot/files", at: AT });
    const reconciliation = reconcile({ store, source, objects: objectsFor(source), coverage, at: AT });
    const receipt = executeCutover({ store, source, principal: PRINCIPALS.ada, reconciliation, operatorSubject: PRINCIPALS.operator.id, at: AT, snapshotDir: snapshot });
    assert.equal(receipt.status, "cutover");
    const rolled = rollbackCutover({ store, receipt, destDir: restored, at: AT });
    assert.equal(rolled.status, "rolled-back");
    const restoredStore = FileMigrationStore.open(restored);
    const records = restoredStore.listRecords({ tenantId: "acme", appId: "files" });
    assert.equal(records.length, 2);
    assert.ok(records.every((r) => Array.isArray(r.acl.readGroups)));
    cleanup();
  });
});

test("cutover kræver cutover-adgang", () => {
  const { store, sourceById, objectsFor, coverage, cleanup } = fixture();
  const source = sourceById("files-acme");
  importBatch({ store, source, objects: objectsFor(source), coverage, at: AT });
  recordApproval({ store, principal: PRINCIPALS.ada, tenantId: "acme", appId: "files", contentApproved: true, aclApproved: true, evidenceRef: "evidence://pilot/files", at: AT });
  const reconciliation = reconcile({ store, source, objects: objectsFor(source), coverage, at: AT });
  assert.throws(
    () => executeCutover({ store, source, principal: PRINCIPALS.ben, reconciliation, operatorSubject: PRINCIPALS.operator.id, at: AT }),
    (error) => error.code === "migration_access_denied",
  );
  cleanup();
});
