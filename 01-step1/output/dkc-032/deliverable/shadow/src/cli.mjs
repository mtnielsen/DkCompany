#!/usr/bin/env node
/**
 * DKC-032 — CLI for AI i skyggetilstand og begrænset autonomi.
 *
 *   node shadow/src/cli.mjs run      # replay og skriv rapport + dokument
 *   node shadow/src/cli.mjs check    # validér bevilling, datasæt og artefakter
 *   node shadow/src/cli.mjs report   # skriv den kørte rapport til stdout
 *
 * Replayet er deterministisk og bærer `measured: false`. En målt kørsel mod en
 * levende model og stagingklynge er `make shadow-live` og er NOT RUN.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { repoRoot } from "../../conformance/src/schemas.mjs";
import { REPORT_PATH, REPORT_DOC_PATH } from "./policy.mjs";
import { runShadowSuite } from "./runner.mjs";
import { renderShadowReport } from "./report.mjs";
import { runShadowCheck } from "./check.mjs";

function writeFile(root, rel, contents) {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

export async function writeShadowReport(root = repoRoot) {
  const report = await runShadowSuite(root);
  writeFile(root, REPORT_PATH, JSON.stringify(report, null, 2) + "\n");
  writeFile(root, REPORT_DOC_PATH, renderShadowReport(report));
  return report;
}

async function main() {
  const command = process.argv[2];
  if (command === "run" || command === "render") {
    const report = await writeShadowReport(repoRoot);
    console.log(`✔ Skrev ${REPORT_PATH} og ${REPORT_DOC_PATH}`);
    console.log(`  Gate: ${report.gate.status}; skyggemutationer: ${report.shadow.mutationCount}; staging-handlinger: ${report.limitedAutonomy.mutationCount}`);
    if (report.gate.status !== "pass") process.exit(1);
    return;
  }
  if (command === "check") {
    const result = await runShadowCheck(repoRoot);
    if (!result.ok) {
      console.error("✘ Skygge-/autonomikontrol fejlede:\n");
      for (const p of result.problems) console.error(`  - ${p}`);
      process.exit(1);
    }
    console.log("✔ Autonomibevilling, datasæt og rapport er konsistente");
    return;
  }
  if (command === "report") {
    const report = await runShadowSuite(repoRoot);
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    if (report.gate.status !== "pass") process.exit(1);
    return;
  }
  console.error("Brug: node shadow/src/cli.mjs <run|check|report>");
  process.exit(2);
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));
if (invokedDirectly) main();
