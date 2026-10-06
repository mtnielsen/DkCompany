import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildAjv, contractsDir, SCHEMA_IDS, validate } from "../src/schemas.mjs";
import { backupManifestProblems, restoreDrillProblems, validateBackupManifestDir, validateRestoreDrillDir } from "../src/backup.mjs";

const examplesDir = join(contractsDir, "examples");
const { ajv } = buildAjv();
const manifest = JSON.parse(readFileSync(join(examplesDir, "backup-manifest.example.json"), "utf8"));
const drill = JSON.parse(readFileSync(join(examplesDir, "restore-drill.example.json"), "utf8"));

test("de committede eksempler validerer (skema + semantik)", () => {
  for (const r of validateBackupManifestDir(examplesDir, ajv)) assert.equal(r.ok, true, `${r.file}: ${JSON.stringify(r.errors)}`);
  for (const r of validateRestoreDrillDir(examplesDir, ajv)) assert.equal(r.ok, true, `${r.file}: ${JSON.stringify(r.errors)}`);
});

test("backup-skemaet registreres med $id og validerer eksemplet", () => {
  assert.equal(SCHEMA_IDS.backupManifest, "https://example.org/contracts/backup-manifest.schema.json");
  assert.equal(validate(ajv, SCHEMA_IDS.backupManifest, manifest).ok, true);
  assert.equal(validate(ajv, SCHEMA_IDS.restoreDrill, drill).ok, true);
});

test("en backup der lægger nøglen i lageret afvises", () => {
  const bad = structuredClone(manifest);
  bad.encryption.storeContainsKey = true;
  assert.ok(backupManifestProblems(bad).some((p) => /nøglen/.test(p.message)));
});

test("en backup uden databasekomponent afvises", () => {
  const bad = structuredClone(manifest);
  bad.components = bad.components.filter((c) => c.kind !== "database");
  assert.ok(backupManifestProblems(bad).some((p) => /databasekomponent/.test(p.message)));
});

test("en 'pass'-gate med fejlet funktionel check afvises", () => {
  const bad = structuredClone(drill);
  bad.functionalChecks[0].status = "fail";
  assert.ok(restoreDrillProblems(bad).some((p) => /funktionelle checks/.test(p.message)));
});

test("en 'pass'-gate over RTO-målet afvises", () => {
  const bad = structuredClone(drill);
  bad.measurements.measuredRtoMinutes = 90;
  bad.measurements.restoreDurationMs = 90 * 60000;
  assert.ok(restoreDrillProblems(bad).some((p) => /RTO/.test(p.message)));
});

test("en blokeret gate uden begrundelse afvises", () => {
  const bad = structuredClone(drill);
  bad.gate = { status: "blocked", reasons: [] };
  assert.ok(restoreDrillProblems(bad).some((p) => /forklare/.test(p.message)));
});

test("manglende suppressionsanvendelse afvises for en pass-gate", () => {
  const bad = structuredClone(drill);
  bad.suppression.applied = false;
  assert.ok(restoreDrillProblems(bad).some((p) => /suppressionsjournalen/.test(p.message)));
});
