/**
 * DKC-062 — test af den profilbevidste acceptgate.
 *
 * Gaten skal afvise manglende, forældet, forkert-artefakt og ikke-godkendt
 * evidens, aktivere de rigtige gates pr. mål og kun give 'accepted' når både
 * testbevis og registreret menneskelig ejeraccept er til stede.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../../conformance/src/schemas.mjs";
import { loadProfiles, loadPlatforms } from "../src/catalog.mjs";
import { loadAll, REPORT_GENERATED_AT, acceptanceDigest } from "../src/acceptance-model.mjs";
import { aggregateAcceptance, deriveTargets, deterministicCheckEvidence } from "../src/acceptance-gate.mjs";
import { probeRoleSeparation } from "../src/acceptance-run.mjs";
import { CHECKS, COMPONENTS } from "../../tools/baseline/registry.mjs";
import { loadTestMatrix } from "../../release/src/load.mjs";

const here = repoRoot;
const all = loadAll(here);
const profiles = loadProfiles(join(here, "catalog", "profiles")).map((p) => p.data);
const platforms = loadPlatforms(join(here, "catalog", "platforms.json")).platforms;
void platforms;
const matrix = loadTestMatrix();
const target = deriveTargets({ scenarioSet: all.scenarios, profiles }).find((t) => t.profileRef === "small-vps");
const targetCommit = "83ad91a963d8055f77c29fb4361455689df95acb";
const artifactDigest = acceptanceDigest({ scenarios: all.scenarios, policy: all.policy, raci: all.raci });

function aggregate(overrides = {}) {
  return aggregateAcceptance({
    target,
    policy: all.policy,
    registry: CHECKS,
    components: COMPONENTS,
    matrix,
    scenarioSet: all.scenarios,
    scenarioOutcomes: (all.scenarios.scenarios ?? [])
      .filter((s) => s.profileRef === target.profileRef)
      .map((s) => ({ id: s.id, status: "passed", problems: [] })),
    checkEvidence: deterministicCheckEvidence({ registry: CHECKS, targetCommit, artifactDigest, generatedAt: REPORT_GENERATED_AT }),
    ownerAcceptance: { accepted: [] },
    now: REPORT_GENERATED_AT,
    targetCommit,
    artifactDigest,
    ...overrides,
  });
}

function ownerEntries(gateIds) {
  return gateIds.map((gateId) => ({
    id: `oa-${gateId}`,
    gateId,
    acceptedBy: { subject: "oidc|anna.andersen", name: "Anna Andersen", role: "Platform Owner" },
    acceptedAt: REPORT_GENERATED_AT,
    targetCommit,
    artifactDigest,
    profileRef: "small-vps",
    evidenceRef: `acceptance/report/acceptance-report.json#${gateId}`,
  }));
}

test("single-server aktiverer de fælles gates men ikke HA/host/immutable/self-healing", () => {
  const result = aggregate();
  const byId = new Map(result.gates.map((g) => [g.id, g]));
  for (const id of ["security", "privacy", "restore", "role"]) assert.equal(byId.get(id).applicable, true, id);
  for (const id of ["ha", "host-management", "immutable", "self-healing"]) assert.equal(byId.get(id).applicable, false, id);
  assert.equal(byId.get("ha").status, "not-applicable");
});

test("HA-målet aktiverer HA-gaten og dens forudsætningskapabiliteter", () => {
  const haTarget = deriveTargets({ scenarioSet: all.scenarios, profiles }).find((t) => t.profileRef === "ha-cluster");
  const result = aggregateAcceptance({
    target: haTarget,
    policy: all.policy,
    registry: CHECKS,
    components: COMPONENTS,
    matrix,
    scenarioSet: all.scenarios,
    scenarioOutcomes: all.scenarios.scenarios.filter((s) => s.profileRef === "ha-cluster").map((s) => ({ id: s.id, status: "passed" })),
    checkEvidence: deterministicCheckEvidence({ registry: CHECKS, targetCommit, artifactDigest, generatedAt: REPORT_GENERATED_AT }),
    ownerAcceptance: { accepted: [] },
    now: REPORT_GENERATED_AT,
    targetCommit,
    artifactDigest,
  });
  const ha = result.gates.find((g) => g.id === "ha");
  assert.equal(ha.applicable, true);
  assert.equal(ha.evidenceStatus, "passed");
  assert.equal(ha.ownerAcceptanceStatus, "pending");
});

test("en aktiv gate uden ejeraccept kan aldrig bestå", () => {
  const result = aggregate();
  assert.equal(result.decision, "pending-owner-acceptance");
  assert.ok(result.gates.filter((g) => g.applicable).every((g) => g.status === "unapproved"));
  assert.ok(result.ownerAcceptance.pendingGates.includes("security"));
});

test("en aktiv gate med gyldig ejeraccept kan bestå", () => {
  const pending = ["security", "privacy", "restore", "role"];
  const result = aggregate({ ownerAcceptance: { accepted: ownerEntries(pending) } });
  assert.equal(result.decision, "accepted");
  assert.ok(result.gates.filter((g) => g.applicable).every((g) => g.status === "passed"));
});

test("en forældet ejeraccept afvises", () => {
  const stale = ownerEntries(["security", "privacy", "restore", "role"]).map((e) => ({ ...e, acceptedAt: "2025-01-01T00:00:00Z" }));
  const result = aggregate({ ownerAcceptance: { accepted: stale } });
  assert.notEqual(result.decision, "accepted");
  assert.ok(result.gates.find((g) => g.id === "security").status === "unapproved");
});

test("en ejeraccept bundet til et andet commit afvises", () => {
  const wrong = ownerEntries(["security", "privacy", "restore", "role"]).map((e) => ({ ...e, targetCommit: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef" }));
  const result = aggregate({ ownerAcceptance: { accepted: wrong } });
  assert.notEqual(result.decision, "accepted");
});

test("manglende testbevis giver 'missing' og blokerer", () => {
  const result = aggregate({ checkEvidence: {} });
  assert.equal(result.decision, "blocked");
  assert.ok(result.gates.some((g) => g.evidenceStatus === "missing"));
});

test("forældet testbevis giver 'stale'", () => {
  const evidence = deterministicCheckEvidence({ registry: CHECKS, targetCommit, artifactDigest, generatedAt: "2020-01-01T00:00:00Z" });
  const result = aggregate({ checkEvidence: evidence });
  assert.equal(result.decision, "blocked");
  assert.ok(result.gates.some((g) => g.evidenceStatus === "stale"));
});

test("testbevis bundet til et andet commit giver 'wrong-artifact'", () => {
  const evidence = deterministicCheckEvidence({ registry: CHECKS, targetCommit: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef", artifactDigest, generatedAt: REPORT_GENERATED_AT });
  const result = aggregate({ checkEvidence: evidence });
  assert.equal(result.decision, "blocked");
  assert.ok(result.gates.some((g) => g.evidenceStatus === "wrong-artifact"));
});

test("en manglende forudsætningskapabilitet blokerer gaten", () => {
  const result = aggregate({ components: COMPONENTS.filter((c) => c.id !== "immutable-enforcement") });
  const immutableTarget = deriveTargets({ scenarioSet: all.scenarios, profiles }).find((t) => t.profileRef === "enterprise-dedicated");
  const enterprise = aggregateAcceptance({
    target: immutableTarget,
    policy: all.policy,
    registry: CHECKS,
    components: COMPONENTS.filter((c) => c.id !== "immutable-enforcement"),
    matrix,
    scenarioSet: all.scenarios,
    scenarioOutcomes: all.scenarios.scenarios.filter((s) => s.profileRef === "enterprise-dedicated").map((s) => ({ id: s.id, status: "passed" })),
    checkEvidence: deterministicCheckEvidence({ registry: CHECKS, targetCommit, artifactDigest, generatedAt: REPORT_GENERATED_AT }),
    ownerAcceptance: { accepted: ownerEntries(["immutable"]) },
    now: REPORT_GENERATED_AT,
    targetCommit,
    artifactDigest,
  });
  const immutable = enterprise.gates.find((g) => g.id === "immutable");
  assert.equal(immutable.evidenceStatus, "missing");
  assert.notEqual(enterprise.decision, "accepted");
  void result;
});

test("HA-kravet kan ikke omgås ved at vælge single-server, men auditbeskyttelsen består", () => {
  const result = aggregate();
  const security = result.gates.find((g) => g.id === "security");
  assert.ok(security.requirementRefs.includes("REQ-AUDIT-001"));
  assert.equal(result.gates.find((g) => g.id === "immutable").applicable, false);
  assert.equal(result.decision, "pending-owner-acceptance");
});

test("rollerapporten afviser ingen brud når rolleadskillelsen holder", () => {
  const violations = probeRoleSeparation();
  assert.deepEqual(violations, []);
});

test("et rollebrud sætter rollestatus til ikke-adskilt", () => {
  const result = aggregate({ roleViolations: ["role-rotation"] });
  assert.equal(result.roles.separated, false);
  assert.ok(result.roles.violations.includes("role-rotation"));
});
