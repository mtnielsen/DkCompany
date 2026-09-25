#!/usr/bin/env node
/**
 * DKC-032 — fokuseret kontrol af autonomibevilling, replay-datasæt og rapport.
 *
 *   node shadow/src/check.mjs
 *
 * Kontrollerer offline at:
 *   - bevillingen og kontrakteksemplet validerer mod skemaet og semantikken,
 *   - replay-datasættet har et navngivet menneske, er anonymiseret og har
 *     modelobservation + ground truth pr. hændelse,
 *   - den kørte rapport og det renderede dokument er i trit med kilden, og
 *   - semantikken faktisk fanger en mutation i en skyggekørsel (negativ kontrol).
 *
 * Der køres ingen levende model eller stagingklynge; `make shadow-live` er NOT RUN.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../../conformance/src/schemas.mjs";
import { validateAutonomyGrant, validateShadowRun } from "../../conformance/src/shadow.mjs";
import { autonomyPolicyProblems, loadAutonomyPolicy, loadReplayDataset, replayDatasetProblems, shadowRunProblems, REPORT_PATH, REPORT_DOC_PATH } from "./policy.mjs";
import { runShadowSuite } from "./runner.mjs";
import { renderShadowReport } from "./report.mjs";

export async function runShadowCheck(root = repoRoot) {
  const problems = [];
  const policy = loadAutonomyPolicy(root);
  const dataset = loadReplayDataset(root);

  const grantValidation = validateAutonomyGrant(policy);
  for (const e of grantValidation.errors) problems.push(`bevilling${e.path}: ${e.message}`);
  for (const p of autonomyPolicyProblems(policy)) problems.push(`bevilling${p.path}: ${p.message}`);

  for (const p of replayDatasetProblems(dataset)) problems.push(`datasæt${p.path}: ${p.message}`);

  const examplePath = join(root, "contracts", "examples", "autonomy-grant.example.json");
  if (!existsSync(examplePath)) problems.push("contracts/examples/autonomy-grant.example.json mangler");
  else {
    const example = JSON.parse(readFileSync(examplePath, "utf8"));
    const validation = validateAutonomyGrant(example);
    for (const e of validation.errors) problems.push(`eksempel${e.path}: ${e.message}`);
  }

  const run = await runShadowSuite(root);
  for (const p of shadowRunProblems(run.shadow)) problems.push(`skyggekørsel${p.path}: ${p.message}`);
  const shadowValidation = validateShadowRun(run.shadow);
  for (const e of shadowValidation.errors) problems.push(`skyggekørsel${e.path}: ${e.message}`);

  for (const [rel, contents] of [
    [REPORT_PATH, JSON.stringify(run, null, 2) + "\n"],
    [REPORT_DOC_PATH, renderShadowReport(run)],
  ]) {
    const path = join(root, rel);
    if (!existsSync(path)) problems.push(`${rel} mangler; kør 'make shadow-run'`);
    else if (readFileSync(path, "utf8") !== contents) problems.push(`${rel} er ude af trit; kør 'make shadow-run'`);
  }

  // Negativ kontrol: en mutation i en skyggekørsel skal fanges af semantikken.
  const mutated = {
    ...run.shadow,
    mutationCount: 1,
    metrics: { ...run.shadow.metrics, executedMutations: 1 },
    decisions: run.shadow.decisions.map((d, i) => (i === 0 ? { ...d, execution: { executed: true, reason: "brud" }, proposal: { ...d.proposal, mutating: true, runbookRef: "bounded-scale@1.0.0" } } : d)),
  };
  const negative = shadowRunProblems(mutated);
  if (negative.length === 0) problems.push("semantikken afviser ikke en skyggekørsel med en mutation");

  return { ok: problems.length === 0, problems, policy, dataset, report: run };
}

async function main() {
  try {
    const result = await runShadowCheck(repoRoot);
    if (!result.ok) {
      console.error("✘ Skygge-/autonomikontrol fejlede:\n");
      for (const p of result.problems) console.error(`  - ${p}`);
      process.exit(1);
    }
    console.log(`✔ Autonomibevilling v${result.policy.metadata.version} (${result.policy.level}) er konsistent`);
    console.log(`✔ Replay-datasæt med ${result.dataset.events.length} hændelser er anonymiseret og scoret`);
    console.log(`✔ Skyggetilstand udførte ${result.report.shadow.mutationCount} mutationer; begrænset autonomi udførte ${result.report.limitedAutonomy.mutationCount} godkendte staging-handlinger`);
    console.log(`✔ Gate: ${result.report.gate.status}; rapport: ${REPORT_PATH} og ${REPORT_DOC_PATH}`);
  } catch (error) {
    console.error(`✘ Skygge-/autonomikontrol fejlede: ${error?.stack ?? error}`);
    process.exit(1);
  }
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));
if (invokedDirectly) main();
