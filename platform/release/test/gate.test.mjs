/**
 * DKC-063 — release-gate: kritiske positive/negative fixtures.
 *
 * Beviser at failed, skipped, not-run, unsupported, stale, wrong-artifact og
 * missing ikke kan bestå en obligatorisk gate, at et grønt resumé ikke
 * overskriver en fejlende check, og at en implementør ikke kan opfylde et
 * uafhængigt vurderingskrav.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { evaluateGate, digestOf } from "../src/gate.mjs";
import { loadAll } from "../src/load.mjs";

const cases = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "gate-cases.json"), "utf8")).cases;

for (const c of cases) {
  test(`gate — ${c.id}: ${c.description}`, () => {
    const result = evaluateGate({
      baseline: c.baseline,
      matrix: c.matrix,
      registry: [],
      exceptions: c.exceptions,
      assessments: c.assessments,
      threats: { threats: [] },
      now: c.now,
      targetCommit: c.targetCommit,
      producer: c.producer,
    });
    const requirement = result.requirements.find((r) => r.requirementId === c.expect.requirementId);
    assert.ok(requirement, `kravet ${c.expect.requirementId} findes ikke i resultatet`);
    assert.equal(requirement.status, c.expect.status, JSON.stringify(requirement.reasons));
    assert.equal(result.decision, c.expect.decision, JSON.stringify(result.reasons));
  });
}

test("kun 'passed' tæller som bestået", () => {
  const { matrix } = loadAll();
  const baseline = {
    schemaVersion: 1,
    kind: "BaselineResult",
    generatedAt: new Date().toISOString(),
    status: "pass",
    summary: { total: 0, pass: 0, fail: 0, error: 0, notRun: 0 },
    environment: { node: "v22.22.1", platform: "linux", arch: "x64", git: { commit: "83ad91a963d8055f77c29fb4361455689df95acb" } },
    checks: [],
  };
  const result = evaluateGate({ baseline, matrix, registry: [], exceptions: { exceptions: [] }, assessments: { assessments: [] }, threats: { threats: [] }, now: Date.now() });
  // Uden nogen checks er intet krav bestået; de fleste er 'missing', nogle 'pending-independent-assessment'.
  assert.equal(result.statuses.passed, 0);
  assert.notEqual(result.decision, "eligible");
  for (const r of result.requirements) {
    assert.notEqual(r.status, "passed", `${r.requirementId} må ikke være passed uden evidens`);
  }
});

test("et implementørt kørselsresultat kan ikke opfylde et uafhængigt vurderingskrav", () => {
  const { matrix, assessments } = loadAll();
  const result = evaluateGate({
    baseline: realPassBaseline(),
    matrix,
    registry: [],
    exceptions: { exceptions: [] },
    assessments,
    threats: { threats: [] },
    now: Date.now(),
    producer: { type: "implementer", name: "local", subject: "process|baseline" },
  });
  const independent = result.requirements.filter((r) => r.independentAssessment === null && ["REQ-CONTINUITY-001", "REQ-SECURITY-001", "REQ-PERFORMANCE-001"].includes(r.requirementId));
  for (const r of independent) {
    assert.equal(r.status, "pending-independent-assessment", `${r.requirementId}: ${JSON.stringify(r.reasons)}`);
  }
});

test("digestOf ændrer sig med indholdet", () => {
  assert.notEqual(digestOf({ a: 1 }), digestOf({ a: 2 }));
  assert.match(digestOf("x"), /^sha256:[a-f0-9]{64}$/);
});

/** Baseline hvor hver check i matrixen er 'pass' (til producent-adskillelse). */
function realPassBaseline() {
  const { matrix } = loadAll();
  const ids = new Set();
  for (const r of matrix.requirements) for (const c of r.checks) ids.add(c.id);
  const commit = "83ad91a963d8055f77c29fb4361455689df95acb";
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    kind: "BaselineResult",
    generatedAt: now,
    status: "pass",
    summary: { total: ids.size, pass: ids.size, fail: 0, error: 0, notRun: 0 },
    environment: { node: "v22.22.1", platform: "linux", arch: "x64", git: { commit } },
    checks: [...ids].map((id) => ({ id, status: "pass", command: ["true"], log: `logs/${id}.log`, startedAt: now, finishedAt: now })),
  };
}
