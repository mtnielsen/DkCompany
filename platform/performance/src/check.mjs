#!/usr/bin/env node
/**
 * DKC-050 — fokuseret kontrol af kapacitets- og skaleringsplanen.
 *
 *   node performance/src/check.mjs
 *
 * Kontrollerer offline at:
 *   - planen validerer mod skemaet og de semantiske beslutninger,
 *   - de genererede autoscaler-/kvote-/PDB-manifester og rapporten er i trit
 *     med planen,
 *   - planens fejldomæner og hosts stemmer med HA-planen,
 *   - backpressure stemmer med beskedtopologien (DKC-040), og
 *   - planen faktisk afviser brud (en negativ mutation fanges).
 *
 * Der køres ingen levende lasttest; `make performance-live` er NOT RUN.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../../conformance/src/schemas.mjs";
import { validateCapacityPlan } from "../../conformance/src/performance.mjs";
import { loadCapacityPlan, capacityPlanProblems, CAPACITY_MANIFESTS_DIR, CAPACITY_REPORT_PATH, CAPACITY_DOC_PATH } from "./model.mjs";
import { buildCapacityReport } from "./projection.mjs";
import { renderCapacityPlan } from "./render.mjs";
import { loadHAPlan } from "../../infrastructure/src/ha.mjs";

export function runPerformanceCheck(root = repoRoot) {
  const problems = [];
  const plan = loadCapacityPlan(root);
  const validation = validateCapacityPlan(plan);
  for (const e of validation.errors) problems.push(`plan${e.path}: ${e.message}`);

  const report = buildCapacityReport(plan);
  const rendered = renderCapacityPlan(plan, report);
  for (const [rel, value] of rendered) {
    const path = join(root, rel);
    if (!existsSync(path)) {
      problems.push(`${rel} mangler; kør 'make performance-render'`);
      continue;
    }
    const expected = typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n";
    if (readFileSync(path, "utf8") !== expected) problems.push(`${rel} er ude af trit; kør 'make performance-render'`);
  }
  // Ingen forældede filer i manifestmappen.
  const manifestDir = join(root, CAPACITY_MANIFESTS_DIR);
  if (existsSync(manifestDir)) {
    for (const file of readdirSync(manifestDir).filter((f) => f.endsWith(".json"))) {
      if (!rendered.has(`${CAPACITY_MANIFESTS_DIR}/${file}`)) problems.push(`${CAPACITY_MANIFESTS_DIR}/${file} er ikke genereret fra planen`);
    }
  }

  // Krydsvalider mod HA-planen.
  try {
    const ha = loadHAPlan(root);
    const haDomains = new Set(ha.failureDomains ?? []);
    for (const domain of plan.failureDomains) {
      if (!haDomains.has(domain)) problems.push(`fejldomænet '${domain}' findes ikke i HA-planen`);
    }
    if (plan.topology.hostCount < (ha.capacity?.memberCount ?? 0)) {
      problems.push("kapacitetsplanen dækker færre hosts end HA-planens kapacitetsmedlemmer");
    }
  } catch (err) {
    problems.push(`infrastructure/ha-plan.json: ${err.message}`);
  }

  // Krydsvalider mod beskedtopologien (DKC-040).
  try {
    const messaging = JSON.parse(readFileSync(join(root, "jobs", "messaging.json"), "utf8"));
    const bp = messaging.backpressure ?? {};
    if (plan.backpressure.strategy !== bp.strategy) problems.push("backpressure-strategien matcher ikke beskedtopologien");
    if (plan.backpressure.maxOldestAgeSeconds > (bp.maxOldestAgeSeconds ?? Infinity)) {
      problems.push("kapacitetsplanens maksimale køalder overstiger beskedtopologiens grænse");
    }
    if (plan.backpressure.queueDepthCritical > (bp.maxBacklog ?? Infinity)) {
      problems.push("kapacitetsplanens kritiske kødybde overstiger beskedtopologiens backlog-grænse");
    }
  } catch (err) {
    problems.push(`jobs/messaging.json: ${err.message}`);
  }

  // Negativ kontrol: semantikken skal fange et brud.
  const negative = capacityPlanProblems({ ...plan, topology: { ...plan.topology, nPlusOne: false } });
  if (negative.length === 0) problems.push("semantikken afviser ikke en plan uden N+1");
  const negativeTwo = capacityPlanProblems({ ...plan, tenantQuotas: { ...plan.tenantQuotas, onExceed: "drop" } });
  if (negativeTwo.length === 0) problems.push("semantikken afviser ikke ukontrolleret kapacitetsafvisning");

  return { ok: problems.length === 0, problems, plan, report };
}

function main() {
  const result = runPerformanceCheck(repoRoot);
  if (!result.ok) {
    console.error("✘ Kapacitetskontrol fejlede:\n");
    for (const p of result.problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`✔ Kapacitetsplan, semantik og ${CAPACITY_MANIFESTS_DIR} er konsistente`);
  console.log(`✔ ${result.report.profiles.length} lastprofiler ved ${result.report.scalingFactors.length} faktorer; N+1 ${result.report.nPlusOne.sufficient ? "opfyldt" : "ikke opfyldt"} efter hosttab`);
  console.log(`✔ Rapport: ${CAPACITY_REPORT_PATH} og ${CAPACITY_DOC_PATH}`);
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));
if (invokedDirectly) main();
