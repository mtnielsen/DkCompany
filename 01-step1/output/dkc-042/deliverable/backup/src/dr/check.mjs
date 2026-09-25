#!/usr/bin/env node
/**
 * DKC-042 — fokuseret kontrol af katastrofegendannelsesplanen.
 *
 *   node backup/src/dr/check.mjs
 *
 * Kontrollerer at de fire DR-kontrakter kompilerer i streng Ajv-tilstand, at
 * eksemplerne validerer (skema + semantik), at den kanoniske plan og
 * recovery-adgangsprofil validerer, at planens kopier peger på konfigurerede
 * backupmål, og at primærklyngens driftscredentials ikke kan slette beskyttede
 * backups.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAjv } from "../../../conformance/src/schemas.mjs";
import {
  validateDisasterRecoveryPlan,
  validateRecoveryAccessProfile,
  validateDisasterRecoveryPlanDir,
  validateRecoveryAccessProfileDir,
  validatePitrReconciliationDir,
  validateDisasterRecoveryDrillDir,
} from "../../../conformance/src/disaster-recovery.mjs";
import { loadDisasterRecoveryPlan, loadRecoveryAccessProfile, disasterRecoveryPlanProblems } from "./plan.mjs";
import { recoveryAccessProblems } from "./access.mjs";
import { loadBackupTargets } from "../targets.mjs";
import { renderDrPlan } from "./render.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");
const examplesDir = join(repoRoot, "contracts", "examples");

const errors = [];
const notes = [];
let ajv;
try {
  ({ ajv } = buildAjv({ strict: true }));
  notes.push("DR-kontrakterne kompilerer i streng Ajv-tilstand");
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
  collect("DR-plan-eksempel/eksempler", validateDisasterRecoveryPlanDir(examplesDir, ajv));
  collect("recovery-adgangsprofil-eksempel/eksempler", validateRecoveryAccessProfileDir(examplesDir, ajv));
  collect("PITR-afstemnings-eksempel/eksempler", validatePitrReconciliationDir(examplesDir, ajv));
  collect("katastrofeøvelses-eksempel/eksempler", validateDisasterRecoveryDrillDir(examplesDir, ajv));
}

// Den kanoniske plan og recovery-adgangsprofil.
const targets = loadBackupTargets(join(repoRoot, "backup", "targets")).map((t) => t.data);
let plan = null;
let profile = null;
try {
  plan = loadDisasterRecoveryPlan(repoRoot);
  const result = validateDisasterRecoveryPlan(plan, ajv, { targets });
  if (!result.ok) for (const e of result.errors) errors.push(`backup/dr/disaster-recovery-plan.json: ${e.path} ${e.message}`.trim());
  else notes.push("den kanoniske katastrofegendannelsesplan validerer");
} catch (err) {
  errors.push(`backup/dr/disaster-recovery-plan.json: ${err.message}`);
}
try {
  profile = loadRecoveryAccessProfile(repoRoot);
  const result = validateRecoveryAccessProfile(profile, ajv);
  if (!result.ok) for (const e of result.errors) errors.push(`backup/dr/recovery-access-profile.json: ${e.path} ${e.message}`.trim());
  else notes.push("den kanoniske recovery-adgangsprofil validerer");
} catch (err) {
  errors.push(`backup/dr/recovery-access-profile.json: ${err.message}`);
}

// Krydsreference: planen og profilen skal pege på hinanden og være adskilte.
if (plan && profile) {
  const profileRef = plan.recoveryIdentity?.profileRef ?? "";
  if (!profileRef.endsWith("recovery-access-profile.json")) {
    errors.push(`planens recoveryIdentity.profileRef '${profileRef}' peger ikke på en recovery-adgangsprofil`);
  }
  if (plan.primaryCluster?.credentialsRef && plan.primaryCluster.credentialsRef === profile.recoveryIdentity?.subjectRef) {
    errors.push("primærklyngens driftscredentials er identisk med recovery-identiteten");
  }
  const immutableCreds = (plan.copies ?? []).filter((c) => c.immutable).map((c) => c.credentialsRef);
  if (immutableCreds.includes(plan.primaryCluster?.credentialsRef)) {
    errors.push("en immutable kopi bruger primærklyngens driftscredentials");
  }
  const extra = recoveryAccessProblems(profile);
  for (const p of extra) errors.push(`backup/dr/recovery-access-profile.json: ${p.path} ${p.message}`.trim());
  const planExtra = disasterRecoveryPlanProblems(plan, { targets });
  for (const p of planExtra) errors.push(`backup/dr/disaster-recovery-plan.json: ${p.path} ${p.message}`.trim());

  // Det afledte dokument skal være i trit med planen.
  const docPath = join(repoRoot, "docs", "continuity", "dr-plan.md");
  if (!existsSync(docPath)) {
    errors.push("docs/continuity/dr-plan.md mangler. Kør 'make dr-write'.");
  } else if (readFileSync(docPath, "utf8") !== renderDrPlan(plan, profile)) {
    errors.push("docs/continuity/dr-plan.md er ude af trit med den kanoniske plan. Kør 'make dr-write'.");
  } else {
    notes.push("docs/continuity/dr-plan.md er i sync med planen");
  }
}

if (errors.length) {
  console.error("✘ Katastrofegendannelseskontrol fejlede:\n");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`✔ Katastrofegendannelseskontrol bestået (${notes.join("; ")})`);
console.log("✔ 3-2-1-1-0 med ekstern og offline/immutable kopi, PITR med ACL-afstemning og et samlet brugerflows RPO/RTO");
console.log("✔ primærklyngens driftscredentials kan ikke slette beskyttede backups; recovery-adgang er adskilt og to-personers");
