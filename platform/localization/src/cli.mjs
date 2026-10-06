#!/usr/bin/env node
/**
 * DKC-035 — CLI for modulregistrering af økonomi, HR og handel.
 *
 *   node localization/src/cli.mjs check       # validér katalog, komponenter og rapport
 *   node localization/src/cli.mjs run         # kør den deterministiske gate-kontrol
 *   node localization/src/cli.mjs render      # skriv rapporten
 *   node localization/src/cli.mjs report      # skriv rapporten til stdout
 *   node localization/src/cli.mjs candidates  # vis kandidatvurderingen pr. familie
 *
 * Alt er deterministisk (`measured: false`). En faktisk adapter og en faglig
 * afgørelse er særskilt NOT RUN (`make localization-live`).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { repoRoot } from "../../conformance/src/schemas.mjs";
import { runLocalizationCheck, buildLocalizationReport } from "./check.mjs";
import { renderLocalizationReport } from "./report.mjs";
import { loadAll } from "./model.mjs";
import { evaluateFamilyCandidates } from "./candidates.mjs";

function writeFile(root, rel, contents) {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

function main() {
  const command = process.argv[2];
  if (command === "check") {
    const result = runLocalizationCheck(repoRoot);
    if (!result.ok) {
      console.error("✘ Modulregistrering fejlede:\n");
      for (const p of result.problems) console.error(`  - ${p}`);
      process.exit(1);
    }
    console.log("✔ Modulregistrering for økonomi, HR og handel er konsistent");
    return;
  }
  if (command === "run") {
    const result = runLocalizationCheck(repoRoot);
    for (const family of result.report.families) {
      console.log(`${family.danishReady ? "READY" : "PENDING"} ${family.id} (${family.familyStatus}); gates: ${family.pendingGates.map((g) => `${g.id}:${g.status}`).join(", ") || "ingen"}`);
    }
    console.log(`${result.ok ? "PASS" : "FAIL"} modulregistrering (${result.report.summary.families} familier, ${result.report.summary.danishReady} danskklare)`);
    if (!result.ok) process.exit(1);
    return;
  }
  if (command === "render") {
    const report = buildLocalizationReport(repoRoot);
    const rendered = renderLocalizationReport(report);
    for (const [rel, value] of rendered) writeFile(repoRoot, rel, value);
    console.log(`✔ Skrev ${rendered.size} modulregistreringsartefakter`);
    return;
  }
  if (command === "report") {
    process.stdout.write(JSON.stringify(buildLocalizationReport(repoRoot), null, 2) + "\n");
    return;
  }
  if (command === "candidates") {
    const all = loadAll(repoRoot);
    const out = all.families.families
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((family) => evaluateFamilyCandidates(repoRoot, family));
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  console.error("Brug: node localization/src/cli.mjs <check|run|render|report|candidates>");
  process.exit(2);
}

main();
