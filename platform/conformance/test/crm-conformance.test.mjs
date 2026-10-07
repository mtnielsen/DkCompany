/**
 * DKC-030 — konformanstest for CRM med entydigt ejerskab af kundedata.
 *
 * Tester skema + semantik på de faktiske kilder, politikken, eksemplerne og den
 * genererede rapports post og sletterapport, og at et brud afvises. En målt
 * integration mod en levende EspoCRM er og forbliver NOT RUN.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../src/schemas.mjs";
import { validateCrmSource, validateCrmRecord, validateCrmDeletionReceipt, validateCrmPolicy } from "../src/crm.mjs";
import { crmRecordProblems, crmDeletionReceiptProblems } from "../../crm/src/model.mjs";

function read(rel) {
  return JSON.parse(readFileSync(join(repoRoot, rel), "utf8"));
}

const sources = read("crm/sources.json");
const policy = read("crm/policy.json");
const report = read("crm/report/crm-report.json");

test("den faktiske CRM-kilde validerer mod skema og semantik", () => {
  const tenantIds = new Set(sources.sources.map((s) => s.tenantId));
  assert.equal(validateCrmSource(sources, undefined, { supportedTenants: tenantIds }).ok, true);
});

test("den faktiske CRM-politik validerer", () => {
  assert.equal(validateCrmPolicy(policy).ok, true);
});

test("eksemplerne validerer, og kandidaterne er skemagyldige", () => {
  assert.equal(validateCrmSource(read("contracts/examples/crm-source.example.json")).ok, true);
  assert.equal(validateCrmRecord(read("contracts/examples/crm-record.example.json")).ok, true);
  assert.equal(validateCrmDeletionReceipt(read("contracts/examples/crm-deletion-receipt.example.json")).ok, true);
  for (const file of ["integration-candidate.espocrm.example.json", "integration-candidate.erpnext.example.json"]) {
    const candidate = read(`contracts/examples/${file}`);
    assert.equal(candidate.kind, "IntegrationCandidate");
    assert.ok(candidate.sso.supported);
    assert.ok(candidate.verification.status !== "approved" || candidate.backup.restoreTested === true);
  }
});

test("den genererede rapports post og sletterapport validerer", () => {
  assert.ok(report.recordSample, "rapporten mangler en post");
  assert.equal(validateCrmRecord(report.recordSample).ok, true);
  assert.equal(crmRecordProblems(report.recordSample).length, 0);
  assert.equal(validateCrmDeletionReceipt(report.deletionSample).ok, true);
  assert.equal(report.candidateSample.selected, "espocrm");
  assert.equal(report.backup.ok, true);
});

test("en kilde der ikke er EspoCRM afvises", () => {
  const broken = JSON.parse(JSON.stringify(sources));
  broken.sources[0].type = "salesforce";
  assert.ok(validateCrmSource(broken).errors.length > 0);
});

test("en rå hemmelighed i stedet for en secretreference afvises", () => {
  const broken = JSON.parse(JSON.stringify(sources));
  broken.sources[0].secretRef = "super-hemmelig-noegle";
  assert.ok(validateCrmSource(broken).errors.length > 0);
});

test("en politik der tillader tværtenant-dedup afvises", () => {
  const broken = JSON.parse(JSON.stringify(policy));
  broken.dedup.crossTenantDedup = true;
  assert.ok(validateCrmPolicy(broken).errors.length > 0);
});

test("en post med en tværtenant-reference afvises", () => {
  const broken = { ...report.recordSample, reference: "crm:globex:Contact:2001", tenantId: "acme" };
  assert.ok(crmRecordProblems(broken).some((p) => p.path === "/tenantId"));
});

test("en fuld sletterapport med resterende kopier afvises", () => {
  const broken = { ...report.deletionSample, status: "full", remainingCopies: [{ kind: "backup", resource: "x", reason: "y", expiresAt: "2026-05-30T00:00:00Z" }] };
  assert.ok(crmDeletionReceiptProblems(broken).some((p) => p.path === "/remainingCopies"));
});
