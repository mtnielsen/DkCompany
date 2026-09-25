#!/usr/bin/env node
/**
 * DKC-052 — fokuseret kontrol af overtagelsesplan, øvelse og renderede artefakter.
 *
 *   node continuity/src/takeover-check.mjs
 *
 * Kontrollerer offline at:
 *   - planen og kontrakteksemplet validerer mod skemaet og semantikken,
 *   - hvert scenarie kører deterministisk og validerer (inkl. at menneskelige
 *     trin forbliver AFVENTER og at agenten ikke kan godkende beredskab),
 *   - den kørte rapport og de renderede dokumenter er i trit med kilden, og
 *   - semantikken afviser en øvelse, hvor et menneskeligt trin automatisk er
 *     `pass`, eller hvor et påkrævet trin er fejlet uden at blokere.
 *
 * Der køres ingen målt øvelse på levende hosts/kanaler; `make takeover-live`
 * er NOT RUN.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../../conformance/src/schemas.mjs";
import { validateRecoveryDrill, validateTakeoverPlan } from "../../conformance/src/takeover.mjs";
import { loadTakeoverPlan, buildTakeoverSuite, DRILL_REPORT_PATH, DRILL_DOC_PATH, PLAN_DOC_PATH } from "./takeover-run.mjs";
import { renderRecoveryDrillReport, renderTakeoverPlan } from "./takeover-report.mjs";
import { recoveryDrillProblems } from "./takeover.mjs";

export async function runTakeoverCheck(root = repoRoot) {
  const problems = [];
  const plan = loadTakeoverPlan(root);

  const planValidation = validateTakeoverPlan(plan);
  for (const e of planValidation.errors) problems.push(`plan${e.path}: ${e.message}`);

  const examplePath = join(root, "contracts", "examples", "takeover-plan.example.json");
  if (!existsSync(examplePath)) problems.push("contracts/examples/takeover-plan.example.json mangler");
  else {
    const example = JSON.parse(readFileSync(examplePath, "utf8"));
    const validation = validateTakeoverPlan(example);
    for (const e of validation.errors) problems.push(`eksempel${e.path}: ${e.message}`);
  }

  const suite = await buildTakeoverSuite(root, { plan });
  for (const drill of suite.drills) {
    const validation = validateRecoveryDrill(drill);
    for (const e of validation.errors) problems.push(`${drill.scenarioId}${e.path}: ${e.message}`);
  }

  const files = [
    [DRILL_REPORT_PATH, JSON.stringify(suite, null, 2) + "\n"],
    [PLAN_DOC_PATH, renderTakeoverPlan(plan)],
    [DRILL_DOC_PATH, renderRecoveryDrillReport(suite)],
  ];
  for (const [rel, contents] of files) {
    const path = join(root, rel);
    if (!existsSync(path)) problems.push(`${rel} mangler; kør 'make takeover-write'`);
    else if (readFileSync(path, "utf8") !== contents) problems.push(`${rel} er ude af trit; kør 'make takeover-write'`);
  }

  // Negativ kontrol 1: et menneskeligt trin må ikke automatisk være 'pass'.
  const base = suite.drills[0];
  const autoPassed = {
    ...base,
    status: "validated",
    gate: { status: "pass", reasons: [] },
    measurements: { ...base.measurements, dataIntegrityOk: true },
    steps: base.steps.map((s) => (s.kind === "human" && s.status === "pending" ? { ...s, status: "pass", owner: null, at: "2026-09-29T08:00:00Z" } : s)),
  };
  if (recoveryDrillProblems(autoPassed).length === 0) problems.push("semantikken afviser ikke et automatisk bestået menneskeligt trin");

  // Negativ kontrol 2: et fejlet påkrævet trin må ikke give en 'validated'-øvelse.
  const failed = {
    ...base,
    status: "validated",
    gate: { status: "pass", reasons: [] },
    measurements: { ...base.measurements, dataIntegrityOk: true },
    steps: base.steps.map((s) => (s.id === base.steps.find((x) => x.kind === "machine")?.id ? { ...s, status: "fail", result: "injecteret fejl" } : s)),
  };
  if (recoveryDrillProblems(failed).length === 0) problems.push("semantikken afviser ikke en 'validated'-øvelse med et fejlet påkrævet trin");

  // Negativ kontrol 3: en 'validated'-øvelse uden målt dataintegritet afvises.
  // Vi bygger en fuldt bestået øvelse for at isolere netop dataintegriteten.
  const passingHuman = { subject: "oidc|anna.andersen", name: "Anna Andersen", role: "Incident Lead" };
  const passingSteps = base.steps.map((s) =>
    s.kind === "human"
      ? { ...s, status: "pass", owner: passingHuman, at: "2026-09-29T08:00:00Z", result: "udført", escalation: [] }
      : { ...s, status: "pass", at: "2026-09-29T08:00:00Z" }
  );
  const passing = { ...base, status: "validated", gate: { status: "pass", reasons: [] }, steps: passingSteps, measurements: { ...base.measurements, dataIntegrityOk: true } };
  if (recoveryDrillProblems(passing).length > 0) problems.push(`en fuldt bestået øvelse skulle være gyldig: ${JSON.stringify(recoveryDrillProblems(passing))}`);
  const noIntegrity = { ...passing, measurements: { ...passing.measurements, dataIntegrityOk: null } };
  if (recoveryDrillProblems(noIntegrity).length === 0) problems.push("semantikken afviser ikke en 'validated'-øvelse uden målt dataintegritet");

  return { ok: problems.length === 0, problems, plan, suite };
}

async function main() {
  try {
    const result = await runTakeoverCheck(repoRoot);
    if (!result.ok) {
      console.error("✘ Overtagelses-/beredskabskontrol fejlede:\n");
      for (const p of result.problems) console.error(`  - ${p}`);
      process.exit(1);
    }
    console.log(`✔ Overtagelsesplan v${result.plan.metadata.version} med ${result.plan.drills.scenarios.length} scenarier er konsistent`);
    console.log(`✔ Øvelsesgate: ${result.suite.gate.status}; ${result.suite.summary.awaitingHuman} scenarier afventer menneske, ${result.suite.summary.humanPending} menneskelige trin afventer`);
    console.log(`✔ Rapport: ${DRILL_REPORT_PATH}, ${PLAN_DOC_PATH} og ${DRILL_DOC_PATH}`);
  } catch (error) {
    console.error(`✘ Overtagelses-/beredskabskontrol fejlede: ${error?.stack ?? error}`);
    process.exit(1);
  }
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));
if (invokedDirectly) main();
