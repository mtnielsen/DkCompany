#!/usr/bin/env node
/**
 * DKC-051 — fokuseret kontrol af fejl- og katastrofematrixen.
 *
 *   node chaos/src/check.mjs
 *
 * Kontrollerer offline at:
 *   - matrixen validerer mod skemaet og de semantiske beslutninger,
 *   - hvert scenarie peger på en kendt probe,
 *   - den kørte rapport er i trit med `docs/continuity/chaos-report.md` og
 *     `chaos/report/chaos-report.json`, og
 *   - matrixen faktisk afviser et brud (en negativ mutation fanges).
 *
 * Der køres ingen levende fejløvelse; `make chaos-live` er NOT RUN.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../../conformance/src/schemas.mjs";
import { validateFailureMatrix } from "../../conformance/src/chaos.mjs";
import { loadFailureMatrix, failureMatrixProblems, CHAOS_REPORT_PATH, CHAOS_DOC_PATH } from "./matrix.mjs";
import { PROBES } from "./probes.mjs";
import { runChaos } from "./runner.mjs";
import { renderChaosReport } from "./report.mjs";

export async function runChaosCheck(root = repoRoot) {
  const problems = [];
  const matrix = loadFailureMatrix(root);
  const validation = validateFailureMatrix(matrix);
  for (const e of validation.errors) problems.push(`matrix${e.path}: ${e.message}`);

  for (const scenario of matrix.scenarios ?? []) {
    if (!PROBES[scenario.probe]) problems.push(`scenariet '${scenario.id}' peger på den ukendte probe '${scenario.probe}'`);
  }

  const report = await runChaos(root, { matrix });
  for (const [rel, contents] of [
    [CHAOS_REPORT_PATH, JSON.stringify(report, null, 2) + "\n"],
    [CHAOS_DOC_PATH, renderChaosReport(report)],
  ]) {
    const path = join(root, rel);
    if (!existsSync(path)) problems.push(`${rel} mangler; kør 'make chaos-run'`);
    else if (readFileSync(path, "utf8") !== contents) problems.push(`${rel} er ude af trit; kør 'make chaos-run'`);
  }

  // Negativ kontrol: semantikken skal fange et brud.
  const negative = failureMatrixProblems({ ...matrix, invariants: { ...matrix.invariants, noSplitBrain: false } });
  if (negative.length === 0) problems.push("semantikken afviser ikke en matrix uden noSplitBrain-invarianten");

  if (report.gate.status !== "pass") {
    problems.push(`fejlmatrixens gate blokerer: ${report.gate.reasons.join("; ")}`);
  }

  return { ok: problems.length === 0, problems, matrix, report };
}

function main() {
  runChaosCheck(repoRoot)
    .then((result) => {
      if (!result.ok) {
        console.error("✘ Chaos-kontrol fejlede:\n");
        for (const p of result.problems) console.error(`  - ${p}`);
        process.exit(1);
      }
      console.log(`✔ Fejlmatrix, semantik og ${result.matrix.scenarios.length} scenarier er konsistente`);
      console.log(`✔ Gate: ${result.report.gate.status}; invarianter: ${Object.entries(result.report.invariants).filter(([, v]) => v).length}/${Object.keys(result.report.invariants).length}`);
      console.log(`✔ Rapport: ${CHAOS_REPORT_PATH} og ${CHAOS_DOC_PATH}`);
    })
    .catch((error) => {
      console.error(`✘ Chaos-kontrol fejlede: ${error?.stack ?? error}`);
      process.exit(1);
    });
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));
if (invokedDirectly) main();
