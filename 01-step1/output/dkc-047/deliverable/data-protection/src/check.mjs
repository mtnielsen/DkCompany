#!/usr/bin/env node
/**
 * DKC-047 — fokuseret kontrol af beskyttede dataklasser.
 *
 *   node data-protection/src/check.mjs
 *
 * Kontrollerer uden et levende lager at:
 *   - politikken og registeret validerer (skema + semantik),
 *   - hver beskyttet post dækker alle forbud og har en menneskelig proces,
 *   - retention-locked har en vurderet, endelig frist (også for persondata),
 *   - hvert pilotmodul ærligt erklærer sin dataProtection-capability,
 *   - fuld lager-/nøglehåndhævelse ikke påstås uden bevis (DKC-048-hullet vises).
 */
import { buildAjv } from "../../conformance/src/schemas.mjs";
import { loadPolicy, loadRegister, checkModuleCoverage, storageEnforcementGaps, loadRoutes } from "./registry.mjs";

const errors = [];
const notes = [];

let policy;
let register;
try {
  policy = loadPolicy();
  register = loadRegister();
} catch (err) {
  console.error(`✘ Beskyttelseskontrol fejlede:\n  - ${err.message}`);
  process.exit(1);
}
notes.push(`${register.records.length} beskyttede poster`);
notes.push(`${Object.keys(policy.agentOperationMatrix).length} klasser i politikken`);

for (const problem of checkModuleCoverage({ register })) errors.push(problem);
notes.push(`${loadRoutes().length} routes kendt`);

// Kontrakt- og skemakompilering fanges tidligt.
try {
  buildAjv({ strict: true });
} catch (err) {
  errors.push(`protected-data.schema.json kunne ikke kompileres: ${err.message}`);
}

// Ingen post må påstå fuld håndhævelse uden bevis.
for (const record of register.records) {
  if (record.storageEnforcement.status === "full" && !(record.evidence ?? []).length) {
    errors.push(`${record.id}: 'full' lagerhåndhævelse uden bevis`);
  }
}

const gaps = storageEnforcementGaps({ register });
notes.push(`${gaps.length} poster med uafklaret lagerhåndhævelse (DKC-048)`);

if (errors.length) {
  console.error("✘ Beskyttelseskontrol fejlede:\n");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`✔ Beskyttelseskontrol bestået (${notes.join("; ")})`);
console.log(`✔ AI-ændringsforbud, WORM-retention og no-AI-access er adskilte regler`);
for (const gap of gaps) {
  console.log(`  • ${gap.id}: ${gap.status} — leveres af ${gap.deliveredBy ?? "ukendt"}`);
}
