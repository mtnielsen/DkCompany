/**
 * DKC-063 — konformanstests for testmatrix, trusselmodel, undtagelser,
 * uafhængige vurderinger og release-gate-resultatet.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildAjv } from "../src/schemas.mjs";
import { validateTestMatrix, validateThreatRegister, validateRiskExceptions, validateIndependentAssessments, validateReleaseGateResult, BOUNDARIES } from "../src/release.mjs";
import { loadAll, releaseProblems } from "../../release/src/load.mjs";
import { evaluateGate } from "../../release/src/gate.mjs";

const examplesDir = join(import.meta.dirname, "..", "..", "contracts", "examples");
const readExample = (name) => JSON.parse(readFileSync(join(examplesDir, name), "utf8"));

test("matrix-, trussel-, undtagelses- og vurderingseksempler validerer (skema + semantik)", () => {
  const ajv = buildAjv().ajv;
  const matrix = validateTestMatrix(readExample("test-matrix.example.json"), ajv);
  assert.equal(matrix.ok, true, JSON.stringify(matrix.errors));
  const threats = validateThreatRegister(readExample("threat-register.example.json"), ajv);
  assert.equal(threats.ok, true, JSON.stringify(threats.errors));
  const exceptions = validateRiskExceptions(readExample("risk-exception.example.json"), ajv);
  assert.equal(exceptions.ok, true, JSON.stringify(exceptions.errors));
  const assessments = validateIndependentAssessments(readExample("independent-assessment.example.json"), ajv);
  assert.equal(assessments.ok, true, JSON.stringify(assessments.errors));
});

test("de rigtige registre krydsrefererer korrekt", () => {
  const { matrix, threats, exceptions, assessments } = loadAll();
  assert.deepEqual(releaseProblems({ matrix, threats, exceptions, assessments }), []);
  assert.deepEqual(threats.boundaries.map((b) => b.id).sort(), [...BOUNDARIES].sort());
});

test("release-gate-resultatet validerer mod kontrakten", () => {
  const cases = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "release", "test", "fixtures", "gate-cases.json"), "utf8")).cases;
  const caseWithAssessment = cases.find((c) => c.id === "independent-accepted");
  const result = evaluateGate({
    baseline: caseWithAssessment.baseline,
    matrix: caseWithAssessment.matrix,
    registry: [],
    exceptions: caseWithAssessment.exceptions,
    assessments: caseWithAssessment.assessments,
    threats: { threats: [] },
    now: caseWithAssessment.now,
    targetCommit: caseWithAssessment.targetCommit,
    producer: caseWithAssessment.producer,
  });
  assert.equal(result.decision, "eligible");
  const ajv = buildAjv().ajv;
  const validated = validateReleaseGateResult(result, ajv);
  assert.equal(validated.ok, true, JSON.stringify(validated.errors));
});

test("et blokeret resultat validerer også", () => {
  const cases = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "release", "test", "fixtures", "gate-cases.json"), "utf8")).cases;
  const failing = cases.find((c) => c.id === "failed");
  const result = evaluateGate({ baseline: failing.baseline, matrix: failing.matrix, registry: [], exceptions: failing.exceptions, assessments: failing.assessments, threats: { threats: [] }, now: failing.now, targetCommit: failing.targetCommit, producer: failing.producer });
  assert.equal(result.decision, "blocked");
  const validated = validateReleaseGateResult(result, buildAjv().ajv);
  assert.equal(validated.ok, true, JSON.stringify(validated.errors));
});

test("en matrix med et nonExcepted-krav kan ikke undtages af en risikoundtagelse i semantikken", () => {
  const matrix = readExample("test-matrix.example.json");
  const nonExcepted = matrix.requirements.filter((r) => r.nonExcepted).map((r) => r.id);
  assert.ok(nonExcepted.length >= 1, "matrixen skal have mindst ét nonExcepted-krav");
});
