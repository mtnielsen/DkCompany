import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCorrelation, correlationProblems, extendCorrelation, newCorrelationId } from "../src/correlation.mjs";

test("bygger en correlation med obligatoriske ID'er og null-normalisering", () => {
  const correlation = buildCorrelation({ correlationId: "c1", executionId: "e1" });
  assert.equal(correlation.correlationId, "c1");
  assert.equal(correlation.executionId, "e1");
  assert.equal(correlation.incidentId, null);
  assert.deepEqual(correlationProblems(correlation), []);
  assert.equal(Object.isFrozen(correlation), true);
});

test("afviser manglende eller ugyldig traceId", () => {
  assert.throws(() => buildCorrelation({ executionId: "e1" }), /correlationId/);
  const bad = { correlationId: "c1", executionId: "e1", traceId: "not-hex" };
  const problems = correlationProblems(bad);
  assert.equal(problems.length, 1);
  assert.match(problems[0].path, /traceId/);
});

test("udvider en correlation til et barn og bevarer correlationId", () => {
  const parent = buildCorrelation({ correlationId: "c1", executionId: "e1", incidentId: "res://acme/incident/INC-1" });
  const child = extendCorrelation(parent, { executionId: "e2", parentId: "rec-1" });
  assert.equal(child.correlationId, "c1");
  assert.equal(child.executionId, "e2");
  assert.equal(child.parentId, "rec-1");
  assert.equal(child.incidentId, "res://acme/incident/INC-1");
});

test("genererer unikke ID'er", () => {
  assert.notEqual(newCorrelationId(), newCorrelationId());
});
