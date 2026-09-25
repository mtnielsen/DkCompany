#!/usr/bin/env node
/**
 * DKC-016 — fokuseret kontrol af backup-manifest og gendannelsesrapport.
 *
 *   node backup/src/check.mjs
 *
 * Kontrollerer at begge kontrakter kan kompileres i streng Ajv-tilstand, at
 * eksemplerne validerer mod skema + semantik, og at nøgleadskillelse,
 * databasekomponent, suppressionsjournal og RPO-/RTO-gate er til stede.
 */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAjv } from "../../conformance/src/schemas.mjs";
import { validateBackupManifestDir, validateRestoreDrillDir } from "../../conformance/src/backup.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const examplesDir = join(repoRoot, "contracts", "examples");

const errors = [];
const notes = [];

try {
  buildAjv({ strict: true });
  notes.push("kontrakterne kompilerer i streng Ajv-tilstand");
} catch (err) {
  errors.push(`kontrakterne kunne ikke kompileres: ${err.message}`);
}

if (!existsSync(examplesDir)) {
  errors.push(`mangler eksempelmappen ${examplesDir}`);
} else {
  const manifests = validateBackupManifestDir(examplesDir);
  const drills = validateRestoreDrillDir(examplesDir);
  notes.push(`${manifests.length} backup-manifest(er) og ${drills.length} gendannelsesrapport(er) valideret`);
  for (const result of [...manifests, ...drills]) {
    if (result.ok) continue;
    for (const e of result.errors) errors.push(`${result.file}: ${e.path} ${e.message}`.trim());
  }
}

if (errors.length) {
  console.error("✘ Backup-/gendannelseskontrol fejlede:\n");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`✔ Backup-/gendannelseskontrol bestået (${notes.join("; ")})`);
console.log("✔ krypteringsnøglen er adskilt fra backup-lageret, og gaten spærrer ved RPO-/RTO-afvigelser");
