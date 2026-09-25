/**
 * DKC-033 — test af readiness-aggregatoren.
 *
 * Beviser at gaten fejler lukket: en manglende eller udestående evidens giver
 * ikke 'passed', en 0-dages observation giver ikke 'ready', og en rapport kan
 * ikke erklæres klar uden en registreret kundcaccept.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { repoRoot } from "../../conformance/src/schemas.mjs";
import {
  loadAll,
  gateApplies,
  worstGateStatus,
  observationProblems,
  customerAcceptanceProblems,
  readinessReportProblems,
  REPORT_GENERATED_AT,
} from "../src/model.mjs";
import { evaluateGates, decideReadiness } from "../src/readiness.mjs";

const all = loadAll(repoRoot);
const NOW = Date.parse(REPORT_GENERATED_AT);

function baseEvidence(overrides = {}) {
  return {
    securityAssessment: { gate: { decision: "eligible", outstanding: false, blockers: [], coverage: { total: 9, passed: 9 } } },
    independentAssessments: { assessments: [{ performedAt: "2026-02-01T00:00:00Z", expiresAt: "2026-05-01T00:00:00Z" }] },
    testMatrix: { requirements: [{ id: "REQ-X" }] },
    recoverySuite: { measured: true },
    costReport: { tenants: [{ tenantId: "acme", total: 1 }] },
    observation: { status: "complete", observedDays: 30, requiredDays: 30, startedAt: "2026-01-01T00:00:00Z", endedAt: "2026-01-31T00:00:00Z" },
    customerAcceptance: { acceptances: [{ id: "a-1", acceptedBy: { subject: "oidc|x", name: "X", role: "Platform Owner" }, acceptedAt: "2026-02-01T00:00:00Z" }] },
    ...overrides,
  };
}

const passingOutcomes = all.scenarios.scenarios.map((s) => ({ scenarioId: s.id, journey: s.journey, runner: s.runner, status: "passed", steps: [], problems: [], metrics: {} }));

test("HA-gaten er kun aktiv for den erklærede HA-profil", () => {
  const ha = all.policy.gates.find((g) => g.id === "ha");
  const smv = all.profiles.profiles.find((p) => p.id === "smv");
  const service = all.profiles.profiles.find((p) => p.id === "it-service");
  assert.equal(gateApplies(ha, smv), false);
  assert.equal(gateApplies(ha, service), true);
});

test("worstGateStatus ignorerer not-applicable", () => {
  assert.equal(worstGateStatus(["passed", "not-applicable"]), "passed");
  assert.equal(worstGateStatus(["passed", "pending"]), "pending");
  assert.equal(worstGateStatus(["pending", "failed"]), "failed");
});

test("alle gater består med fuld, frisk evidens", () => {
  const gates = evaluateGates({ policy: all.policy, profiles: all.profiles, evidence: baseEvidence(), scenarioOutcomes: passingOutcomes });
  assert.equal(decideReadiness(gates), "ready");
  for (const gate of gates) {
    if (!gate.applicable) continue;
    assert.equal(gate.status, "passed", `${gate.id}: ${gate.reasons.join("; ")}`);
  }
});

test("manglende uafhængig vurdering blokerer sikkerheds- og menneskegaten", () => {
  const evidence = baseEvidence({ securityAssessment: { gate: { decision: "blocked", outstanding: true, blockers: [{ id: "no-independent-assessment" }], coverage: { total: 9, passed: 0 } } }, independentAssessments: { assessments: [] } });
  const gates = evaluateGates({ policy: all.policy, profiles: all.profiles, evidence, scenarioOutcomes: passingOutcomes });
  const security = gates.find((g) => g.id === "security");
  const human = gates.find((g) => g.id === "human-assessment");
  assert.equal(security.status, "pending");
  assert.equal(human.status, "pending");
  assert.equal(decideReadiness(gates), "not-ready");
});

test("en fejlende arbejdsgang blokerer kvalitetsgaten", () => {
  const outcomes = passingOutcomes.map((o) => (o.journey === "restore" ? { ...o, status: "failed" } : o));
  const gates = evaluateGates({ policy: all.policy, profiles: all.profiles, evidence: baseEvidence(), scenarioOutcomes: outcomes });
  assert.equal(gates.find((g) => g.id === "quality").status, "failed");
  assert.equal(decideReadiness(gates), "not-ready");
});

test("en manglende evidenskilde giver not-run, ikke passed", () => {
  const gates = evaluateGates({ policy: all.policy, profiles: all.profiles, evidence: baseEvidence({ costReport: null }), scenarioOutcomes: passingOutcomes });
  const cost = gates.find((g) => g.id === "cost");
  assert.equal(cost.status, "not-run");
});

test("observationen skal dække 30 dage for at være afsluttet", () => {
  assert.deepEqual(observationProblems({ status: "complete", observedDays: 10, requiredDays: 30, startedAt: "2026-01-01T00:00:00Z", endedAt: "2026-01-11T00:00:00Z", evidenceRef: "x" }, { requiredDays: 30, now: NOW }), [
    { path: "/status", message: "en afsluttet observation skal dække alle krævede dage" },
  ]);
  assert.equal(observationProblems(all.observation, { requiredDays: 30, now: NOW }).length, 0);
});

test("kundcaccept kræver et navngivet menneske i en accepteret rolle", () => {
  const bad = { acceptances: [{ id: "a-1", acceptedBy: { subject: "oidc|x", name: "X", role: "Ukendt" }, acceptedAt: "2026-02-01T00:00:00Z" }] };
  const problems = customerAcceptanceProblems(bad, { acceptedByRoles: ["Platform Owner"], maxAgeDays: 30, now: NOW });
  assert.ok(problems.some((p) => /må ikke acceptere/.test(p.message)));
});

test("en 'ready'-rapport med udestående gate afvises", () => {
  const report = {
    readiness: "ready",
    gates: [{ applicable: true, mandatory: true, status: "pending" }],
    profiles: [],
    abuse: { violations: [] },
    observation: { status: "outstanding" },
    customerAcceptance: { accepted: false },
  };
  const problems = readinessReportProblems(report);
  assert.ok(problems.some((p) => /readiness/.test(p.path)));
});
