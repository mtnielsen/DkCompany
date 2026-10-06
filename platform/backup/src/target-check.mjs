#!/usr/bin/env node
/**
 * DKC-057 — fokuseret kontrol af eksterne backupmål og målsæt.
 *
 *   node backup/src/target-check.mjs
 *
 * Kontrollerer at backupmål- og målsæt-kontrakterne kompilerer, at eksemplerne
 * validerer, at de konfigurerede mål (`backup/targets/*.json`) og målsæt
 * (`backup/target-sets/*.json`) validerer, og at enhver ekstern datakilde har
 * en eksplicit håndtering — en connector alene erklærer ikke kilden beskyttet.
 */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAjv } from "../../conformance/src/schemas.mjs";
import {
  validateBackupTarget,
  validateBackupTargetDir,
  validateBackupTargetSet,
  validateBackupTargetSetDir,
  externalSourceCoverageProblems,
} from "../../conformance/src/backup.mjs";
import { loadBackupTargets } from "./targets.mjs";
import { loadSources } from "../../data-services/src/registry.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const examplesDir = join(repoRoot, "contracts", "examples");
const targetsDir = join(repoRoot, "backup", "targets");
const targetSetsDir = join(repoRoot, "backup", "target-sets");

const errors = [];
const notes = [];
let ajv;
try {
  ({ ajv } = buildAjv({ strict: true }));
  notes.push("backupmål-kontrakterne kompilerer i streng Ajv-tilstand");
} catch (err) {
  errors.push(`kontrakterne kunne ikke kompileres: ${err.message}`);
}

function collect(label, results) {
  notes.push(`${results.length} ${label}`);
  for (const result of results) {
    if (result.ok) continue;
    for (const e of result.errors) errors.push(`${result.file}: ${e.path} ${e.message}`.trim());
  }
}

if (!existsSync(examplesDir)) {
  errors.push(`mangler eksempelmappen ${examplesDir}`);
} else {
  collect("backupmål-eksempel/eksempler", validateBackupTargetDir(examplesDir, ajv));
  collect("backupmålsæt-eksempel/eksempler", validateBackupTargetSetDir(examplesDir, ajv));
}

// Konfigurerede mål (backup/targets/*.json) valideres mod kontrakten.
const configuredTargets = loadBackupTargets(targetsDir);
const configured = configuredTargets.map(({ file, data }) => {
  const result = validateBackupTarget(data, ajv);
  return { file, ok: result.ok, errors: result.errors };
});
collect("konfigureret/kontrollerede backupmål", configured);
const targetData = configuredTargets.map((t) => t.data);

// Konfigurerede målsæt (backup/target-sets/*.json) med krydsreference til
// målene og til datatjenesternes eksterne kilder.
const sources = loadSources().map((s) => s.data);
const configuredSets = loadBackupTargets(targetSetsDir);
for (const { file, data } of configuredSets) {
  const result = validateBackupTargetSet(data, ajv, { targets: targetData });
  for (const e of result.errors) errors.push(`${file}: ${e.path} ${e.message}`.trim());
  for (const problem of externalSourceCoverageProblems(data, sources)) errors.push(`${file}: ${problem}`);
}
notes.push(`${configuredSets.length} konfigureret/kontrollerede backupmålsæt`);

if (errors.length) {
  console.error("✘ Backupmålskontrol fejlede:\n");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`✔ Backupmålskontrol bestået (${notes.join("; ")})`);
console.log("✔ eksterne mål valideres med credentials-reference, verificeret WORM, production-TLS og fejl-/adgangsdomæne");
console.log("✔ enhver ekstern datakilde har en eksplicit backuphåndtering i målsættet");
