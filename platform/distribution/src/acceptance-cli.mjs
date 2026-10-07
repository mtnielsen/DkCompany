#!/usr/bin/env node
/**
 * DKC-062 — operatør-CLI for installations- og releaseacceptance.
 *
 *   node distribution/src/acceptance-cli.mjs check
 *   node distribution/src/acceptance-cli.mjs run
 *   node distribution/src/acceptance-cli.mjs render
 *   node distribution/src/acceptance-cli.mjs report
 *   node distribution/src/acceptance-cli.mjs targets
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { repoRoot } from "../../conformance/src/schemas.mjs";
import { buildAcceptanceReport, runAcceptanceCheck } from "./acceptance-check.mjs";
import { renderAcceptanceReport } from "./acceptance-report.mjs";
import { loadAll } from "./acceptance-model.mjs";
import { loadProfiles } from "./catalog.mjs";
import { deriveTargets } from "./acceptance-gate.mjs";

const [, , command] = process.argv;

function writeReport(root, report) {
  const rendered = renderAcceptanceReport(report);
  for (const [path, content] of rendered) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
    console.log(`✔ Skrev ${path}`);
  }
}

async function main() {
  if (command === "check") {
    const result = await runAcceptanceCheck(repoRoot);
    if (!result.ok) {
      console.error("✘ Acceptkontrol fejlede:\n");
      for (const p of result.problems) console.error(`  - ${p}`);
      process.exit(1);
    }
    console.log("✔ Installations- og releaseacceptance er konsistent");
    return;
  }
  if (command === "run") {
    const { report } = await buildAcceptanceReport(repoRoot);
    for (const outcome of report.outcomes) {
      console.log(`${outcome.status === "passed" ? "PASS" : "FAIL"}  ${outcome.id} (${outcome.journey}, ${outcome.profileRef}/${outcome.platformRef})`);
      for (const problem of outcome.problems) console.log(`      - ${problem}`);
    }
    return;
  }
  if (command === "render") {
    const { report } = await buildAcceptanceReport(repoRoot);
    writeReport(repoRoot, report);
    return;
  }
  if (command === "report") {
    const { report } = await buildAcceptanceReport(repoRoot);
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    return;
  }
  if (command === "targets") {
    const all = loadAll(repoRoot);
    const profiles = loadProfiles(join(repoRoot, "catalog", "profiles")).map((p) => p.data);
    for (const target of deriveTargets({ scenarioSet: all.scenarios, profiles })) {
      console.log(`${target.id}: profil=${target.profileRef} type=${target.profileType} platform=${target.platformRef} host=${target.hostManagement} immutable=${target.immutable} selfHealing=${target.selfHealing}`);
    }
    return;
  }
  console.log("Kommandoer: check | run | render | report | targets");
  process.exit(command ? 2 : 0);
}

main();
