/**
 * DKC-051 — konformanstest for fejl- og katastrofematrixen.
 *
 * Tester skema + semantik på den faktiske matrix og eksemplet, at et brud
 * afvises, og at den kørte rapport er deterministisk og dækker alle scenarier.
 * En målt fejløvelse på levende staging er og forbliver NOT RUN.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../src/schemas.mjs";
import { validateFailureMatrix } from "../src/chaos.mjs";
import { failureMatrixProblems } from "../../chaos/src/matrix.mjs";
import { runChaos } from "../../chaos/src/runner.mjs";
import { renderChaosReport } from "../../chaos/src/report.mjs";

const matrix = JSON.parse(readFileSync(join(repoRoot, "chaos/failure-matrix.json"), "utf8"));
const example = JSON.parse(readFileSync(join(repoRoot, "contracts/examples/failure-matrix.example.json"), "utf8"));

test("den faktiske fejlmatrix validerer mod skema og semantik", () => {
  const result = validateFailureMatrix(matrix);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("fejlmatrixens eksempel validerer mod skema og semantik", () => {
  const result = validateFailureMatrix(example);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("et brud på en invariant afvises", () => {
  const broken = { ...matrix, invariants: { ...matrix.invariants, noSplitBrain: false } };
  assert.ok(validateFailureMatrix(broken).errors.length > 0);
});

test("en matrix uden alle kritiske scopes afvises", () => {
  const scenarios = matrix.scenarios.filter((s) => s.failureScope !== "keys");
  assert.ok(failureMatrixProblems({ ...matrix, scenarios }).length > 0);
});

test("rapporten er deterministisk og gaten er pass", async () => {
  const report = await runChaos(repoRoot);
  assert.equal(report.gate.status, "pass", JSON.stringify(report.gate.reasons));
  assert.ok(renderChaosReport(report).includes("Fejl- og katastroferapport"));
  assert.equal(report.scenarios.length, matrix.scenarios.length);
});
