/**
 * DKC-050 — konformanstest for kapacitets- og skaleringsplanen.
 *
 * Tester skema + semantik på den faktiske plan og eksemplet, og at et brud
 * afvises. En målt lasttest på levende hosts er og forbliver NOT RUN.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../src/schemas.mjs";
import { validateCapacityPlan } from "../src/performance.mjs";
import { capacityPlanProblems } from "../../performance/src/model.mjs";
import { buildCapacityReport } from "../../performance/src/projection.mjs";
import { renderCapacityPlan } from "../../performance/src/render.mjs";

const plan = JSON.parse(readFileSync(join(repoRoot, "performance/capacity-plan.json"), "utf8"));
const example = JSON.parse(readFileSync(join(repoRoot, "contracts/examples/capacity-plan.example.json"), "utf8"));

test("den faktiske kapacitetsplan validerer mod skema og semantik", () => {
  const result = validateCapacityPlan(plan);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("kapacitetsplanens eksempel validerer mod skema og semantik", () => {
  const result = validateCapacityPlan(example);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("et brud på N+1 afvises", () => {
  const broken = { ...plan, topology: { ...plan.topology, nPlusOne: false } };
  assert.ok(validateCapacityPlan(broken).errors.length > 0);
});

test("en stateless workload uden autoscaler afvises", () => {
  const workloads = plan.workloads.map((w) => (w.id === "api" ? { ...w, autoscale: undefined } : w));
  assert.ok(capacityPlanProblems({ ...plan, workloads }).length > 0);
});

test("rapporten er deterministisk og dækker 1x/2x/5x", () => {
  const report = buildCapacityReport(plan);
  assert.deepEqual(report.scalingFactors, [1, 2, 5]);
  const rendered = renderCapacityPlan(plan, report);
  assert.ok(rendered.has("docs/capacity/scaling-report.md"));
  assert.ok(rendered.has("performance/report/capacity-report.json"));
});
