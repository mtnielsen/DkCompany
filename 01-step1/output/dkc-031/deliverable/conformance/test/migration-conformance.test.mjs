/**
 * DKC-031 — konformanstest for migrations- og exitværktøjer.
 *
 * Tester skema + semantik på de faktiske kilder, politikken, dækningsmatricen,
 * eksemplerne og den genererede rapport, og at et brud afvises. En rigtig
 * kilde, en rigtig cutover og en menneskelig pilotgodkendelse er og forbliver
 * NOT RUN.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../src/schemas.mjs";
import { validateMigrationSource, validateMigrationCoverage, validateMigrationReconciliation, validateMigrationExport, validateMigrationApproval, validateMigrationPolicy } from "../src/migration.mjs";
import { migrationSourceProblems, migrationPolicyProblems } from "../../migration/src/model.mjs";

function read(rel) {
  return JSON.parse(readFileSync(join(repoRoot, rel), "utf8"));
}

const sources = read("migration/sources.json");
const policy = read("migration/policy.json");
const report = read("migration/report/migration-report.json");

test("de faktiske migrationskilder validerer mod skema og semantik", () => {
  const tenantIds = new Set(sources.sources.map((s) => s.tenantId));
  assert.equal(validateMigrationSource(sources, undefined, { supportedTenants: tenantIds, requireAllPilotApps: true }).ok, true);
});

test("den faktiske migrationspolitik validerer", () => {
  assert.equal(validateMigrationPolicy(policy).ok, true);
});

test("dækningsmatricen i rapporten validerer og viser tabt funktionalitet", () => {
  assert.equal(validateMigrationCoverage(report.coverage, undefined, { sources: sources.sources }).ok, true);
  assert.ok(report.coverage.lostFunctionality.length > 0);
  assert.ok(report.coverage.matrix.every((row) => row.facet));
});

test("eksemplerne validerer", () => {
  assert.equal(validateMigrationSource(read("contracts/examples/migration-source.example.json"), undefined, { requireAllPilotApps: false }).ok, true);
  assert.equal(validateMigrationCoverage(read("contracts/examples/migration-coverage.example.json")).ok, true);
  assert.equal(validateMigrationReconciliation(read("contracts/examples/migration-reconciliation.example.json")).ok, true);
  assert.equal(validateMigrationExport(read("contracts/examples/migration-export.example.json")).ok, true);
  assert.equal(validateMigrationApproval(read("contracts/examples/migration-approval.example.json")).ok, true);
});

test("den genererede rapports afstemning, eksport og godkendelse validerer", () => {
  for (const summary of report.sourceSummaries) {
    assert.equal(validateMigrationReconciliation(summary.reconciliation).ok, true);
    assert.equal(summary.reconciliation.checksums.match, true);
  }
  assert.equal(validateMigrationExport(report.exportSample).ok, true);
  assert.equal(validateMigrationApproval(report.approvalSample, undefined, { tenantId: "acme", appId: "files" }).ok, true);
});

test("en kilde med et ikke-dokumenteret format afvises", () => {
  const broken = JSON.parse(JSON.stringify(sources));
  broken.sources[0].format.documented = false;
  assert.ok(validateMigrationSource(broken).errors.length > 0);
});

test("en kilde med en manglende dækningsfacette afvises", () => {
  const broken = JSON.parse(JSON.stringify(sources));
  delete broken.sources[0].facets.File.links;
  assert.ok(validateMigrationSource(broken).errors.length > 0);
});

test("en ikke-understøttet facet uden forklaring afvises", () => {
  const broken = JSON.parse(JSON.stringify(sources));
  const folder = broken.sources.find((s) => s.id === "files-acme").facets.Folder;
  folder.comments = { status: "unsupported" };
  assert.ok(migrationSourceProblems(broken).some((p) => /forklaring/.test(p.message)));
});

test("en politik der tillader tværtenant-import afvises", () => {
  const broken = JSON.parse(JSON.stringify(policy));
  broken.authorization.crossTenantImport = true;
  assert.ok(migrationPolicyProblems(broken).some((p) => p.path === "/authorization/crossTenantImport"));
});

test("en politik der tillader automatisk fletning afvises", () => {
  const broken = JSON.parse(JSON.stringify(policy));
  broken.import.businessRecordsNeverMerged = false;
  assert.ok(validateMigrationPolicy(broken).errors.length > 0);
});

test("en afstemning med et checksum-mismatch afvises", () => {
  const broken = JSON.parse(JSON.stringify(report.sourceSummaries[0].reconciliation));
  broken.checksums.target = "0".repeat(64);
  broken.checksums.match = true;
  assert.ok(validateMigrationReconciliation(broken).errors.length > 0);
});

test("en eksport uden en facet afvises", () => {
  const broken = JSON.parse(JSON.stringify(report.exportSample));
  broken.includes.acl = false;
  assert.ok(validateMigrationExport(broken).errors.length > 0);
});

test("en godkendelse uden ACL-godkendelse afvises", () => {
  const broken = JSON.parse(JSON.stringify(report.approvalSample));
  broken.aclApproved = false;
  assert.ok(validateMigrationApproval(broken).errors.length > 0);
});

test("en godkendelse fra operatøren selv afvises", () => {
  const broken = JSON.parse(JSON.stringify(report.approvalSample));
  assert.ok(validateMigrationApproval(broken, undefined, { operatorSubject: broken.approvedBy.subject }).errors.length > 0);
});
