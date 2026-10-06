#!/usr/bin/env node
/**
 * DKC-050 — CLI for kapacitets- og skaleringsplanen.
 *
 *   node performance/src/cli.mjs render    # skriv autoscaler-/kvote-/PDB-manifester og rapport
 *   node performance/src/cli.mjs check     # plan, semantik, manifester, HA- og beskedkrydsvalidering
 *   node performance/src/cli.mjs report    # skriv kapacitetsrapporten til stdout
 *   node performance/src/cli.mjs drill     # kør den deterministiske kapacitetsøvelse
 *
 * En `drill` er en deterministisk simulering (`measured: false`); en målt
 * lasttest på levende hosts er NOT RUN.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { repoRoot } from "../../conformance/src/schemas.mjs";
import { loadCapacityPlan, CAPACITY_MANIFESTS_DIR } from "./model.mjs";
import { buildCapacityReport, projectCapacity } from "./projection.mjs";
import { renderCapacityPlan } from "./render.mjs";
import { runPerformanceCheck } from "./check.mjs";
import { allocateFairShares, simulateDurableQueue, admitRequest } from "./quota.mjs";
import { planAutoscale } from "./autoscale.mjs";
import { poolPlanSaturation } from "./pool.mjs";

function writeFile(root, rel, contents) {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

export function renderCapacity(root = repoRoot) {
  const plan = loadCapacityPlan(root);
  const report = buildCapacityReport(plan);
  const rendered = renderCapacityPlan(plan, report);
  for (const [rel, value] of rendered) {
    writeFile(root, rel, typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n");
  }
  return rendered;
}

function drill() {
  const plan = loadCapacityPlan(repoRoot);
  const baseline = plan.loadProfiles.find((p) => p.id === plan.baselineProfileId);
  const checks = {};

  // 1) Projektionen er en model med alle nøgletal.
  const at1 = projectCapacity(plan, baseline, { scaleFactor: 1 });
  const at5 = projectCapacity(plan, baseline, { scaleFactor: 5 });
  checks.projectionIsMeasuredFalse = at5.measured === false;
  checks.projectionHasMetrics =
    ["throughputPerSecond", "p95Ms", "p99Ms", "errorRatePercent", "queueAgeSeconds", "replicationLagMs"].every((k) => k in at1) &&
    typeof at1.price.totalMonthly === "number";

  // 2) N+1 efter hosttab.
  const lost = projectCapacity(plan, baseline, { scaleFactor: 1, downHosts: 1 });
  checks.nPlusOneWithinCapacity = lost.errorRatePercent === 0;

  // 3) Stateful uden multi-active skalerer ikke ved flere replikaer.
  const db = plan.workloads.find((w) => w.id === "database");
  checks.statefulWithoutMultiActiveDoesNotScale = db.statefulScaling.multiActive === false && db.replicas.max === db.replicas.min;

  // 4) En støjende tenant begrænses.
  const fair = allocateFairShares(plan, {
    capacityPerSecond: 1000,
    tenants: [
      { tenantId: "acme", demandPerSecond: 100000 },
      { tenantId: "globex", demandPerSecond: 50 },
    ],
  });
  checks.noisyTenantCapped = fair.noTenantAboveMaxShare && fair.noisyTenantSharePercent <= plan.tenantQuotas.maxSharePercent + 1e-9;

  // 5) Autoskalering af stateless og køworkers, aldrig stateful.
  const auto = planAutoscale(plan, { profile: baseline });
  const statelessCount = plan.workloads.filter((w) => w.kind === "stateless").length;
  const statefulCount = plan.workloads.filter((w) => w.kind === "stateful").length;
  checks.statelessAutoscales = auto.filter((a) => a.autoScale).length === statelessCount;
  checks.statefulRequiresRunbook = auto.filter((a) => a.requiresRunbook).length === statefulCount;

  // 6) Overskredet kapacitet afvises kontrolleret, intet kvitteret arbejde mistes.
  const jobs = Array.from({ length: 120 }, (_, i) => ({ id: `job-${i}`, tenantId: i % 2 ? "acme" : "globex" }));
  const sim = simulateDurableQueue(plan, { jobs, capacityPerSecond: 1000, queueDepth: 999 });
  checks.rejectedNotAcknowledged = sim.acknowledged === sim.durableWrites && sim.lostAcknowledged === 0;
  checks.controlledRejection =
    sim.rejected > 0 ? admitRequest(plan, { tenantId: "acme", currentTotalRps: 2000, capacityPerSecond: 1000 }).status === 503 : true;

  // 7) Connection pools reserverer admin-forbindelser.
  const pools = poolPlanSaturation(plan, { replicas: { "api-db": 3 }, offeredConnections: { "api-db": 1000 } });
  checks.poolReservesAdmin = pools.every((p) => p.adminConnectionsReserved > 0);
  checks.poolRejectsOverflow = pools.some((p) => p.rejectedConnections > 0 || p.saturated);

  for (const [name, ok] of Object.entries(checks)) console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  const ok = Object.values(checks).every(Boolean);
  console.log(`målt=false, faktorer=${plan.capacityReport.scalingFactors.join("/")}, baseline=${baseline.id}, N+1 fejlrate efter hosttab=${lost.errorRatePercent}%`);
  if (!ok) process.exit(1);
}

function main() {
  const command = process.argv[2];
  if (command === "render") {
    const rendered = renderCapacity(repoRoot);
    console.log(`✔ Skrev ${rendered.size} kapacitetsartefakter (inkl. ${CAPACITY_MANIFESTS_DIR})`);
    return;
  }
  if (command === "check") {
    const result = runPerformanceCheck(repoRoot);
    if (!result.ok) {
      console.error("✘ Kapacitetskontrol fejlede:\n");
      for (const p of result.problems) console.error(`  - ${p}`);
      process.exit(1);
    }
    console.log("✔ Kapacitetsplan, semantik og manifester er konsistente");
    return;
  }
  if (command === "report") {
    const plan = loadCapacityPlan(repoRoot);
    process.stdout.write(JSON.stringify(buildCapacityReport(plan), null, 2) + "\n");
    return;
  }
  if (command === "drill") {
    drill();
    return;
  }
  console.error("Brug: node performance/src/cli.mjs <render|check|report|drill>");
  process.exit(2);
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));
if (invokedDirectly) main();
