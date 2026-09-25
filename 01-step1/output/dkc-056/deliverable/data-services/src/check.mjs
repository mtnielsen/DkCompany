#!/usr/bin/env node
/**
 * DKC-056 — fokuseret kontrol af datatjenester.
 *
 *   node data-services/src/check.mjs
 *
 * Kontrollerer uden en levende database at:
 *   - hver databaseprofil, datakilde og binding validerer (skema + semantik),
 *   - krydsreferencer og scope-inklusion er konsistente,
 *   - en ekstern kilde aldrig kan auto-migreres eller auto-sikkerhedskopieres,
 *   - eksemplerne i /contracts/examples validerer.
 */
import { join } from "node:path";
import { buildAjv } from "../../conformance/src/schemas.mjs";
import { validateDatabaseProfileDir, validateDataSourceDir, validateDataServiceBindingDir } from "../../conformance/src/data-services.mjs";
import { loadAll, checkAll, repoRoot } from "./registry.mjs";

const errors = [];
const notes = [];

const { profiles, sources, bindings } = loadAll();
notes.push(`${profiles.length} databaseprofiler`);
notes.push(`${sources.length} datakilder`);
notes.push(`${bindings.length} bindinger`);

for (const problem of checkAll()) errors.push(problem);

try {
  buildAjv({ strict: true });
} catch (err) {
  errors.push(`kontraktskemaerne kunne ikke kompileres: ${err.message}`);
}

const examplesDir = join(repoRoot, "contracts", "examples");
for (const [label, results] of [
  ["databaseprofil", validateDatabaseProfileDir(examplesDir)],
  ["datakilde", validateDataSourceDir(examplesDir)],
  ["binding", validateDataServiceBindingDir(examplesDir)],
]) {
  for (const result of results) {
    if (result.ok) continue;
    for (const error of result.errors) errors.push(`${result.file}: ${error.path} ${error.message}`);
  }
  notes.push(`${results.length} ${label}-eksempler valideret`);
}

for (const { data: source } of sources) {
  if (source.externalPolicy.autoMigrate !== false || source.externalPolicy.autoBackup !== false || source.externalPolicy.treatAsOwnDatabase !== false) {
    errors.push(`${source.metadata.name}: ekstern politik er ikke kontraktuelt låst`);
  }
}

if (errors.length) {
  console.error("✘ Datatjenestekontrol fejlede:\n");
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}
console.log(`✔ Datatjenestekontrol bestået (${notes.join("; ")})`);
console.log("✔ Eksterne kilder er read-only, tenantbundne og aldrig platformens egne databaser");
