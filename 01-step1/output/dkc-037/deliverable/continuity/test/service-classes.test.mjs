/**
 * DKC-037 — serviceklasser, moduldækning og umulige/konfliktende krav.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateServiceClass } from "../../conformance/src/service-classes.mjs";
import { loadServiceClasses, pilotModules, checkModuleCoverage, validateServiceClasses } from "../src/classes.mjs";
import { checkProfileCompatibility, loadDeploymentProfiles } from "../src/profile-check.mjs";

function baseClass(overrides = {}) {
  return {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "ServiceClass",
    metadata: {
      name: "svc-a",
      version: "1.0.0",
      description: "En gyldig testserviceklasse med eksplicit adfærd.",
      accountableHuman: { subject: "oidc|anna.andersen", name: "Anna Andersen", role: "Platform Owner" },
    },
    moduleRef: "dummy-ok",
    criticality: "medium",
    biaRef: "docs/continuity/bia.md#dummy-ok",
    failureModel: {
      networkPartition: { behavior: "fail-closed", splitBrain: "forbidden", quorumRequired: false, description: "Afviser nye skrivninger uden databaseforbindelse." },
      corruptionDetection: { method: "checksum", detectionWindowMinutes: 1440 },
    },
    availability: { targetPercent: 99.0, measurementWindowDays: 30, acceptedDowntime: true },
    durability: {
      confirmedWrites: { rpoMinutes: 0, strategy: "commit", basis: "Et bekræftet write må ikke forsvinde." },
      regionFailure: { rpoMinutes: 240, strategy: "offsite backup", basis: "Regionsnedbrud accepteret med fire timers tab." },
      corruption: { rpoMinutes: 1440, strategy: "snapshots", basis: "Korruption gendannes fra verificeret snapshot." },
    },
    recovery: {
      rtoMinutes: 240,
      restoreOrder: ["database", "svc"],
      healing: { automated: false, allowedActions: ["restart"], forbiddenActions: ["manual-data-edit"], requiresHumanApproval: ["restore-from-backup"] },
    },
    replication: { replicas: 1, statefulMode: "stateful", storageClass: "standard-rwo", consistency: "strong", writeMode: "single-writer", activeWriters: 1, upstreamSupportsMultiWriter: false },
    backup: { required: true, mode: "external", offsite: true, encrypted: true, restoreTested: true, retentionDays: 30 },
    deploymentProfileCompatibility: { profiles: ["single-server"], haEligible: false, failureDomains: 1, nPlusOne: false },
    serviceCommitment: { state: "proposed" },
    ...overrides,
  };
}

function problemsOf(data) {
  return validateServiceClass(data).errors.map((e) => `${e.path} ${e.message}`);
}

test("alle serviceklasser i repoet validerer", () => {
  const results = validateServiceClasses();
  assert.ok(results.length >= 4, `forventede mindst 4 serviceklasser, fandt ${results.length}`);
  for (const r of results) assert.equal(r.ok, true, `${r.file}:\n${r.errors.map((e) => `${e.path} ${e.message}`).join("\n")}`);
});

test("hvert pilotmodul har en serviceklasse med eksplicit netværkspartition", () => {
  const problems = checkModuleCoverage();
  assert.deepEqual(problems, []);
  for (const sc of loadServiceClasses()) {
    assert.ok(sc.data.failureModel.networkPartition.behavior, `${sc.file} mangler netværkspartition`);
  }
  assert.ok(pilotModules().length >= 4);
});

test("deployment-profiler og serviceklasser er kompatible", () => {
  const problems = checkProfileCompatibility();
  assert.deepEqual(problems, []);
  const profiles = loadDeploymentProfiles();
  assert.ok(profiles.some((p) => p.data.highAvailability?.enabled === true), "der skal findes en HA-profil");
  assert.ok(profiles.some((p) => p.data.highAvailability?.enabled !== true), "der skal findes en non-HA-profil");
});

test("single-server kan ikke få HA-badge (umulig kombination)", () => {
  const data = baseClass({ deploymentProfileCompatibility: { profiles: ["single-server"], haEligible: true, failureDomains: 3, nPlusOne: true, recoveryLocation: "eu-central-2" }, replication: { ...baseClass().replication, replicas: 3 } });
  const problems = problemsOf(data);
  assert.ok(problems.some((p) => /single-server.*HA-badge/.test(p)), problems.join("\n"));
});

test("HA med mindre end tre replikaer afvises", () => {
  const data = baseClass({ deploymentProfileCompatibility: { profiles: ["multiple-servers"], haEligible: true, failureDomains: 3, nPlusOne: true, recoveryLocation: "eu-central-2" }, availability: { targetPercent: 99.9, measurementWindowDays: 30, acceptedDowntime: false } });
  assert.ok(problemsOf(data).some((p) => /replicas/.test(p)));
});

test("HA med mindre end tre failure domains afvises", () => {
  const data = baseClass({ deploymentProfileCompatibility: { profiles: ["multiple-servers"], haEligible: true, failureDomains: 2, nPlusOne: true, recoveryLocation: "eu-central-2" }, replication: { ...baseClass().replication, replicas: 3 }, availability: { targetPercent: 99.9, measurementWindowDays: 30, acceptedDowntime: false } });
  assert.ok(problemsOf(data).some((p) => /failureDomains/.test(p)));
});

test("multiple-servers uden haEligible afvises", () => {
  const data = baseClass({ deploymentProfileCompatibility: { profiles: ["multiple-servers"], haEligible: false, failureDomains: 1, nPlusOne: false } });
  assert.ok(problemsOf(data).some((p) => /multiple-servers.*haEligible/.test(p)));
});

test("regionsnedbrud kan ikke have strammere RPO end bekræftede writes", () => {
  const data = baseClass({ durability: { ...baseClass().durability, regionFailure: { rpoMinutes: 0, strategy: "x", basis: "Et regionsnedbrud må ikke tabe mere end nul." } } });
  assert.ok(problemsOf(data).some((p) => /regionFailure/.test(p)));
});

test("de tre holdbarhedsmål må ikke være identiske", () => {
  const data = baseClass({ durability: { confirmedWrites: { rpoMinutes: 15, strategy: "commit-write", basis: "Bekræftet write tabes højst 15 minutter." }, regionFailure: { rpoMinutes: 15, strategy: "cross-region", basis: "Region taber højst 15 minutter." }, corruption: { rpoMinutes: 15, strategy: "snapshot-verify", basis: "Korruption taber højst 15 minutter." } } });
  assert.ok(problemsOf(data).some((p) => /identiske/.test(p)));
});

test("en enkelt rpo-vaerdi i stedet for tre adskilte afvises", () => {
  const data = baseClass();
  delete data.durability.confirmedWrites;
  const problems = problemsOf(data);
  assert.ok(problems.some((p) => /confirmedWrites/.test(p)), problems.join("\n"));
});

test("flere aktive skrivere kræver eksplicit upstream-understøttelse", () => {
  const data = baseClass({ replication: { ...baseClass().replication, replicas: 2, writeMode: "multi-writer", activeWriters: 2, upstreamSupportsMultiWriter: false } });
  assert.ok(problemsOf(data).some((p) => /upstreamSupportsMultiWriter/.test(p)));
});

test("single-server kræver accepteret nedetid", () => {
  const data = baseClass({ availability: { targetPercent: 99.0, measurementWindowDays: 30, acceptedDowntime: false } });
  assert.ok(problemsOf(data).some((p) => /acceptedDowntime/.test(p)));
});

test("accepteret forpligtelse uden målt evidens afvises", () => {
  const data = baseClass({ serviceCommitment: { state: "accepted", acceptedBy: { subject: "oidc|anna.andersen", name: "Anna Andersen", role: "Platform Owner" }, acceptedAt: "2026-09-23T08:00:00Z" } });
  assert.ok(problemsOf(data).some((p) => /measured\/evidenceRef/.test(p)));
});

test("proposed klasse må ikke fremstilles som vedtaget", () => {
  const data = baseClass({ serviceCommitment: { state: "proposed", acceptedBy: { subject: "oidc|anna.andersen", name: "Anna Andersen", role: "Platform Owner" } } });
  assert.ok(problemsOf(data).some((p) => /proposed/.test(p)));
});

test("en gyldig klasse uden problemer", () => {
  assert.deepEqual(problemsOf(baseClass()), []);
});
