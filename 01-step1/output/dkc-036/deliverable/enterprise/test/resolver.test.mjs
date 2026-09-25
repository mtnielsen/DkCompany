import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../../conformance/src/schemas.mjs";
import { loadComponents, loadProfiles } from "../../distribution/src/catalog.mjs";
import { loadAll } from "../src/model.mjs";
import { resolveEnterprisePackage } from "../src/resolver.mjs";

const components = loadComponents();
const profiles = loadProfiles();
const all = loadAll(repoRoot);

function resolve(pkg) {
  return resolveEnterprisePackage(pkg, { components, profiles, capabilityCatalog: all.capabilities });
}

test("hver kanonisk pakke løses gennem den faktiske dependency-resolver", () => {
  for (const pkg of all.packages.packages) {
    const result = resolve(pkg);
    assert.ok(result.profile, `${pkg.id} mangler en basisprofil`);
    assert.ok(result.closure.length > 0, `${pkg.id} har en tom closure`);
  }
});

test("understøttede pakker opfylder deres kapabilitetskrav", () => {
  for (const id of ["enterprise-core", "retail-commerce", "regulated-care"]) {
    const pkg = all.packages.packages.find((p) => p.id === id);
    const result = resolve(pkg);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    for (const cap of pkg.capabilityConstraints.required) {
      assert.ok(result.capabilities.includes(cap), `${id} mangler kapabiliteten ${cap}`);
    }
  }
});

test("produktion og feltservice blokeres af ikke-understøttede kapabiliteter", () => {
  const manufacturing = resolve(all.packages.packages.find((p) => p.id === "manufacturing"));
  assert.equal(manufacturing.ok, false);
  assert.ok(manufacturing.errors.some((e) => /UNSUPPORTED_CAPABILITY: den påkrævede kapabilitet 'mes'/.test(e)));
  assert.ok(manufacturing.errors.some((e) => /UNSUPPORTED_CAPABILITY: den påkrævede kapabilitet 'plm'/.test(e)));

  const field = resolve(all.packages.packages.find((p) => p.id === "field-service"));
  assert.equal(field.ok, false);
  assert.ok(field.errors.some((e) => /UNSUPPORTED_CAPABILITY: den påkrævede kapabilitet 'field-dispatch'/.test(e)));
});

test("forbudte kapabiliteter må ikke være til stede i closuren", () => {
  const pkg = JSON.parse(JSON.stringify(all.packages.packages.find((p) => p.id === "retail-commerce")));
  pkg.capabilityConstraints.forbidden = ["control-plane"];
  const result = resolve(pkg);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /FORBIDDEN_CAPABILITY/.test(e)));
});

test("kontrolplans-kapabiliteter arves fra størrelsesprofilens sikkerhedskerne", () => {
  const pkg = all.packages.packages.find((p) => p.id === "enterprise-core");
  const result = resolve(pkg);
  for (const cap of pkg.capabilityConstraints.controlPlane) {
    assert.ok(result.capabilities.includes(cap), `kontrolplans-kapabiliteten ${cap} mangler`);
  }
  const forked = JSON.parse(JSON.stringify(pkg));
  forked.capabilityConstraints.controlPlane = ["commerce"];
  const broken = resolve(forked);
  assert.equal(broken.ok, false);
  assert.ok(broken.errors.some((e) => /CONTROL_PLANE_FORK|MISSING_CONTROL_PLANE|ikke en kontrolplans/.test(e)));
});

test("en ukendt basisprofil afvises", () => {
  const pkg = JSON.parse(JSON.stringify(all.packages.packages[0]));
  pkg.baseProfileRef = "ukendt-profil";
  const result = resolve(pkg);
  assert.equal(result.ok, false);
  assert.equal(result.code, "UNKNOWN_BASE_PROFILE");
});
