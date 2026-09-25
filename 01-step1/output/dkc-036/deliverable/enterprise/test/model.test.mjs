import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../../conformance/src/schemas.mjs";
import { loadComponents, loadProfiles } from "../../distribution/src/catalog.mjs";
import {
  loadAll,
  capabilityCatalogProblems,
  securityContractProblems,
  packageCatalogProblems,
  packageProblems,
} from "../src/model.mjs";

const components = loadComponents();
const profiles = loadProfiles();
const all = loadAll(repoRoot);
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

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
function fixture(name) {
  return JSON.parse(readFileSync(join(repoRoot, "enterprise", "fixtures", name), "utf8"));
}
function wrap(pkg) {
  return { ...clone(all.packages), packages: [pkg] };
}

test("kapabilitetsregisteret svarer til de faktiske komponentmanifester", () => {
  const problems = capabilityCatalogProblems(all.capabilities, components);
  assert.equal(problems.length, 0, JSON.stringify(problems));
});

test("de tre størrelsesprofiler deler de samme sikkerhedskontrakter", () => {
  const problems = securityContractProblems(all.packages, all.gatePolicy, profiles);
  assert.equal(problems.length, 0, JSON.stringify(problems));
  const broken = clone(profiles);
  broken.find((p) => p.data.metadata.name === "small-vps").data.securityCore = ["platform-core"];
  assert.ok(securityContractProblems(all.packages, all.gatePolicy, broken).length > 0);
});

test("det kanoniske pakkekatalog er semantisk konsistent", () => {
  const problems = packageCatalogProblems(all.packages, context);
  assert.equal(problems.length, 0, JSON.stringify(problems));
});

test("en pakke med både påkrævet og forbudt kapabilitet afvises", () => {
  const problems = packageProblems(fixture("conflicting.package.json"), context);
  assert.ok(problems.some((p) => /både påkrævet og forbudt/.test(p.message)), JSON.stringify(problems));
});

test("en manglende navngivet ejer/testkunde afvises", () => {
  const problems = packageProblems(fixture("missing-owner.package.json"), context);
  assert.ok(problems.some((p) => /\/productOwner$/.test(p.path)), JSON.stringify(problems));
  assert.ok(problems.some((p) => /\/testCustomer\/contact$/.test(p.path)), JSON.stringify(problems));
});

test("en bestilt pakke uden ordre og godkender afvises", () => {
  const problems = packageProblems(fixture("auto-build.package.json"), context);
  assert.ok(problems.some((p) => /ordrereference/.test(p.message)), JSON.stringify(problems));
  assert.ok(problems.some((p) => /\/implementation\/approvedBy$/.test(p.path)), JSON.stringify(problems));
});

test("en ukendt påkrævet kapabilitet er tilladt og markeres i resolveren, ikke som skemafejl", () => {
  const pkg = fixture("unsupported.package.json");
  const problems = packageProblems(pkg, context);
  assert.equal(problems.length, 0, JSON.stringify(problems));
});

test("en pakke må ikke forke kontrolplanet ved at kræve en ikke-kanonisk kapabilitet", () => {
  const broken = wrap(clone(all.packages.packages[0]));
  broken.packages[0].capabilityConstraints.controlPlane.push("commerce");
  const problems = packageCatalogProblems(broken, context);
  assert.ok(problems.some((p) => /ikke en kontrolplans-kapabilitet/.test(p.message)), JSON.stringify(problems));
});

test("special-category-data kræver mindst forhøjet isolation", () => {
  const broken = wrap(clone(all.packages.packages.find((p) => p.id === "regulated-care")));
  broken.packages[0].isolation.level = "standard";
  const problems = packageCatalogProblems(broken, context);
  assert.ok(problems.some((p) => /forhøjet isolation/.test(p.message)), JSON.stringify(problems));
});
