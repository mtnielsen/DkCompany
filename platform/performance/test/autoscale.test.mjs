/**
 * DKC-050 — test af autoskalering og connection pools.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { repoRoot } from "../../conformance/src/schemas.mjs";
import { loadCapacityPlan } from "../src/model.mjs";
import { desiredReplicas, planAutoscale } from "../src/autoscale.mjs";
import { poolBudget, poolSaturation, poolPlanSaturation } from "../src/pool.mjs";

const plan = loadCapacityPlan(repoRoot);
const baseline = plan.loadProfiles.find((p) => p.id === plan.baselineProfileId);

test("en stateless tjeneste skalerer op ved høj efterspørgsel", () => {
  const api = plan.workloads.find((w) => w.id === "api");
  const decision = desiredReplicas(api, { mode: "cpu", demandPerSecond: 1000 });
  assert.ok(decision.desired > api.replicas.min);
  assert.ok(decision.desired <= api.replicas.max);
  assert.equal(decision.direction, "up");
});

test("autoskalering respekterer cooldown", () => {
  const api = plan.workloads.find((w) => w.id === "api");
  const decision = desiredReplicas(api, {
    mode: "cpu",
    demandPerSecond: 1000,
    currentReplicas: api.replicas.min,
    elapsedSeconds: 10,
    lastScaleAtSeconds: 5,
  });
  assert.equal(decision.desired, api.replicas.min);
  assert.equal(decision.direction, "held-by-cooldown");
});

test("en køworker skalerer efter kødybde", () => {
  const worker = plan.workloads.find((w) => w.id === "queue-worker");
  const decision = desiredReplicas(worker, { mode: "queue-depth", queueDepth: 1000 });
  assert.ok(decision.desired > worker.replicas.min);
});

test("stateful workloads autoskalerer ikke og kræver en runbook", () => {
  const decisions = planAutoscale(plan, { profile: baseline });
  const stateful = decisions.filter((d) => !d.autoScale);
  const expected = plan.workloads.filter((w) => w.kind === "stateful").length;
  assert.equal(stateful.length, expected);
  for (const d of stateful) {
    assert.equal(d.requiresRunbook, true);
    assert.ok(d.runbookRef);
  }
});

test("en pool reserverer admin-forbindelser", () => {
  const pool = plan.connectionPools[0];
  const budget = poolBudget(pool);
  assert.equal(budget.usablePerReplica, pool.maxConnectionsPerReplica - pool.reservedAdminConnections);
});

test("en overtegnet pool afviser kontrolleret", () => {
  const pool = plan.connectionPools[0];
  const saturation = poolSaturation(pool, { replicas: 3, offeredConnections: 10_000 });
  assert.equal(saturation.saturated, true);
  assert.ok(saturation.rejectedConnections > 0);
  assert.ok(saturation.acceptedConnections <= saturation.totalUsableConnections + pool.maxOverflow * 3);
});

test("poolplanen reserverer admin-forbindelser for hver pool", () => {
  const saturation = poolPlanSaturation(plan, { replicas: { "api-db": 3, "gateway-budget": 2 }, offeredConnections: { "api-db": 10, "gateway-budget": 4 } });
  assert.equal(saturation.length, plan.connectionPools.length);
  assert.ok(saturation.every((p) => p.adminConnectionsReserved > 0));
});
