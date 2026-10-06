/**
 * DKC-053 — konformanstests for katalog, profiler og dependency-resolver.
 *
 * Beviser på de faktiske datafiler at sikkerhedskernen er obligatorisk, at
 * valgfrie applikationer kan tilvælges enkeltvis, og at ugyldige
 * komponent-/profil-/platformsmanifester afvises.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { validateComponentDir, validateProfileDir, validatePlatformMatrix, componentManifestProblems, installationProfileProblems } from "../src/distribution.mjs";
import { loadComponents, loadProfiles, loadPlatforms, loadDeploymentProfiles, catalogIntegrityProblems, securityCoreIds } from "../../distribution/src/catalog.mjs";
import { resolveDependencies } from "../../distribution/src/resolver.mjs";
import { findDeploymentProfile, profileBindingProblems, platformCoverageProblems } from "../../distribution/src/profiles.mjs";
import { loadServiceClasses } from "../../continuity/src/classes.mjs";

const fixturesDir = join(import.meta.dirname, "fixtures", "distribution");

test("alle katalogets komponentmanifester validerer", () => {
  const results = validateComponentDir();
  assert.ok(results.length >= 10);
  for (const r of results) assert.equal(r.ok, true, `${r.file}:\n${r.errors.map((e) => `${e.path} ${e.message}`).join("\n")}`);
});

test("alle installationsprofiler validerer", () => {
  const results = validateProfileDir();
  assert.equal(results.length, 3);
  for (const r of results) assert.equal(r.ok, true, `${r.file}`);
});

test("platformmatricen validerer", () => {
  const { data } = loadPlatforms();
  assert.equal(validatePlatformMatrix(data).ok, true);
});

test("kataloget er konsistent og har en obligatorisk sikkerhedskerne", () => {
  const components = loadComponents();
  assert.deepEqual(catalogIntegrityProblems(components), []);
  assert.deepEqual(securityCoreIds(components), ["audit-service", "identity-broker", "platform-core"]);
});

test("ugyldige komponentmanifester afvises (team-ejer, uverificeret download)", () => {
  const results = validateComponentDir(fixturesDir, { pattern: /^component\./ });
  assert.ok(results.length >= 1);
  for (const r of results) assert.equal(r.ok, false, `${r.file} skulle være afvist`);
  const errors = results.flatMap((r) => r.errors.map((e) => `${e.path} ${e.message}`));
  assert.ok(errors.some((e) => /accountableHuman/.test(e)), errors.join("\n"));
  assert.ok(errors.some((e) => /verificeres/.test(e)), errors.join("\n"));
});

test("ugyldige installationsprofiler og platforme afvises", () => {
  const profiles = validateProfileDir(fixturesDir, { pattern: /^profile\./ });
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].ok, false);
  const msgs = profiles[0].errors.map((e) => `${e.path} ${e.message}`).join("\n");
  assert.match(msgs, /acceptedNonHaServiceClass|optIn/);

  const { data } = loadPlatforms();
  const platformEvents = JSON.parse(JSON.stringify(data));
  platformEvents.platforms[0].testCommand = "";
  const result = validatePlatformMatrix(platformEvents);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /testCommand/.test(e.path)));
});

test("semantiske validatorer fanger manglende begrundelser", () => {
  const bad = JSON.parse(JSON.stringify(loadComponents()[0].data));
  bad.dataServices = [{ id: "sql", kind: "relational", required: true, reason: "kort" }];
  assert.ok(componentManifestProblems(bad).some((e) => /dataServices/.test(e.path)));

  const p = JSON.parse(JSON.stringify(loadProfiles()[0].data));
  p.migration.expectedDowntimeMinutes = -1;
  assert.ok(installationProfileProblems(p).some((e) => /expectedDowntimeMinutes/.test(e.path)));
});

test("hver profil resolverer med og uden valgfrie applikationer", () => {
  const components = loadComponents();
  const deploymentProfiles = loadDeploymentProfiles();
  const serviceClasses = loadServiceClasses();
  for (const entry of loadProfiles()) {
    const deploymentProfile = findDeploymentProfile(deploymentProfiles, entry.data.deploymentProfileRef);
    for (const apps of [[], entry.data.optionalApplications]) {
      const result = resolveDependencies({ components, profile: entry.data, selection: apps, deploymentProfile, serviceClasses });
      assert.equal(result.ok, true, `${entry.file} (${apps.join(",")}): ${JSON.stringify(result.errors)}`);
      assert.equal(result.safety.ok, true, `${entry.file} (${apps.join(",")}): ${JSON.stringify(result.safety.errors)}`);
      for (const id of entry.data.securityCore) assert.ok(result.closure.includes(id));
    }
  }
});

test("profilbinding og platformdækning er komplet", () => {
  assert.deepEqual(profileBindingProblems(loadProfiles(), loadComponents(), loadDeploymentProfiles()), []);
  assert.deepEqual(platformCoverageProblems(loadProfiles(), loadPlatforms().platforms), []);
});
