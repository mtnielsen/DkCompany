import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fixture, AT } from "./helpers.mjs";
import { importBatch } from "../src/import.mjs";
import { buildExport, writeExport, renderCsv } from "../src/export.mjs";
import { migrationExportProblems } from "../src/model.mjs";

test("eksporten er selvbeskrivende og inkluderer alle facetter", () => {
  const { store, sourceById, objectsFor, coverage, cleanup } = fixture();
  const source = sourceById("files-acme");
  importBatch({ store, source, objects: objectsFor(source), coverage, at: AT });
  const exported = buildExport({ store, tenantId: "acme", appId: "files", coverage, at: AT });
  const dir = join(store.root, "export");
  const written = writeExport({ dir, exported });
  assert.deepEqual(migrationExportProblems(written.manifest), []);
  assert.equal(written.manifest.recordCount, 2);
  assert.equal(written.manifest.files.length, 4);
  for (const facet of ["ownership", "timestamps", "comments", "attachments", "acl", "links"]) {
    assert.equal(written.manifest.includes[facet], true);
  }
  assert.ok(existsSync(join(dir, "manifest.json")));
  assert.ok(existsSync(join(dir, "records.jsonl")));
  assert.ok(existsSync(join(dir, "records.csv")));
  assert.ok(existsSync(join(dir, "read-export.mjs")));
  cleanup();
});

test("standalone-læseren verificerer eksporten uden platformen", () => {
  const { store, sourceById, objectsFor, coverage, cleanup } = fixture();
  const source = sourceById("projects-acme");
  importBatch({ store, source, objects: objectsFor(source), coverage, at: AT });
  const dir = join(store.root, "export-standalone");
  writeExport({ dir, exported: buildExport({ store, tenantId: "acme", appId: "projects", coverage, at: AT }) });
  const output = execFileSync(process.execPath, [join(dir, "read-export.mjs"), dir], { encoding: "utf8" });
  assert.match(output, /kan læses uden DkCompany/);
  cleanup();
});

test("checksum ændrer sig hvis indholdet ændrer sig", () => {
  const { store, sourceById, objectsFor, coverage, cleanup } = fixture();
  const source = sourceById("knowledge-acme");
  importBatch({ store, source, objects: objectsFor(source), coverage, at: AT });
  const first = buildExport({ store, tenantId: "acme", appId: "knowledge", coverage, at: AT });
  const record = store.getRecord(first.records[0].reference);
  store.upsertRecord({ ...record, name: "ændret" }, { at: AT });
  const second = buildExport({ store, tenantId: "acme", appId: "knowledge", coverage, at: AT });
  assert.notEqual(first.manifest.checksum, second.manifest.checksum);
  cleanup();
});

test("CSV-eksporten koder lister som JSON", () => {
  const { store, sourceById, objectsFor, coverage, cleanup } = fixture();
  const source = sourceById("crm-acme");
  importBatch({ store, source, objects: objectsFor(source), coverage, at: AT });
  const exported = buildExport({ store, tenantId: "acme", appId: "crm", coverage, at: AT });
  const csv = renderCsv(exported.records);
  assert.match(csv.split("\n")[0], /reference,appId/);
  assert.match(csv, /acl/);
  cleanup();
});
