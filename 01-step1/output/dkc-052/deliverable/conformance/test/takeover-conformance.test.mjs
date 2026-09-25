/**
 * DKC-052 — konformanstest for beredskabsøvelser og overtagelseskontrol.
 *
 * Tester skema + semantik på den faktiske plan og eksemplerne, at et brud
 * afvises, og at den kørte øvelse er deterministisk, at menneskelige trin
 * forbliver AFVENTER, og at agenten ikke kan godkende beredskab. En målt øvelse
 * på levende hosts/kanaler er og forbliver NOT RUN.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../src/schemas.mjs";
import { validateRecoveryDrill, validateTakeoverPlan } from "../src/takeover.mjs";
import { recoveryDrillProblems, takeoverPlanProblems } from "../../continuity/src/takeover.mjs";
import { buildTakeoverSuite } from "../../continuity/src/takeover-run.mjs";
import { renderRecoveryDrillReport, renderTakeoverPlan } from "../../continuity/src/takeover-report.mjs";

const plan = JSON.parse(readFileSync(join(repoRoot, "continuity/takeover-plan.json"), "utf8"));
const planExample = JSON.parse(readFileSync(join(repoRoot, "contracts/examples/takeover-plan.example.json"), "utf8"));
const drillExample = JSON.parse(readFileSync(join(repoRoot, "contracts/examples/recovery-drill.example.json"), "utf8"));

test("den faktiske overtagelsesplan validerer mod skema og semantik", () => {
  const result = validateTakeoverPlan(plan);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("plan- og øvelseseksemplerne validerer", () => {
  assert.equal(validateTakeoverPlan(planExample).ok, true, JSON.stringify(validateTakeoverPlan(planExample).errors));
  assert.equal(validateRecoveryDrill(drillExample).ok, true, JSON.stringify(validateRecoveryDrill(drillExample).errors));
});

test("en plan uden en navngiven rolle afvises", () => {
  const broken = structuredClone(plan);
  broken.roles.dataProtection = { subject: "team|sikkerhed", name: "Sikkerhed", role: "Team" };
  assert.ok(takeoverPlanProblems(broken).length > 0);
});

test("en øvelse uden begge scenariekinds afvises", () => {
  const broken = structuredClone(plan);
  broken.drills.scenarios = broken.drills.scenarios.filter((s) => s.kind !== "ha");
  assert.ok(takeoverPlanProblems(broken).length > 0);
});

test("den kørte øvelse er deterministisk og afventer menneske", async () => {
  const suite = await buildTakeoverSuite(repoRoot);
  assert.equal(suite.measured, false);
  assert.equal(suite.agentCanApprove, false);
  assert.equal(suite.gate.status, "awaiting-human");
  assert.equal(suite.summary.awaitingHuman, suite.drills.length);
  assert.ok(suite.summary.humanPending > 0);
  assert.ok(suite.summary.escalationsToHumans > 0);
  for (const drill of suite.drills) {
    assert.equal(drill.mutationCount ?? 0, 0);
    assert.equal(validateRecoveryDrill(drill).ok, true, JSON.stringify(validateRecoveryDrill(drill).errors));
  }
  assert.ok(renderTakeoverPlan(plan).includes("Overtagelses- og beredskabsplan"));
  assert.ok(renderRecoveryDrillReport(suite).includes("AFVENTER MENNESKE"));
});

test("et automatisk bestået menneskeligt trin afvises", async () => {
  const suite = await buildTakeoverSuite(repoRoot);
  const base = suite.drills[0];
  const auto = {
    ...base,
    status: "validated",
    gate: { status: "pass", reasons: [] },
    measurements: { ...base.measurements, dataIntegrityOk: true },
    steps: base.steps.map((s) => (s.kind === "human" && s.status === "pending" ? { ...s, status: "pass", owner: null, at: "2026-09-29T08:00:00Z" } : s)),
  };
  assert.ok(recoveryDrillProblems(auto).length > 0);
});
