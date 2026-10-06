import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildAjv, contractsDir, SCHEMA_IDS, validate } from "../src/schemas.mjs";
import {
  validateDisasterRecoveryPlan,
  validateRecoveryAccessProfile,
  validatePitrReconciliation,
  validateDisasterRecoveryDrill,
  validateDisasterRecoveryPlanDir,
  validateRecoveryAccessProfileDir,
  validatePitrReconciliationDir,
  validateDisasterRecoveryDrillDir,
} from "../src/disaster-recovery.mjs";

const examplesDir = join(contractsDir, "examples");
const { ajv } = buildAjv();
const load = (name) => JSON.parse(readFileSync(join(examplesDir, name), "utf8"));
const plan = load("disaster-recovery-plan.example.json");
const access = load("recovery-access-profile.example.json");
const pitr = load("pitr-reconciliation.example.json");
const drill = load("disaster-recovery-drill.example.json");

test("de committede eksempler validerer (skema + semantik)", () => {
  for (const r of validateDisasterRecoveryPlanDir(examplesDir, ajv)) assert.equal(r.ok, true, `${r.file}: ${JSON.stringify(r.errors)}`);
  for (const r of validateRecoveryAccessProfileDir(examplesDir, ajv)) assert.equal(r.ok, true, `${r.file}: ${JSON.stringify(r.errors)}`);
  for (const r of validatePitrReconciliationDir(examplesDir, ajv)) assert.equal(r.ok, true, `${r.file}: ${JSON.stringify(r.errors)}`);
  for (const r of validateDisasterRecoveryDrillDir(examplesDir, ajv)) assert.equal(r.ok, true, `${r.file}: ${JSON.stringify(r.errors)}`);
});

test("schema-id'erne er registreret og eksemplerne validerer mod skemaet", () => {
  assert.equal(SCHEMA_IDS.disasterRecoveryPlan, "https://example.org/contracts/disaster-recovery-plan.schema.json");
  assert.equal(SCHEMA_IDS.recoveryAccessProfile, "https://example.org/contracts/recovery-access-profile.schema.json");
  assert.equal(SCHEMA_IDS.pitrReconciliation, "https://example.org/contracts/pitr-reconciliation.schema.json");
  assert.equal(SCHEMA_IDS.disasterRecoveryDrill, "https://example.org/contracts/disaster-recovery-drill.schema.json");
  assert.equal(validate(ajv, SCHEMA_IDS.disasterRecoveryPlan, plan).ok, true);
  assert.equal(validate(ajv, SCHEMA_IDS.recoveryAccessProfile, access).ok, true);
  assert.equal(validate(ajv, SCHEMA_IDS.pitrReconciliation, pitr).ok, true);
  assert.equal(validate(ajv, SCHEMA_IDS.disasterRecoveryDrill, drill).ok, true);
});

test("en plan uden offline/immutable kopi afvises", () => {
  const bad = structuredClone(plan);
  // Behold tre kopier (så skemaet passer), men nedgradér den offline kopi.
  const offline = bad.copies.find((c) => c.copyType === "offline-immutable");
  offline.copyType = "offsite";
  bad.principle.offsiteCopies = 2;
  const result = validateDisasterRecoveryPlan(bad, ajv);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /offline/.test(e.message)));
});

test("en recovery-adgang med stående adgang afvises", () => {
  const bad = structuredClone(access);
  bad.recoveryIdentity.standingAccess = true;
  const result = validateRecoveryAccessProfile(bad, ajv);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.path.includes("standingAccess") || /stående/.test(e.message)));
});

test("en PITR hvor en senere WAL-post blev afspillet afvises", () => {
  const bad = structuredClone(pitr);
  bad.lastAppliedAt = "2026-09-28T02:10:00Z";
  const result = validatePitrReconciliation(bad, ajv);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /efter det valgte tidspunkt/.test(e.message)));
});

test("en 'pass'-PITR med ACL-afvigelse afvises", () => {
  const bad = structuredClone(pitr);
  bad.acl.reconciled = false;
  bad.acl.differences = ["oidc|cont.officer: forventet 'continuity-officer', faktisk '-'"];
  const result = validatePitrReconciliation(bad, ajv);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /ACL/.test(e.message)));
});

test("en øvelse med en fungerende primærklynge afvises", () => {
  const bad = structuredClone(drill);
  bad.primaryClusterAvailable = true;
  const result = validateDisasterRecoveryDrill(bad, ajv);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.path.includes("primaryClusterAvailable") || /primærklynge/.test(e.message)));
});

test("en 'pass'-øvelse uden genoprettet secret-store afvises", () => {
  const bad = structuredClone(drill);
  bad.dependencyRecovery = bad.dependencyRecovery.map((d) => (d.component === "secret-store" ? { ...d, recovered: false } : d));
  const result = validateDisasterRecoveryDrill(bad, ajv);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /secret-store/.test(e.message)));
});
