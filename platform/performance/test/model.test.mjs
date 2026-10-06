/**
 * DKC-050 — test af den semantiske model og enhedsprisen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { repoRoot } from "../../conformance/src/schemas.mjs";
import { loadCapacityPlan, capacityPlanProblems } from "../src/model.mjs";
import { unitPrice } from "../src/cost.mjs";
import { validateCapacityPlan } from "../../conformance/src/performance.mjs";

const plan = loadCapacityPlan(repoRoot);

test("den faktiske plan har ingen semantiske problemer", () => {
  assert.deepEqual(capacityPlanProblems(plan), []);
});

test("skema + semantik accepterer den faktiske plan", () => {
  const result = validateCapacityPlan(plan);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("semantikken afviser en plan uden N+1", () => {
  const broken = { ...plan, topology: { ...plan.topology, nPlusOne: false } };
  assert.ok(capacityPlanProblems(broken).length > 0);
});

test("semantikken afviser ukontrolleret kapacitetsafvisning", () => {
  const broken = { ...plan, tenantQuotas: { ...plan.tenantQuotas, onExceed: "drop" } };
  assert.ok(capacityPlanProblems(broken).length > 0);
});

test("semantikken afviser en stateless workload uden autoscale", () => {
  const workloads = plan.workloads.map((w) => (w.id === "api" ? { ...w, autoscale: undefined } : w));
  assert.ok(capacityPlanProblems({ ...plan, workloads }).length > 0);
});

test("semantikken afviser en stateful app med flere aktive skrivere uden multi-active", () => {
  const workloads = plan.workloads.map((w) =>
    w.id === "database" ? { ...w, statefulScaling: { ...w.statefulScaling, activeWriters: 3 } } : w,
  );
  assert.ok(capacityPlanProblems({ ...plan, workloads }).length > 0);
});

test("semantikken afviser en manglende tenantkvote og en åben backpressure", () => {
  assert.ok(capacityPlanProblems({ ...plan, backpressure: { ...plan.backpressure, onOverflow: "wait" } }).length > 0);
  assert.ok(capacityPlanProblems({ ...plan, backpressure: { ...plan.backpressure, durableBeforeAck: false } }).length > 0);
});

test("enhedsprisen kan regnes og er positiv", () => {
  const price = unitPrice(plan, { requestsPerSecond: 250, jobsPerSecond: 20, aiCallsPerDay: 25000, dataGb: 500, vcpu: 10 });
  assert.equal(price.currency, "DKK");
  assert.ok(price.perRequest > 0 && price.perJob > 0 && price.perAiCall > 0);
  assert.ok(price.monthly.vcpu > 0 && price.monthly.requests > 0 && price.monthly.jobs > 0);
});
