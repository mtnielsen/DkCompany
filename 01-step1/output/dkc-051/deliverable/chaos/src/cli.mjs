#!/usr/bin/env node
/**
 * DKC-051 — CLI for fejl- og katastrofematrixen.
 *
 *   node chaos/src/cli.mjs run      # kør hele fejlmatrixen og skriv rapporten
 *   node chaos/src/cli.mjs check    # validér matrix, prober og renderede artefakter
 *   node chaos/src/cli.mjs report   # skriv den kørte rapport til stdout
 *
 * Kørslen er en deterministisk model (`measured: false`). En målt fejløvelse på
 * en levende stagingklynge er `make chaos-live` og er NOT RUN.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { repoRoot } from "../../conformance/src/schemas.mjs";
import { loadFailureMatrix, CHAOS_REPORT_PATH, CHAOS_DOC_PATH } from "./matrix.mjs";
import { runChaos } from "./runner.mjs";
import { renderChaosReport } from "./report.mjs";
import { runChaosCheck } from "./check.mjs";

function writeFile(root, rel, contents) {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

export async function writeChaosReport(root = repoRoot) {
  const matrix = loadFailureMatrix(root);
  const report = await runChaos(root, { matrix });
  writeFile(root, CHAOS_REPORT_PATH, JSON.stringify(report, null, 2) + "\n");
  writeFile(root, CHAOS_DOC_PATH, renderChaosReport(report));
  return report;
}

async function main() {
  const command = process.argv[2];
  if (command === "run" || command === "render") {
    const report = await writeChaosReport(repoRoot);
    console.log(`✔ Skrev ${CHAOS_REPORT_PATH} og ${CHAOS_DOC_PATH}`);
    console.log(`  Gate: ${report.gate.status}; scenarier: ${report.scenarios.length}; afvigelser: ${report.deviations.length}`);
    if (report.gate.status !== "pass") process.exit(1);
    return;
  }
  if (command === "check") {
    const result = await runChaosCheck(repoRoot);
    if (!result.ok) {
      console.error("✘ Chaos-kontrol fejlede:\n");
      for (const p of result.problems) console.error(`  - ${p}`);
      process.exit(1);
    }
    console.log("✔ Fejlmatrix, prober og rapporter er konsistente");
    return;
  }
  if (command === "report") {
    const report = await runChaos(repoRoot);
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    if (report.gate.status !== "pass") process.exit(1);
    return;
  }
  console.error("Brug: node chaos/src/cli.mjs <run|check|report>");
  process.exit(2);
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));
if (invokedDirectly) main();
