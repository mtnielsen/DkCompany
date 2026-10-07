/**
 * DKC-033 — konformanstest for pilotforløb og readiness.
 *
 * Tester skema + semantik på de tre virksomhedsprofiler, de 18 scenarier,
 * readiness-politikken, observations- og kundcaccept-registrene og den
 * genererede rapport, og at et brud afvises. En 30-dages observation og en
 * navngivet kundcaccept er og forbliver NOT RUN.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../src/schemas.mjs";
import { loadAll, JOURNEYS, SEGMENTS, REQUIRED_GATES } from "../../pilot/src/model.mjs";
import { buildPilotReport } from "../../pilot/src/check.mjs";
import {
  validatePilotProfiles,
  validatePilotScenarios,
  validateReadinessPolicy,
  validatePilotReadiness,
  observationProblems,
  customerAcceptanceProblems,
} from "../src/pilot.mjs";
import { loadProfiles as loadCatalogProfiles } from "../../distribution/src/catalog.mjs";
import { CHECKS } from "../../tools/baseline/registry.mjs";
import { loadTestMatrix } from "../../release/src/load.mjs";

function read(rel) {
  return JSON.parse(readFileSync(join(repoRoot, rel), "utf8"));
}

const all = loadAll(repoRoot);
const profiles = all.profiles.profiles ?? [];
const deploymentProfiles = loadCatalogProfiles(join(repoRoot, "catalog", "profiles")).map((p) => p.data?.metadata?.name).filter(Boolean);
const requirementIds = (loadTestMatrix().requirements ?? []).map((r) => r.id);
const report = read("pilot/report/pilot-readiness-report.json");

test("de tre virksomhedsprofiler validerer og dækker alle segmenter", () => {
  const res = validatePilotProfiles(all.profiles, undefined, { deploymentProfiles });
  assert.equal(res.ok, true, JSON.stringify(res.errors));
  assert.deepEqual([...new Set(profiles.map((p) => p.segment))].sort(), [...SEGMENTS].sort());
  for (const profile of profiles) {
    for (const journey of JOURNEYS) assert.ok(profile.criticalWorkflows.includes(journey), `${profile.id} mangler ${journey}`);
  }
});

test("scenariesættet har seks arbejdsgange pr. profil", () => {
  const res = validatePilotScenarios(all.scenarios, undefined, { profiles });
  assert.equal(res.ok, true, JSON.stringify(res.errors));
  assert.equal(all.scenarios.scenarios.length, profiles.length * JOURNEYS.length);
  for (const profile of profiles) {
    const journeys = new Set(all.scenarios.scenarios.filter((s) => s.profileRef === profile.id).map((s) => s.journey));
    for (const journey of JOURNEYS) assert.ok(journeys.has(journey), `${profile.id} mangler ${journey}`);
  }
});

test("readiness-politikken har de krævede gates og gyldige referencer", () => {
  const res = validateReadinessPolicy(all.policy, undefined, { registry: CHECKS, requirementIds });
  assert.equal(res.ok, true, JSON.stringify(res.errors));
  for (const gate of REQUIRED_GATES) assert.ok(all.policy.gates.some((g) => g.id === gate), gate);
});

test("observations- og kundcaccept-registrene validerer (tomme = afventer)", () => {
  assert.deepEqual(observationProblems(all.observation, { requiredDays: 30 }), []);
  assert.deepEqual(customerAcceptanceProblems(all.customerAcceptance, { acceptedByRoles: all.policy.customerAcceptance.acceptedByRoles, maxAgeDays: all.policy.customerAcceptance.maxAgeDays }), []);
  assert.equal(all.observation.status, "outstanding");
  assert.equal(all.customerAcceptance.acceptances.length, 0);
});

test("kontrakteksemplerne validerer (kun skema)", () => {
  const examples = [
    ["pilot-business-profile.example.json", (d, a) => validatePilotProfiles(d, a, { semantic: false })],
    ["pilot-scenario.example.json", (d, a) => validatePilotScenarios(d, a, { semantic: false })],
    ["readiness-policy.example.json", (d, a) => validateReadinessPolicy(d, a, { semantic: false })],
    ["pilot-readiness.example.json", (d, a) => validatePilotReadiness(d, a, { semantic: false })],
  ];
  for (const [name, validator] of examples) {
    const res = validator(read(`contracts/examples/${name}`), undefined);
    assert.equal(res.ok, true, `${name}: ${JSON.stringify(res.errors)}`);
  }
});

test("den genererede rapport validerer og er ærligt 'not-ready'", () => {
  const res = validatePilotReadiness(report, undefined);
  assert.equal(res.ok, true, JSON.stringify(res.errors));
  assert.equal(report.readiness, "not-ready");
  assert.equal(report.measured, false);
  assert.equal(report.observation.status, "outstanding");
  assert.equal(report.customerAcceptance.accepted, false);
  assert.deepEqual(report.abuse.violations, []);
});

test("rapporten er i trit med den kørende kode", async () => {
  const { report: fresh, problems } = await buildPilotReport(repoRoot);
  assert.deepEqual(problems, []);
  assert.deepEqual(fresh, report);
});

test("et brud på kundeisolationen afvises af semantikken", () => {
  const tampered = structuredClone(all.scenarios);
  tampered.scenarios[0] = { ...tampered.scenarios[0], deploymentProfileRef: "ha-cluster" };
  const res = validatePilotScenarios(tampered, undefined, { profiles });
  assert.equal(res.ok, false);
});

test("en politik uden den krævede menneskegate afvises", () => {
  const tampered = structuredClone(all.policy);
  tampered.gates = tampered.gates.filter((g) => g.id !== "human-assessment");
  const res = validateReadinessPolicy(tampered, undefined, { registry: CHECKS, requirementIds });
  assert.equal(res.ok, false);
});

test("en 'ready'-rapport med åbne omgåelser afvises", () => {
  const tampered = structuredClone(report);
  tampered.readiness = "ready";
  tampered.abuse.violations = ["cross-tenant-access"];
  const res = validatePilotReadiness(tampered, undefined);
  assert.equal(res.ok, false);
});
