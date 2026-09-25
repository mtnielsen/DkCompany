/**
 * DKC-062 — konformanstest for installations- og releaseacceptance.
 *
 * Tester skema + semantik på det faktiske scenariesæt, gate-politik, RACI og
 * ejeraccept-register, på eksemplerne og på den genererede rapport, og at et
 * brud afvises. En rigtig VPS/lokal/HA-installation og den menneskelige accept
 * er og forbliver NOT RUN.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../src/schemas.mjs";
import {
  validateAcceptanceScenarioSet,
  validateAcceptanceGatePolicy,
  validateAcceptanceResult,
  validateRaciRegistry,
  ownerAcceptanceProblems,
} from "../src/acceptance.mjs";
import { loadProfiles, loadPlatforms } from "../../distribution/src/catalog.mjs";
import { loadAll, raciServicesFor, controlProcessesFor, acceptanceResultProblems, REPORT_GENERATED_AT } from "../../distribution/src/acceptance-model.mjs";
import { runAcceptanceCheck } from "../../distribution/src/acceptance-check.mjs";
import { probeRoleSeparation } from "../../distribution/src/acceptance-run.mjs";
import { CHECKS, COMPONENTS } from "../../tools/baseline/registry.mjs";

function read(rel) {
  return JSON.parse(readFileSync(join(repoRoot, rel), "utf8"));
}

const all = loadAll(repoRoot);
const profiles = loadProfiles(join(repoRoot, "catalog", "profiles")).map((p) => p.data);
const platforms = loadPlatforms(join(repoRoot, "catalog", "platforms.json")).platforms;
const report = read("acceptance/report/acceptance-report.json");

test("scenariesættet validerer og dækker alle rejser", () => {
  const res = validateAcceptanceScenarioSet(all.scenarios, undefined, { profiles, platforms });
  assert.equal(res.ok, true, JSON.stringify(res.errors));
  const journeys = new Set(all.scenarios.scenarios.map((s) => s.journey));
  for (const journey of ["install", "configure", "add-remove", "upgrade", "provider-switch", "escalation", "recovery", "exit"]) {
    assert.ok(journeys.has(journey), journey);
  }
});

test("gate-politikken validerer med fælles og særskilte gates", () => {
  const res = validateAcceptanceGatePolicy(all.policy, undefined, { registry: CHECKS, components: COMPONENTS });
  assert.equal(res.ok, true, JSON.stringify(res.errors));
  assert.equal(all.policy.gates.filter((g) => g.kind === "common").length, 4);
  assert.equal(all.policy.gates.filter((g) => g.kind === "profile").length, 4);
  assert.equal(all.policy.ownerAcceptance.requireForEveryActiveGate, true);
});

test("RACI-registeret er komplet pr. service, dataklasse og kontrolproces", () => {
  const res = validateRaciRegistry(all.raci, undefined, { services: raciServicesFor(repoRoot), controlProcesses: controlProcessesFor(all.policy) });
  assert.equal(res.ok, true, JSON.stringify(res.errors));
});

test("ejeraccept-registeret er en særskilt, gyldig registrering (tom = afventer)", () => {
  const problems = ownerAcceptanceProblems(all.ownerAcceptance, { gates: all.policy.gates, acceptedByRoles: all.policy.ownerAcceptance.acceptedByRoles, maxAgeDays: all.policy.ownerAcceptance.maxAgeDays, now: Date.parse(REPORT_GENERATED_AT) });
  assert.deepEqual(problems, []);
  assert.equal(all.ownerAcceptance.accepted.length, 0);
});

test("eksemplerne validerer mod skemaet", () => {
  assert.equal(validateAcceptanceScenarioSet(read("contracts/examples/acceptance-scenario.example.json"), undefined, { semantic: false }).ok, true);
  assert.equal(validateAcceptanceGatePolicy(read("contracts/examples/acceptance-gate-policy.example.json"), undefined, { semantic: false }).ok, true);
  assert.equal(validateAcceptanceResult(read("contracts/examples/acceptance-result.example.json"), undefined, { semantic: false }).ok, true);
  assert.equal(validateRaciRegistry(read("contracts/examples/raci-registry.example.json"), undefined, { semantic: false }).ok, true);
});

test("den genererede rapport er deterministisk og alle scenarier består", () => {
  assert.equal(report.measured, false);
  assert.equal(report.generatedAt, "2026-03-01T00:00:00Z");
  assert.ok(report.outcomes.every((o) => o.status === "passed"));
  assert.deepEqual(report.roleViolations, []);
  for (const target of report.targets) assert.deepEqual(acceptanceResultProblems(target), []);
});

test("hver aktiv gate i rapporten afventer ejeraccept og er aldrig 'passed'", () => {
  for (const target of report.targets) {
    for (const gate of target.gates.filter((g) => g.applicable)) {
      assert.equal(gate.ownerAcceptanceStatus, "pending");
      assert.equal(gate.status, "unapproved");
    }
    assert.equal(target.decision, "pending-owner-acceptance");
  }
});

test("den fulde acceptkontrol består deterministisk og er i trit", async () => {
  const result = await runAcceptanceCheck(repoRoot);
  assert.equal(result.ok, true, result.problems.join("; "));
});

test("et scenarie med HA på single-server afvises", () => {
  const broken = JSON.parse(JSON.stringify(all.scenarios));
  const scenario = broken.scenarios.find((s) => s.platformRef === "linux-arm64-node22");
  scenario.ha = true;
  const res = validateAcceptanceScenarioSet(broken, undefined, { profiles, platforms });
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => /HA/.test(e.message)));
});

test("en gate-politik uden de fire profilgates afvises", () => {
  const broken = JSON.parse(JSON.stringify(all.policy));
  broken.gates = broken.gates.filter((g) => g.kind === "common");
  const res = validateAcceptanceGatePolicy(broken, undefined, { registry: CHECKS, components: COMPONENTS });
  assert.equal(res.ok, false);
});

test("en gate der peger på en ukendt check afvises", () => {
  const broken = JSON.parse(JSON.stringify(all.policy));
  broken.gates[0].checks.push("does-not-exist");
  const res = validateAcceptanceGatePolicy(broken, undefined, { registry: CHECKS, components: COMPONENTS });
  assert.equal(res.ok, false);
});

test("en RACI-post uden forskellig stedfortræder afvises", () => {
  const broken = JSON.parse(JSON.stringify(all.raci));
  broken.entries[0].substitute = { ...broken.entries[0].responsible };
  const res = validateRaciRegistry(broken, undefined, { services: raciServicesFor(repoRoot), controlProcesses: controlProcessesFor(all.policy) });
  assert.equal(res.ok, false);
});

test("et acceptresultat der erklærer 'accepted' uden ejeraccept afvises", () => {
  const broken = JSON.parse(JSON.stringify(report.targets[0]));
  broken.decision = "accepted";
  const problems = acceptanceResultProblems(broken);
  assert.ok(problems.some((p) => /accepted/.test(p.message)));
});

test("rolle-adskillelsen holder i konformanstesten", () => {
  assert.deepEqual(probeRoleSeparation(), []);
});
