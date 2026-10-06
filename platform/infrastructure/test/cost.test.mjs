import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPlan } from "../src/plan.mjs";
import { checkCost, computeCost, stagingCostDocument } from "../src/cost.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const plan = loadPlan(repoRoot);

test("omkostningsposterne summer til månedsbeløbet", () => {
  const cost = computeCost(plan);
  assert.equal(cost.consistent, true);
  assert.ok(cost.computed > 0);
  assert.deepEqual(checkCost(plan).problems, []);
});

test("et manglende beløb afvises", () => {
  const mutated = { ...plan, cost: { ...plan.cost, monthlyEstimate: 1 } };
  assert.ok(checkCost(mutated).problems.some((p) => /matcher ikke/.test(p)));
});

test("stagingdokumentet er deterministisk og navngiver kilden", () => {
  const doc = stagingCostDocument(plan);
  assert.equal(doc.generatedFrom, "infrastructure/plan.json");
  assert.equal(doc.kind, "StagingCost");
  assert.equal(doc.monthlyEstimate, doc.computedMonthly);
});
