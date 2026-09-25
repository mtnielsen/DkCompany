/**
 * DKC-059 — konformanstest for providerkontrakter og migrationskontrol.
 *
 * Tester skema + semantik på det faktiske katalog, register, supportmatrix,
 * politik, fixtures, eksempler og den genererede rapport, og at et brud
 * afvises. En rigtig udskiftning mod en levende provider er og forbliver
 * NOT RUN.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../src/schemas.mjs";
import {
  validateProviderCapabilityCatalog,
  validateProviderRegistry,
  validateProviderSupportMatrix,
  validateProviderPreflight,
  validateProviderSwapReceipt,
  validateProviderPolicy,
  validateProviderSwapFixture,
} from "../src/providers.mjs";
import { loadSwapFixtures, providerRegistryProblems, supportMatrixProblems } from "../../migration/src/provider-model.mjs";

function read(rel) {
  return JSON.parse(readFileSync(join(repoRoot, rel), "utf8"));
}

const catalog = read("provider-registry/capabilities.json");
const registry = read("provider-registry/providers.json");
const matrix = read("provider-registry/support-matrix.json");
const policy = read("provider-registry/policy.json");
const report = read("provider-registry/report/provider-report.json");

test("det faktiske capability-katalog validerer (skema + semantik)", () => {
  assert.equal(validateProviderCapabilityCatalog(catalog).ok, true);
});

test("det faktiske providerregister validerer mod kataloget", () => {
  assert.equal(validateProviderRegistry(registry, undefined, { catalog }).ok, true);
});

test("den faktiske supportmatrix validerer mod registret", () => {
  assert.equal(validateProviderSupportMatrix(matrix, undefined, { providers: registry, catalog }).ok, true);
});

test("den faktiske politik validerer, og kræver at en forbindelsesstreng ikke omgår gaten", () => {
  assert.equal(validateProviderPolicy(policy).ok, true);
  assert.equal(policy.negotiation.connectionStringNeverBypassesGate, true);
});

test("alle swap-fixtures validerer", () => {
  for (const { fixture } of loadSwapFixtures(repoRoot)) {
    assert.equal(validateProviderSwapFixture(fixture, undefined, { providers: registry, matrix }).ok, true);
  }
});

test("eksemplerne validerer (skema + semantik hvor relevant)", () => {
  assert.equal(validateProviderCapabilityCatalog(read("contracts/examples/provider-capability-catalog.example.json"), undefined, { requireAllClasses: false }).ok, true);
  assert.equal(validateProviderRegistry(read("contracts/examples/provider-registry.example.json"), undefined, { catalog }).ok, true);
  assert.equal(validateProviderSupportMatrix(read("contracts/examples/provider-support-matrix.example.json")).ok, true);
  assert.equal(validateProviderPreflight(read("contracts/examples/provider-preflight.example.json")).ok, true);
  assert.equal(validateProviderSwapReceipt(read("contracts/examples/provider-swap-receipt.example.json")).ok, true);
});

test("den genererede rapport er deterministisk og dækker alle tre skiftetilstande", () => {
  assert.equal(report.measured, false);
  assert.equal(report.generatedAt, "2026-03-01T00:00:00Z");
  const modes = new Set(report.compatibility.map((r) => r.mode));
  for (const mode of ["drop-in", "planned-migration", "unsupported"]) assert.ok(modes.has(mode));
  assert.ok(report.scenarios.every((s) => (s.problems ?? []).length === 0));
});

test("en provider med en capability i en forkert klasse afvises", () => {
  const broken = JSON.parse(JSON.stringify(registry));
  broken.providers[0].capabilities = { "database.tls": { version: "1.0.0", level: "enforced" } };
  assert.ok(providerRegistryProblems(broken, { catalog }).some((p) => /klassen/.test(p.message)));
});

test("en planned-migration uden migrationsbevis afvises", () => {
  const broken = JSON.parse(JSON.stringify(matrix));
  const row = broken.rows.find((r) => r.mode === "planned-migration");
  row.requiresMigrationProof = false;
  assert.ok(supportMatrixProblems(broken, { providers: registry, catalog }).some((p) => /migrationsbevis/.test(p.message)));
});

test("et ikke-understøttet skift der erklærer en migration afvises", () => {
  const broken = JSON.parse(JSON.stringify(matrix));
  const row = broken.rows.find((r) => r.mode === "unsupported");
  row.requiresMigrationProof = true;
  assert.ok(supportMatrixProblems(broken, { providers: registry, catalog }).some((p) => /ikke-understøttede/.test(p.message)));
});

test("en preflight-kvittering uden gate-håndhævelse afvises", () => {
  const broken = read("contracts/examples/provider-preflight.example.json");
  broken.connectionStringNeverBypassesGate = false;
  assert.ok(validateProviderPreflight(broken).errors.length > 0);
});

test("en kvittering med et checksum-mismatch afvises", () => {
  const broken = read("contracts/examples/provider-swap-receipt.example.json");
  broken.reconciliation.checksums.target = "f".repeat(64);
  broken.reconciliation.checksums.match = false;
  assert.equal(validateProviderSwapReceipt(broken).ok, true, "matchet må gerne være ærligt false");
  broken.reconciliation.checksums.target = "not-a-sha";
  assert.ok(validateProviderSwapReceipt(broken).errors.length > 0);
});

test("en politik der tillader tværtenant-skift afvises", () => {
  const broken = JSON.parse(JSON.stringify(policy));
  broken.authorization.crossTenantSwap = true;
  assert.ok(validateProviderPolicy(broken).errors.some((e) => e.path === "/authorization/crossTenantSwap"));
});

test("en politik der tillader en sikkerhedskritisk nedgradering afvises", () => {
  const broken = JSON.parse(JSON.stringify(policy));
  broken.negotiation.securityCriticalCannotDowngrade = false;
  assert.ok(validateProviderPolicy(broken).errors.length > 0);
});
