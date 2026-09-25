/**
 * DKC-050 — test af kapacitetsprojektionen.
 *
 * Projektionen skal vise ikke-lineær skalering, holde N+1 efter hosttab og
 * aldrig lade en stateful app uden multi-active-support vinde kapacitet ved
 * blot at øge replikatællingen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../../conformance/src/schemas.mjs";
import { loadCapacityPlan } from "../src/model.mjs";
import { buildCapacityReport, effectiveCapacity, projectCapacity, queueFactor, replicasFor } from "../src/projection.mjs";

const plan = loadCapacityPlan(repoRoot);
const baseline = plan.loadProfiles.find((p) => p.id === plan.baselineProfileId);

test("1x-projektionen rapporterer throughput, p95/p99, fejlrate, køalder, replikeringslag og pris", () => {
  const run = projectCapacity(plan, baseline, { scaleFactor: 1 });
  assert.equal(run.measured, false);
  assert.ok(run.throughputPerSecond > 0);
  assert.ok(run.p95Ms > 0 && run.p99Ms >= run.p95Ms);
  assert.ok(run.errorRatePercent >= 0);
  assert.ok(run.queueAgeSeconds >= 0);
  assert.ok(run.replicationLagMs >= 0);
  assert.equal(run.price.currency, plan.cost.currency);
  assert.ok(run.price.totalMonthly > 0);
});

test("latens vokser ikke-lineært med utilisationen", () => {
  assert.ok(queueFactor(0.9) > queueFactor(0.5));
  assert.ok(queueFactor(0.98) > queueFactor(0.9));
});

test("stateless replikaer skalerer, men begrænses af max-rammen", () => {
  const api = plan.workloads.find((w) => w.id === "api");
  assert.equal(replicasFor(api, 1).replicas, api.replicas.min);
  assert.ok(replicasFor(api, 1000).replicas > api.replicas.min);
  const huge = replicasFor(api, 1e9);
  assert.equal(huge.replicas, api.replicas.max);
  assert.equal(huge.capped, true);
});

test("N+1 er målt efter tab af én host", () => {
  const report = buildCapacityReport(plan);
  assert.equal(report.nPlusOne.downHosts, 1);
  assert.equal(report.nPlusOne.remainingHosts, plan.topology.hostCount - 1);
  assert.equal(report.nPlusOne.measured, false);
  assert.equal(report.nPlusOne.sufficient, true);
});

test("stateful app uden multi-active-support vinder intet ved flere replikaer", () => {
  const db = plan.workloads.find((w) => w.id === "database");
  assert.equal(db.statefulScaling.multiActive, false);
  const one = effectiveCapacity(db, 1, { hostCount: plan.topology.hostCount });
  const three = effectiveCapacity(db, 3, { hostCount: plan.topology.hostCount });
  assert.equal(one.capacity, three.capacity);
  assert.equal(three.writers, 1);
});

test("multi-active stateful app skalerer med replikaer", () => {
  const broker = plan.workloads.find((w) => w.id === "broker");
  assert.equal(broker.statefulScaling.multiActive, true);
  const one = effectiveCapacity(broker, 1, { hostCount: plan.topology.hostCount });
  const three = effectiveCapacity(broker, 3, { hostCount: plan.topology.hostCount });
  assert.ok(three.capacity > one.capacity);
});

test("skaleringsrapporten indeholder alle faktorer for alle profiler", () => {
  const report = buildCapacityReport(plan);
  assert.equal(report.profiles.length, plan.loadProfiles.length);
  for (const profile of report.profiles) {
    assert.deepEqual(
      profile.runs.map((r) => r.scaleFactor),
      plan.capacityReport.scalingFactors,
    );
  }
});

test("planen er deterministisk: samme input giver samme rapport", () => {
  const a = JSON.stringify(buildCapacityReport(plan));
  const b = JSON.stringify(buildCapacityReport(loadCapacityPlan(repoRoot)));
  assert.equal(a, b);
});

test("planfilen er gyldig JSON og bærer measured=false", () => {
  const raw = JSON.parse(readFileSync(join(repoRoot, "performance/capacity-plan.json"), "utf8"));
  assert.equal(raw.capacityReport.measurement.measured, false);
  assert.equal(raw.capacityReport.measurement.requiresLiveLoadTest, true);
});
