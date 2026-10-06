/**
 * DKC-053 — installationsprofiler, platformmatrix og profilbinding.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadComponents, loadProfiles, loadPlatforms, loadDeploymentProfiles, catalogIntegrityProblems, securityCoreIds, repoRoot } from "../src/catalog.mjs";
import { profileBindingProblems, platformCoverageProblems, findDeploymentProfile, currentPlatformId } from "../src/profiles.mjs";
import { resolveDependencies } from "../src/resolver.mjs";
import { validateProfileDir, validatePlatformMatrix, validateComponentDir } from "../../conformance/src/distribution.mjs";
import { loadServiceClasses } from "../../continuity/src/classes.mjs";

test("alle komponentmanifester validerer (skema + semantik)", () => {
  const results = validateComponentDir();
  assert.ok(results.length >= 10, `forventede mindst 10 komponenter, fandt ${results.length}`);
  for (const r of results) assert.equal(r.ok, true, `${r.file}:\n${r.errors.map((e) => `${e.path} ${e.message}`).join("\n")}`);
});

test("alle installationsprofiler validerer (skema + semantik)", () => {
  const results = validateProfileDir();
  assert.equal(results.length, 3);
  for (const r of results) assert.equal(r.ok, true, `${r.file}:\n${r.errors.map((e) => `${e.path} ${e.message}`).join("\n")}`);
});

test("platformmatricen validerer og hver kombination er testbar", () => {
  const { data, platforms } = loadPlatforms();
  assert.ok(data, "catalog/platforms.json mangler");
  const result = validatePlatformMatrix(data);
  assert.equal(result.ok, true, result.errors.map((e) => `${e.path} ${e.message}`).join("\n"));
  assert.ok(platforms.length >= 3);
  for (const p of platforms) assert.ok(p.testCommand, `${p.id} mangler testkommando`);
});

test("kataloget er internt konsistent", () => {
  assert.deepEqual(catalogIntegrityProblems(loadComponents()), []);
});

test("hver profil er bundet til en deployment-profil og dækker sikkerhedskernen", () => {
  const components = loadComponents();
  const profiles = loadProfiles();
  const deploymentProfiles = loadDeploymentProfiles();
  assert.deepEqual(profileBindingProblems(profiles, components, deploymentProfiles), []);
  assert.deepEqual(platformCoverageProblems(profiles, loadPlatforms().platforms), []);
  const core = new Set(securityCoreIds(components));
  assert.deepEqual([...core].sort(), ["audit-service", "identity-broker", "platform-core"]);
  for (const p of profiles) {
    for (const id of core) assert.ok(p.data.securityCore.includes(id), `${p.file} mangler ${id}`);
  }
});

test("profilernes platformskombinationer findes i matricen", () => {
  const platforms = new Set(loadPlatforms().platforms.map((p) => p.id));
  for (const p of loadProfiles()) {
    for (const id of p.data.supportedPlatforms) assert.ok(platforms.has(id), `${p.file}: ukendt platform ${id}`);
  }
});

test("single-server bruges med accepteret non-HA-serviceklasse og ekstern backup", () => {
  const components = loadComponents();
  const p = loadProfiles().find((x) => x.data.metadata.name === "small-vps").data;
  assert.equal(p.profileType, "single-server");
  assert.equal(p.highAvailability.enabled, false);
  assert.equal(p.highAvailability.acceptedNonHaServiceClass, true);
  assert.equal(p.highAvailability.externalBackupRequired, true);
  const deploymentProfile = findDeploymentProfile(loadDeploymentProfiles(), p.deploymentProfileRef);
  assert.equal(deploymentProfile.highAvailability.enabled, false);
  assert.ok(deploymentProfile.dataServices.some((d) => d.kind === "backup-destination"));
  const result = resolveDependencies({ components, profile: p, selection: ["bi"], deploymentProfile, serviceClasses: loadServiceClasses() });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.safety.ok, true, JSON.stringify(result.safety.errors));
});

test("single-server uden non-HA-accept afvises", () => {
  const components = loadComponents();
  const p = { ...loadProfiles().find((x) => x.data.metadata.name === "small-vps").data, highAvailability: { enabled: false, acceptedNonHaServiceClass: false, externalBackupRequired: true } };
  const deploymentProfile = findDeploymentProfile(loadDeploymentProfiles(), p.deploymentProfileRef);
  const result = resolveDependencies({ components, profile: p, selection: ["bi"], deploymentProfile, serviceClasses: loadServiceClasses() });
  assert.equal(result.safety.ok, false);
  assert.ok(result.safety.errors.some((e) => e.code === "NON_HA_NOT_ACCEPTED"));
});

test("migrationsvejen fra single-server til HA findes og har forventet nedetid", () => {
  const profiles = loadProfiles();
  const ha = profiles.find((x) => x.data.metadata.name === "ha-cluster").data;
  assert.equal(ha.profileType, "multiple-servers");
  assert.equal(ha.migration.from, "small-vps");
  assert.equal(ha.migration.to, "ha-cluster");
  assert.ok(ha.migration.expectedDowntimeMinutes > 0, "HA-migrationen skal have en forventet nedetid");
  assert.ok(ha.migration.steps.length >= 3);
  assert.ok(existsSync(join(repoRoot, ha.migration.pathRef)), `migrationsdokumentet ${ha.migration.pathRef} mangler`);
  for (const p of profiles) {
    assert.ok(existsSync(join(repoRoot, p.data.migration.pathRef)), `${p.file}: migrationsdokument ${p.data.migration.pathRef} mangler`);
  }
});

test("en single-server-klasse kan ikke installeres på HA (fail-closed)", () => {
  const components = loadComponents();
  const p = loadProfiles().find((x) => x.data.metadata.name === "ha-cluster").data;
  const deploymentProfile = findDeploymentProfile(loadDeploymentProfiles(), p.deploymentProfileRef);
  // communications leveres af Mattermost-adapteren, hvis serviceklasse kun understøtter single-server.
  const result = resolveDependencies({ components, profile: p, selection: ["communications"], deploymentProfile, serviceClasses: loadServiceClasses() });
  assert.equal(result.ok, false);
  assert.ok(result.safety.errors.some((e) => e.code === "SERVICE_CLASS_PROFILE_MISMATCH"), JSON.stringify(result.safety.errors));
});

test("host-styring er separat opt-in i alle profiler", () => {
  for (const p of loadProfiles()) {
    assert.equal(p.data.hostManagement.optIn, true, `${p.file}: host-styring skal være opt-in`);
  }
  const components = loadComponents();
  const host = components.find((c) => c.data.metadata.name === "host-management").data;
  assert.equal(host.securityCore, false);
  assert.equal(host.componentType, "host-management");
});

test("currentPlatformId genkender en understøttet kombination", () => {
  const platforms = loadPlatforms().platforms;
  assert.equal(currentPlatformId(platforms, { platform: "linux", arch: "x64", nodeVersion: "22.22.1" }), "linux-amd64-node22");
  assert.equal(currentPlatformId(platforms, { platform: "linux", arch: "arm64", nodeVersion: "22.0.0" }), "linux-arm64-node22");
  assert.equal(currentPlatformId(platforms, { platform: "linux", arch: "x64", nodeVersion: "18.0.0" }), null);
});
