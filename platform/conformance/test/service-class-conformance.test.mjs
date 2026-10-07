/**
 * DKC-037 — konformanstests for serviceklasser og recoverymål.
 *
 * Beviser på de faktiske datafiler at:
 *   - alle pilotmoduler har en serviceklasse med eksplicit netværkspartition,
 *   - serviceklasserne er kompatible med deployment-profilerne,
 *   - single-server er non-HA og HA-badgen kræver tre failure domains, N+1 og
 *     særskilt recovery-lokation,
 *   - umulige/konfliktende krav afvises,
 *   - en konfigurationspost ikke i sig selv certificerer et målt serviceniveau.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { validateServiceClassDir } from "../src/service-classes.mjs";
import { loadServiceClasses, pilotModules, checkModuleCoverage, validateServiceClasses } from "../../continuity/src/classes.mjs";
import { checkProfileCompatibility, loadDeploymentProfiles } from "../../continuity/src/profile-check.mjs";
import { buildRecoveryReport } from "../../continuity/src/recovery.mjs";

const fixturesDir = join(import.meta.dirname, "fixtures", "service-class");

test("alle serviceklasser validerer mod skema + semantik", () => {
  const results = validateServiceClasses();
  assert.ok(results.length >= 4, `forventede mindst 4 serviceklasser, fandt ${results.length}`);
  for (const r of results) assert.equal(r.ok, true, `${r.file}:\n${r.errors.map((e) => `${e.path} ${e.message}`).join("\n")}`);
});

test("hvert pilotmodul har en serviceklasse med eksplicit netværkspartition", () => {
  assert.deepEqual(checkModuleCoverage(), []);
  for (const sc of loadServiceClasses()) {
    const np = sc.data.failureModel?.networkPartition;
    assert.ok(np?.behavior, `${sc.file} mangler netværkspartition`);
    assert.ok((np.description ?? "").length >= 10, `${sc.file} mangler beskrivelse af netværkspartition`);
  }
  assert.ok(pilotModules().length >= 4);
});

test("serviceklasser og deployment-profiler er kompatible", () => {
  assert.deepEqual(checkProfileCompatibility(), []);
  const profiles = loadDeploymentProfiles();
  assert.ok(profiles.some((p) => p.data.highAvailability?.enabled === true));
  assert.ok(profiles.some((p) => p.data.highAvailability?.enabled !== true));
});

test("single-server er non-HA og HA-egnede klasser har tre failure domains", () => {
  for (const sc of loadServiceClasses()) {
    const compat = sc.data.deploymentProfileCompatibility;
    if (compat.profiles.includes("single-server")) {
      assert.equal(compat.haEligible, false, `${sc.file}: single-server må ikke være HA-egnet`);
      assert.equal(sc.data.availability.acceptedDowntime, true, `${sc.file}: single-server kræver acceptedDowntime`);
    }
    if (compat.haEligible) {
      assert.ok(compat.failureDomains >= 3, `${sc.file}: HA kræver >= 3 failure domains`);
      assert.equal(compat.nPlusOne, true, `${sc.file}: HA kræver N+1`);
      assert.ok((compat.recoveryLocation ?? "").length >= 3, `${sc.file}: HA kræver særskilt recovery-lokation`);
    }
  }
});

test("umulige/konfliktende fixtures afvises", () => {
  const results = validateServiceClassDir(fixturesDir, { pattern: /^service-class\./ });
  assert.ok(results.length >= 2);
  for (const r of results) assert.equal(r.ok, false, `${r.file} skulle være afvist`);
  const byFile = Object.fromEntries(results.map((r) => [r.file, r.errors.map((e) => `${e.path} ${e.message}`).join("\n")]));
  assert.match(byFile["service-class.ha-single-server.invalid.json"], /single-server.*HA-badge/);
  assert.match(byFile["service-class.multiwriter.invalid.json"], /upstreamSupportsMultiWriter/);
});

test("en konfigurationspost certificerer ikke et målt serviceniveau", () => {
  const report = buildRecoveryReport({ serviceClasses: loadServiceClasses() });
  for (const entry of report.entries) {
    assert.notEqual(entry.measured.status, "measured", `${entry.name}: en fil er ikke en probe`);
    assert.equal(entry.haBadge, false, `${entry.name}: HA-badge uden frisk failover-måling`);
  }
  assert.ok(report.entries.some((e) => e.commitment === "accepted" && e.measured.status === "declared-only"), "en accepteret klasse med erklæret måling skal være declared-only");
  assert.ok(report.entries.some((e) => e.commitment === "proposed"), "mindst én klasse er foreslået og endnu ikke vedtaget");
});
