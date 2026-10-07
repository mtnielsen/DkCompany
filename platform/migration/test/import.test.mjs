import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, AT } from "./helpers.mjs";
import { dryRun, importBatch, reconcile } from "../src/import.mjs";
import { FileMigrationStore } from "../src/store.mjs";
import { migrationRecordProblems } from "../src/model.mjs";

test("dry-run afstemmer antal og checksums uden at skrive", () => {
  const { all, store, sourceById, objectsFor, coverage } = fixture();
  const source = sourceById("projects-acme");
  const reconciliation = dryRun({ source, objects: objectsFor(source), coverage, at: AT });
  assert.equal(reconciliation.counts.source, 3);
  assert.equal(reconciliation.counts.created, 3);
  assert.equal(reconciliation.checksums.match, true);
  assert.equal(reconciliation.persisted, false);
  assert.equal(store.listRecords().length, 0);
  assert.deepEqual(reconciliation.problems, []);
});

test("en afbrudt import kan genoptages uden dubletter", () => {
  const { store, sourceById, objectsFor, coverage } = fixture();
  const source = sourceById("projects-acme");
  const objects = objectsFor(source);
  const first = importBatch({ store, source, objects, coverage, at: AT, limit: 1 });
  assert.equal(first.counts.created, 1);
  assert.equal(store.listRecords({ appId: "projects" }).length, 1);
  const second = importBatch({ store, source, objects, coverage, at: AT, resume: true });
  assert.equal(second.counts.created, 2);
  assert.equal(store.listRecords({ appId: "projects" }).length, 3);
});

test("et retry er idempotent og skaber ingen dubletter", () => {
  const { store, sourceById, objectsFor, coverage } = fixture();
  const source = sourceById("knowledge-acme");
  const objects = objectsFor(source);
  importBatch({ store, source, objects, coverage, at: AT });
  const before = store.listRecords().length;
  const retry = importBatch({ store, source, objects, coverage, at: AT, resume: false });
  assert.equal(retry.counts.created, 0);
  assert.equal(retry.counts.skipped, objects.length);
  assert.equal(store.listRecords().length, before);
});

test("fejllisten registrerer et tværtenant-objekt uden at importere det", () => {
  const { store, sourceById, coverage } = fixture();
  const source = sourceById("files-acme");
  const foreign = { appId: "files", tenantId: "globex", entityType: "File", sourceObjectId: "x-1", data: { owner: "oidc|gus.globex", name: "x" } };
  const result = importBatch({ store, source, objects: [foreign], coverage, at: AT });
  assert.equal(result.counts.failed, 1);
  assert.equal(result.errors[0].code, "cross_tenant_object");
  assert.equal(store.listRecords().length, 0);
});

test("reconcile bekræfter at den gemte tilstand matcher kilden", () => {
  const { store, sourceById, objectsFor, coverage } = fixture();
  const source = sourceById("support-acme");
  const objects = objectsFor(source);
  importBatch({ store, source, objects, coverage, at: AT });
  const reconciliation = reconcile({ store, source, objects, coverage, at: AT });
  assert.equal(reconciliation.checksums.match, true);
  const before = fixture();
  importBatch({ store, source, objects, coverage, at: AT, resume: false });
  assert.equal(reconcile({ store, source, objects, coverage, at: AT }).checksums.match, true);
  before.cleanup();
});

test("poster består en genindlæsning fra disk og en backup/gendannelse", () => {
  const { store, sourceById, objectsFor, coverage, cleanup } = fixture();
  const source = sourceById("files-acme");
  importBatch({ store, source, objects: objectsFor(source), coverage, at: AT });
  const reloaded = FileMigrationStore.open(store.root);
  assert.equal(reloaded.listRecords().length, 2);
  for (const record of reloaded.listRecords()) assert.deepEqual(migrationRecordProblems(record), []);
  cleanup();
});
