/**
 * DKC-050 — test af tenantkvoter, fairness og kontrolleret afvisning.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { repoRoot } from "../../conformance/src/schemas.mjs";
import { loadCapacityPlan } from "../src/model.mjs";
import { allocateFairShares, admitRequest, simulateDurableQueue } from "../src/quota.mjs";

const plan = loadCapacityPlan(repoRoot);

test("en støjende tenant kan ikke forbruge alle ressourcer", () => {
  const result = allocateFairShares(plan, {
    capacityPerSecond: 1000,
    tenants: [
      { tenantId: "noisy", demandPerSecond: 1_000_000 },
      { tenantId: "quiet", demandPerSecond: 10 },
    ],
  });
  const noisy = result.allocations.find((a) => a.tenantId === "noisy");
  const quiet = result.allocations.find((a) => a.tenantId === "quiet");
  assert.ok(noisy.allocatedPerSecond <= result.maxSharePerSecond + 1e-9);
  assert.ok(quiet.allocatedPerSecond >= 10 - 1e-9);
  assert.equal(result.noTenantAboveMaxShare, true);
  assert.equal(result.withinCapacity, true);
});

test("en vægtet tenant får en større andel end lettere tenanter", () => {
  const result = allocateFairShares(plan, {
    capacityPerSecond: 100,
    tenants: [
      { tenantId: "heavy", weight: 4, demandPerSecond: 100 },
      { tenantId: "light", weight: 1, demandPerSecond: 100 },
      { tenantId: "filler", weight: 1, demandPerSecond: 100 },
    ],
  });
  const heavy = result.allocations.find((a) => a.tenantId === "heavy");
  const light = result.allocations.find((a) => a.tenantId === "light");
  const filler = result.allocations.find((a) => a.tenantId === "filler");
  assert.ok(heavy.allocatedPerSecond > light.allocatedPerSecond);
  assert.ok(heavy.allocatedPerSecond > filler.allocatedPerSecond);
  assert.ok(heavy.allocatedPerSecond <= result.maxSharePerSecond + 1e-9);
});

test("kvoteoverskridelse afvises med 429", () => {
  const quota = plan.tenantQuotas.default.maxRequestsPerSecond;
  const decision = admitRequest(plan, { tenantId: "acme", currentTenantRps: quota, capacityPerSecond: 1_000_000 });
  assert.equal(decision.admitted, false);
  assert.equal(decision.status, 429);
  assert.equal(decision.durable, false);
});

test("samlet kapacitetsoverskridelse afvises med 503", () => {
  const decision = admitRequest(plan, { tenantId: "acme", currentTotalRps: 1000, capacityPerSecond: 1000 });
  assert.equal(decision.admitted, false);
  assert.equal(decision.status, 503);
});

test("et accepteret job kvitteres kun efter holdbar skrivning; intet kvitteret arbejde mistes", () => {
  const jobs = Array.from({ length: 200 }, (_, i) => ({ id: `job-${i}`, tenantId: "acme" }));
  const sim = simulateDurableQueue(plan, { jobs, capacityPerSecond: 50, queueDepth: 0 });
  assert.ok(sim.rejected > 0);
  assert.equal(sim.acknowledged, sim.durableWrites);
  assert.equal(sim.lostAcknowledged, 0);
  assert.equal(sim.acceptedJobs.every((j) => j.durable), true);
});

test("en fuld kø afviser nye job i stedet for at tabe kvitterede data", () => {
  const jobs = Array.from({ length: 10 }, (_, i) => ({ id: `late-${i}`, tenantId: "acme" }));
  const sim = simulateDurableQueue(plan, { jobs, capacityPerSecond: 1_000_000, queueDepth: plan.backpressure.queueDepthCritical });
  assert.equal(sim.accepted, 0);
  assert.equal(sim.rejected, jobs.length);
  assert.equal(sim.lostAcknowledged, 0);
});
