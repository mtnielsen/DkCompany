/**
 * DKC-036 — konformanstest for enterprise- og branchepakker.
 *
 * Tester skema + semantik på det faktiske pakkekatalog, kapabilitetsregisteret,
 * eksemplet og den genererede rapport, og at et brud afvises (en pakke der forker
 * kontrolplanet, en manglende fælles sikkerhedskontrakt, en syntetisk testkunde
 * der fremstår samtykkende, og en rapport der erklærer en pakke implementerbar).
 * En faktisk testkunde og en bekræftet faglig/sektor-/AI-vurdering er og
 * forbliver NOT RUN.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../src/schemas.mjs";
import { loadComponents, loadProfiles } from "../../distribution/src/catalog.mjs";
import { validateEnterprisePackages, validateCapabilityCatalog, validateEnterprisePackageReport } from "../src/enterprise.mjs";
import { loadAll } from "../../enterprise/src/model.mjs";

function read(rel) {
  return JSON.parse(readFileSync(join(repoRoot, rel), "utf8"));
}
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const all = loadAll(repoRoot);
const components = loadComponents();
const profiles = loadProfiles();
const exampleFiles = new Set(readdirSync(join(repoRoot, "contracts", "examples")));
const context = {
  capabilities: all.capabilities,
  components,
  profiles,
  gatePolicy: all.gatePolicy,
  tco: all.tco,
  companyProfiles: all.companyProfiles,
  pilotProfiles: all.pilotProfiles,
  exampleFiles,
};

test("det faktiske pakkekatalog validerer mod skema og semantik", () => {
  assert.equal(validateEnterprisePackages(all.packages, undefined, context).ok, true);
});

test("kapabilitetsregisteret validerer mod komponenterne", () => {
  assert.equal(validateCapabilityCatalog(all.capabilities, components).ok, true);
});

test("eksemplet validerer", () => {
  assert.equal(validateEnterprisePackages(read("contracts/examples/enterprise-package.example.json"), undefined, context).ok, true);
});

test("den genererede rapport validerer og erklærer ingen implementerbar pakke", () => {
  const report = read("enterprise/report/enterprise-package-report.json");
  assert.equal(validateEnterprisePackageReport(report).ok, true);
  assert.equal(report.measured, false);
  assert.equal(report.summary.implementable, 0);
  for (const pkg of report.packages) assert.equal(pkg.implementable, false, pkg.id);
});

test("en pakke der forker kontrolplanet afvises", () => {
  const broken = clone(all.packages);
  broken.packages[0].capabilityConstraints.controlPlane.push("commerce");
  assert.ok(validateEnterprisePackages(broken, undefined, context).errors.length > 0);
});

test("en manglende fælles sikkerhedskontrakt afvises", () => {
  const broken = clone(all.packages);
  broken.securityContracts.contracts = broken.securityContracts.contracts.filter((c) => c.id !== "privacy");
  assert.ok(validateEnterprisePackages(broken, undefined, context).errors.length > 0);
});

test("en syntetisk testkunde der fremstår samtykkende afvises", () => {
  const broken = clone(all.packages);
  broken.packages[0].testCustomer.status = "consented";
  broken.packages[0].testCustomer.contractRef = "contract://syntetisk";
  assert.ok(validateEnterprisePackages(broken, undefined, context).errors.length > 0);
});

test("en rapport der erklærer en pakke implementerbar med blokeringer afvises", () => {
  const report = read("enterprise/report/enterprise-package-report.json");
  const broken = clone(report);
  broken.packages[0].implementable = true;
  broken.summary.implementable = 1;
  assert.ok(validateEnterprisePackageReport(broken).errors.length > 0);
});
