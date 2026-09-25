#!/usr/bin/env node
/**
 * DKC-039 — CLI for database-HA.
 *
 *   node persistence/src/ha-cli.mjs render   # skriv db-ha-manifester fra planen
 *   node persistence/src/ha-cli.mjs check    # plan, semantik, manifester, profil og serviceklasser
 *   node persistence/src/ha-cli.mjs drill    # deterministisk failover med commitkvitteringer
 *
 * En `drill` er en deterministisk simulering (`measured: false`); en målt
 * failover på en rigtig motor er NOT RUN.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadDatabaseHAPlan,
  databaseHAServiceClassProblems,
  canServeRead,
} from "./ha.mjs";
import { runDatabaseFailoverDrill } from "./ha-drill.mjs";
import { renderDatabaseHAPlan, DB_HA_MANIFESTS_DIR } from "./ha-render.mjs";
import { validateDatabaseHA } from "../../conformance/src/database-ha.mjs";
import { loadServiceClasses } from "../../continuity/src/classes.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(here, "..", "..");

function writeJson(root, rel, value) {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

export function renderDatabaseHA(root = repoRoot) {
  const manifests = renderDatabaseHAPlan(loadDatabaseHAPlan(root));
  for (const [rel, value] of manifests) writeJson(root, rel, value);
  return manifests;
}

function committed(root, dir) {
  const full = join(root, dir);
  return existsSync(full) ? readdirSync(full).filter((f) => f.endsWith(".json")).map((f) => `${dir}/${f}`) : [];
}

export function runDatabaseHACheck(root = repoRoot) {
  const problems = [];
  const plan = loadDatabaseHAPlan(root);
  const validation = validateDatabaseHA(plan);
  for (const e of validation.errors) problems.push(`plan${e.path}: ${e.message}`);

  // Databaseprofilen skal faktisk findes.
  if (!existsSync(join(root, plan.databaseProfileRef))) {
    problems.push(`databaseProfileRef '${plan.databaseProfileRef}' findes ikke`);
  }

  // Eksemplet skal være identisk med den kanoniske plan.
  const examplePath = join(root, "contracts", "examples", "database-ha.example.json");
  if (!existsSync(examplePath)) {
    problems.push("database-ha.example.json mangler");
  } else {
    const example = JSON.parse(readFileSync(examplePath, "utf8"));
    if (JSON.stringify(example) !== JSON.stringify(plan)) problems.push("database-ha.example.json er ude af trit med persistence/ha-plan.json");
  }

  // Manifesterne skal være genereret fra planen.
  const manifests = renderDatabaseHAPlan(plan);
  for (const [rel, value] of manifests) {
    const path = join(root, rel);
    if (!existsSync(path)) problems.push(`${rel} mangler; kør 'make db-ha-render'`);
    else if (readFileSync(path, "utf8") !== JSON.stringify(value, null, 2) + "\n") problems.push(`${rel} er ude af trit; kør 'make db-ha-render'`);
  }
  for (const rel of committed(root, DB_HA_MANIFESTS_DIR)) {
    if (!manifests.has(rel)) problems.push(`${rel} er ikke genereret fra planen`);
  }

  // Godkendelser må ikke kunne læses fra en replica.
  const approvalsOnSync = canServeRead(plan, "approvals", "sync-replica");
  if (approvalsOnSync.ok) problems.push("godkendelser må ikke kunne læses fra en sync-replica");

  for (const p of databaseHAServiceClassProblems(plan, loadServiceClasses())) problems.push(`serviceklasse: ${p}`);
  return { ok: problems.length === 0, problems, plan };
}

function drill() {
  const plan = loadDatabaseHAPlan(repoRoot);
  const result = runDatabaseFailoverDrill(plan);
  for (const [name, ok] of Object.entries(result.checks)) {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  }
  console.log(
    `  receipts=${result.receiptsPresent}/${result.receiptsTotal}, promotion=${result.promotion.promoted ? "ja" : "nej"}, ` +
      `partition(≤1 skriver)=${result.partition.atMostOne ? "ja" : "nej"}, sync-tab-stopper-writes=${result.syncReplicaLoss.committed ? "nej" : "ja"}, ` +
      `målt=${result.measured}`
  );
  if (!result.ok) process.exit(1);
}

function main() {
  const command = process.argv[2];
  if (command === "render") {
    const manifests = renderDatabaseHA(repoRoot);
    console.log(`✔ Skrev ${manifests.size} database-HA-manifester til ${DB_HA_MANIFESTS_DIR}`);
    return;
  }
  if (command === "check") {
    const result = runDatabaseHACheck(repoRoot);
    if (!result.ok) {
      console.error("✘ Database-HA-kontrol fejlede:\n");
      for (const p of result.problems) console.error(`  - ${p}`);
      process.exit(1);
    }
    console.log("✔ Database-HA-plan, semantik, manifester, databaseprofil og serviceklasser er konsistente");
    return;
  }
  if (command === "drill") {
    drill();
    return;
  }
  console.error("Brug: node persistence/src/ha-cli.mjs <render|check|drill>");
  process.exit(2);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) main();
