#!/usr/bin/env node
/**
 * DKC-037 — fokuseret kontrol af serviceklasser, moduldækning og
 * deployment-profilkompatibilitet.
 *
 *   node continuity/src/check.mjs
 *
 * Kontrollerer at:
 *   - hver serviceklasse validerer mod skema + semantik,
 *   - hvert pilotmodul har en serviceklasse med eksplicit netværkspartition,
 *   - hver serviceklasse er kompatibel med de deployment-profiler den peger på,
 *   - HA-badgen kun kan sættes på klasser med tre failure domains, N+1,
 *     ekstern/offsite backup og særskilt recovery-lokation.
 */
import { buildAjv } from "../../conformance/src/schemas.mjs";
import { loadServiceClasses, pilotModules, checkModuleCoverage, validateServiceClasses } from "./classes.mjs";
import { checkProfileCompatibility, loadDeploymentProfiles, profileCoverage } from "./profile-check.mjs";

const errors = [];
const notes = [];

const validated = validateServiceClasses();
for (const result of validated) {
  if (result.ok) continue;
  for (const e of result.errors) errors.push(`${result.file}: ${e.path} ${e.message}`.trim());
}
notes.push(`${validated.length} serviceklasser valideret`);

const modules = pilotModules();
const coverage = checkModuleCoverage({ modules });
errors.push(...coverage);
notes.push(`${modules.length} pilotmoduler dækket`);

const profiles = loadDeploymentProfiles();
const compat = checkProfileCompatibility({ profiles });
errors.push(...compat);
notes.push(`${profiles.length} deployment-profiler kontrolleret`);

// Netværkspartition skal være eksplicit for alle klasser (schema håndhæver
// formen; her bekræfter vi at beskrivelsen er der, også for ikke-valide).
for (const sc of loadServiceClasses()) {
  const np = sc.data?.failureModel?.networkPartition;
  if (!np?.behavior || !(np?.description ?? "").trim()) {
    errors.push(`${sc.file}: adfærd ved netværkspartition mangler`);
  }
}

// Bevis at buildAjv kan kompilere kontrakten (fanger skemafejl tidligt).
try {
  buildAjv({ strict: true });
} catch (err) {
  errors.push(`service-class.schema.json kunne ikke kompileres: ${err.message}`);
}

if (errors.length) {
  console.error("✘ Kontinuitetskontrol fejlede:\n");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`✔ Kontinuitetskontrol bestået (${notes.join("; ")})`);
for (const row of profileCoverage()) {
  console.log(`  • ${row.profile}${row.haEnabled ? " (HA)" : " (non-HA)"}: ${row.serviceClasses.join(", ") || "ingen"}`);
}
console.log(`✔ HA-badge kræver 3 failure domains, N+1, ekstern/offsite backup og frisk failover-måling`);
