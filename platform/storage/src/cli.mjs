#!/usr/bin/env node
/**
 * DKC-041 — CLI for fil- og objektlageret.
 *
 *   node storage/src/cli.mjs render   # skriv lager-manifester fra planen
 *   node storage/src/cli.mjs check    # plan, semantik, manifester, serviceklasser og HA-plan
 *   node storage/src/cli.mjs drill    # kør den deterministiske holdbarhedsøvelse
 *
 * En `drill` er en deterministisk simulering (`measured: false`); en målt
 * fejlmodel på et levende CSI-/objektlager er NOT RUN.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadStoragePlan, storagePlanProblems, storageServiceClassProblems, storageHAProblems } from "./plan.mjs";
import { renderStoragePlan, STORAGE_MANIFESTS_DIR } from "./render.mjs";
import { validateStoragePlan } from "../../conformance/src/storage.mjs";
import { loadServiceClasses } from "../../continuity/src/classes.mjs";
import { loadHAPlan } from "../../infrastructure/src/ha.mjs";
import { runStorageDrill } from "./drill.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(here, "..", "..");

function writeJson(root, rel, value) {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

export function renderStorage(root = repoRoot) {
  const manifests = renderStoragePlan(loadStoragePlan(root));
  for (const [rel, value] of manifests) writeJson(root, rel, value);
  return manifests;
}

function committed(root, dir) {
  const full = join(root, dir);
  return existsSync(full) ? readdirSync(full).filter((f) => f.endsWith(".json")).map((f) => `${dir}/${f}`) : [];
}

export function runStorageCheck(root = repoRoot) {
  const problems = [];
  const plan = loadStoragePlan(root);
  const validation = validateStoragePlan(plan);
  for (const e of validation.errors) problems.push(`plan${e.path}: ${e.message}`);

  const manifests = renderStoragePlan(plan);
  for (const [rel, value] of manifests) {
    const path = join(root, rel);
    if (!existsSync(path)) problems.push(`${rel} mangler; kør 'make storage-render'`);
    else if (readFileSync(path, "utf8") !== JSON.stringify(value, null, 2) + "\n") problems.push(`${rel} er ude af trit; kør 'make storage-render'`);
  }
  for (const rel of committed(root, STORAGE_MANIFESTS_DIR)) {
    if (!manifests.has(rel)) problems.push(`${rel} er ikke genereret fra planen`);
  }

  let haPlan = null;
  try {
    haPlan = loadHAPlan(root);
  } catch (err) {
    problems.push(`infrastructure/ha-plan.json: ${err.message}`);
  }
  for (const p of storageServiceClassProblems(plan, loadServiceClasses())) problems.push(`serviceklasse: ${p}`);
  for (const p of storageHAProblems(plan, haPlan)) problems.push(`ha-plan: ${p}`);

  // Semantikken skal kunne afvise brud (fanger en tom/fejlbehæftet validator).
  const negative = storagePlanProblems({ ...plan, topology: { ...plan.topology, unsafeWritesOnQuorumLoss: true } });
  if (negative.length === 0) problems.push("semantikken afviser ikke usikre writes ved quorumtab");

  return { ok: problems.length === 0, problems, plan };
}

function drill() {
  const plan = loadStoragePlan(repoRoot);
  const result = runStorageDrill(plan);
  for (const [name, ok] of Object.entries(result.checks)) {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  }
  console.log(`målt=${result.measured}, quorum=${result.quorum.writeQuorum}/${result.quorum.replicaFactor}, korruptioner=${result.corruptionsDetected}, repareret=${result.repaired}, rebalanceret=${result.rebalanced}`);
  if (!result.ok) process.exit(1);
}

async function scrub() {
  const plan = loadStoragePlan(repoRoot);
  const rootDir = process.argv[3];
  if (!rootDir) {
    console.error("Brug: node storage/src/cli.mjs scrub <rootDir>");
    process.exit(2);
  }
  const { createStorageCluster } = await import("./object-store.mjs");
  const { createTenantKeyRing, deriveTestKeyRing } = await import("./tenant-keys.mjs");
  const cluster = createStorageCluster({ plan, rootDir, keyRing: createTenantKeyRing(deriveTestKeyRing()) });
  const result = cluster.repairAll();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}

function main() {
  const command = process.argv[2];
  if (command === "render") {
    const manifests = renderStorage(repoRoot);
    console.log(`✔ Skrev ${manifests.size} lager-manifester til ${STORAGE_MANIFESTS_DIR}`);
    return;
  }
  if (command === "check") {
    const result = runStorageCheck(repoRoot);
    if (!result.ok) {
      console.error("✘ Lagerkontrol fejlede:\n");
      for (const p of result.problems) console.error(`  - ${p}`);
      process.exit(1);
    }
    console.log("✔ Lagerplan, semantik, manifester, serviceklasser og HA-plan er konsistente");
    return;
  }
  if (command === "drill") {
    drill();
    return;
  }
  if (command === "scrub") {
    // Bevidst asynkron kun når der scrubes mod en given rod.
    Promise.resolve(scrub()).catch((err) => {
      console.error(err);
      process.exit(1);
    });
    return;
  }
  console.error("Brug: node storage/src/cli.mjs <render|check|drill>");
  process.exit(2);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) main();
