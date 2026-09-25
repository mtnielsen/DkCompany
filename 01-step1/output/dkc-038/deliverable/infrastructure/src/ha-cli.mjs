#!/usr/bin/env node
/**
 * DKC-038 — CLI for HA-klyngen.
 *
 *   node infrastructure/src/ha-cli.mjs render   # skriv HA-manifester fra planen
 *   node infrastructure/src/ha-cli.mjs check    # plan, semantik, rendering, netværk og serviceklasser
 *   node infrastructure/src/ha-cli.mjs drill    # kør frivillig drain og hårdt nedbrud hver for sig
 *
 * En `drill` er en deterministisk simulering (`measured: false`); en målt
 * failover kræver en levende klynge og er NOT RUN.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadHAPlan, haClusterProblems, runFailoverDrill, haServiceClassProblems } from "./ha.mjs";
import { renderHAPlan, HA_MANIFESTS_DIR } from "./ha-render.mjs";
import { checkNetworkIsolation } from "./netpol.mjs";
import { validateHACluster } from "../../conformance/src/ha.mjs";
import { loadServiceClasses } from "../../continuity/src/classes.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(here, "..", "..");

function writeJson(root, rel, value) {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

export function renderHA(root = repoRoot) {
  const manifests = renderHAPlan(loadHAPlan(root));
  for (const [rel, value] of manifests) writeJson(root, rel, value);
  return manifests;
}

function committed(root, dir) {
  const full = join(root, dir);
  return existsSync(full) ? readdirSync(full).filter((f) => f.endsWith(".json")).map((f) => `${dir}/${f}`) : [];
}

export function runHACheck(root = repoRoot) {
  const problems = [];
  const plan = loadHAPlan(root);
  const validation = validateHACluster(plan);
  for (const e of validation.errors) problems.push(`plan${e.path}: ${e.message}`);

  const manifests = renderHAPlan(plan);
  for (const [rel, value] of manifests) {
    const path = join(root, rel);
    if (!existsSync(path)) problems.push(`${rel} mangler; kør 'make ha-render'`);
    else if (readFileSync(path, "utf8") !== JSON.stringify(value, null, 2) + "\n") problems.push(`${rel} er ude af trit; kør 'make ha-render'`);
  }
  for (const rel of committed(root, HA_MANIFESTS_DIR)) {
    if (!manifests.has(rel)) problems.push(`${rel} er ikke genereret fra planen`);
  }

  for (const p of checkNetworkIsolation([...manifests.values()])) problems.push(`netværk: ${p}`);
  for (const p of haServiceClassProblems(plan, loadServiceClasses())) problems.push(`serviceklasse: ${p}`);
  return { ok: problems.length === 0, problems, plan };
}

function drill(memberId = "cp-1") {
  const plan = loadHAPlan(repoRoot);
  const serviceClasses = loadServiceClasses();
  const results = ["voluntary-drain", "hard-crash"].map((mode) => runFailoverDrill(plan, { mode, memberId, serviceClasses }));
  let failed = false;
  for (const result of results) {
    const status = result.withinTarget && result.quorum.writeAllowed ? "PASS" : "FAIL";
    if (status === "FAIL") failed = true;
    console.log(`${status} ${result.mode} ${memberId}: quorum=${result.quorum.hasQuorum ? "ja" : "nej"}, writes=${result.quorum.writeAllowed ? "tilladt" : "afvist"}, in-flight tab=${result.inFlightLoss ? "ja" : "nej"}, estimeret=${result.estimatedFailoverSeconds}s, målt=${result.measured}`);
  }
  if (failed) process.exit(1);
}

function main() {
  const command = process.argv[2];
  if (command === "render") {
    const manifests = renderHA(repoRoot);
    console.log(`✔ Skrev ${manifests.size} HA-manifester til ${HA_MANIFESTS_DIR}`);
    return;
  }
  if (command === "check") {
    const result = runHACheck(repoRoot);
    if (!result.ok) {
      console.error("✘ HA-kontrol fejlede:\n");
      for (const p of result.problems) console.error(`  - ${p}`);
      process.exit(1);
    }
    console.log("✔ HA-plan, semantik, manifester, netværksisolation og serviceklasser er konsistente");
    return;
  }
  if (command === "drill") {
    drill(process.argv[3] ?? "cp-1");
    return;
  }
  console.error("Brug: node infrastructure/src/ha-cli.mjs <render|check|drill>");
  process.exit(2);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) main();
