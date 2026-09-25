/**
 * DKC-056 — konformanstests for indbyggede og eksterne datatjenester.
 *
 * Beviser på de faktiske datafiler at profiler, kilder og bindinger validerer,
 * at registryet er konsistent, at read-only er standard, at en HR-kilde ikke
 * giver generelt læseadgang, og at eksterne kilder aldrig behandles som
 * platformens egne databaser.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import {
  validateDatabaseProfileDir,
  validateDataSourceDir,
  validateDataServiceBindingDir,
  databaseProfileProblems,
  dataSourceProblems,
  dataServiceBindingProblems,
} from "../src/data-services.mjs";
import { loadProfiles, loadSources, loadBindings, checkAll } from "../../data-services/src/registry.mjs";

const examplesDir = join(import.meta.dirname, "..", "..", "contracts", "examples");

test("databaseprofil-, datakilde- og bindingseksemplerne validerer mod skema + semantik", () => {
  for (const [label, results] of [
    ["databaseprofil", validateDatabaseProfileDir(examplesDir)],
    ["datakilde", validateDataSourceDir(examplesDir)],
    ["binding", validateDataServiceBindingDir(examplesDir)],
  ]) {
    assert.ok(results.length >= 1, `${label}: ingen eksempler fundet`);
    for (const result of results) {
      assert.equal(result.ok, true, `${result.file}: ${result.errors.map((e) => `${e.path} ${e.message}`).join("; ")}`);
    }
  }
});

test("den kanoniske registry krydsrefererer uden problemer", () => {
  assert.deepEqual(checkAll(), []);
  assert.ok(loadProfiles().some((p) => p.data.profileType === "managed"));
  assert.ok(loadProfiles().some((p) => p.data.profileType === "byo"));
});

test("en HR-kilde må ikke give generelt læseadgang til alle tabeller", () => {
  const source = structuredClone(loadSources().find((s) => s.data.sourceType === "hr").data);
  source.access.allowedTables = ["hr.*"];
  const problems = dataSourceProblems(source);
  assert.ok(problems.some((p) => p.path.includes("allowedTables")));
});

test("en rå hemmelighed afvises til fordel for en secretreference", () => {
  const source = structuredClone(loadSources()[0].data);
  source.connection.secretRef = "password=hunter2";
  assert.ok(dataSourceProblems(source).some((p) => p.path.includes("secretRef")));
});

test("eksterne kilder er kontraktuelt låst mod auto-migrate og auto-backup", () => {
  const source = structuredClone(loadSources()[0].data);
  source.externalPolicy = { ...source.externalPolicy, treatAsOwnDatabase: true, autoMigrate: true, autoBackup: true };
  const problems = dataSourceProblems(source);
  for (const key of ["treatAsOwnDatabase", "autoMigrate", "autoBackup"]) {
    assert.ok(problems.some((p) => p.path.includes(key)), `mangler afvisning af ${key}`);
  }
});

test("en binding må ikke udvide datakildens scope", () => {
  const bindings = structuredClone(loadBindings());
  const binding = bindings.find((b) => b.data.dataSourceRefs.length > 0);
  const target = binding.data.dataSourceRefs[0];
  target.scope.allowedTables.push(`${target.scope.allowedSchemas[0]}.payroll`);
  const problems = checkAll({ profiles: loadProfiles(), sources: loadSources(), bindings });
  assert.ok(problems.some((p) => p.includes("payroll")), "scope-udvidelse skal opdages");
});

test("en BYO-profil må ikke lægge patching/backup/restore/nøgler/kostnader på platformen alene", () => {
  const profile = structuredClone(loadProfiles().find((p) => p.data.profileType === "byo").data);
  for (const key of ["patching", "backup", "restore", "keys", "costs"]) profile.responsibilityMatrix[key].owner = "platform";
  const problems = databaseProfileProblems(profile);
  for (const key of ["patching", "backup", "restore", "keys", "costs"]) {
    assert.ok(problems.some((p) => p.path.includes(`/responsibilityMatrix/${key}/owner`)), `mangler afvisning af ${key}`);
  }
});

test("en bindings eksterne databehandling kan ikke slås til", () => {
  const binding = structuredClone(loadBindings()[0].data);
  binding.externalDataHandling = { treatAsOwnDatabase: true, migrationsAllowed: true, backupsAllowed: true };
  const problems = dataServiceBindingProblems(binding);
  for (const key of ["treatAsOwnDatabase", "migrationsAllowed", "backupsAllowed"]) {
    assert.ok(problems.some((p) => p.path.includes(key)), `mangler afvisning af ${key}`);
  }
});
