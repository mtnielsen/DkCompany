import { test } from "node:test";
import assert from "node:assert/strict";
import { loadProfiles as loadFeatureProfiles, indexProfiles } from "../src/index.mjs";
import { resolveDependencies } from "../../distribution/src/resolver.mjs";
import { loadComponents, loadProfiles as loadInstallProfiles, loadDeploymentProfiles } from "../../distribution/src/catalog.mjs";
import { findProfile, findDeploymentProfile } from "../../distribution/src/profiles.mjs";
import { loadServiceClasses } from "../../continuity/src/classes.mjs";

function resolve(selection) {
  const components = loadComponents();
  const profiles = loadInstallProfiles();
  const deploymentProfiles = loadDeploymentProfiles();
  const profile = findProfile(profiles, "small-vps");
  return resolveDependencies({
    components,
    profile,
    selection,
    deploymentProfile: findDeploymentProfile(deploymentProfiles, profile.deploymentProfileRef),
    serviceClasses: loadServiceClasses(),
  });
}

test("reporting kan installeres mod en ekstern HR-kilde uden HR/Communications-applikationerne", () => {
  const result = resolve(["reporting"]);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  for (const required of ["reporting", "bi", "platform-core", "identity-broker", "audit-service", "analytics-store", "primary-database", "object-store"]) {
    assert.ok(result.closure.includes(required), `reporting-closure mangler '${required}': ${result.closure.join(", ")}`);
  }
  for (const forbidden of ["hr", "communications", "host-management"]) {
    assert.ok(!result.closure.includes(forbidden), `reporting-installation må ikke indeholde '${forbidden}': ${result.closure.join(", ")}`);
  }
});

test("den erklærede reporting-profil bruger en ekstern HR-kilde i stedet for HR-applikationen", () => {
  const profile = indexProfiles(loadFeatureProfiles()).reporting;
  assert.ok(!profile.modules.includes("hr"));
  assert.ok(!profile.modules.includes("communications"));
  const external = profile.externalSources.find((s) => s.id === "external-hr-source");
  assert.equal(external.access, "read-only");
  assert.equal(external.connectorRequired, true);
});
