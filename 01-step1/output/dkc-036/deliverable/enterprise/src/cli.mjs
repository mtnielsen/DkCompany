#!/usr/bin/env node
/**
 * DKC-036 — CLI for enterprise- og branchepakker.
 *
 *   node enterprise/src/cli.mjs check      # validér katalog, kapabiliteter, resolver og rapport
 *   node enterprise/src/cli.mjs run        # kør den deterministiske gate-kontrol
 *   node enterprise/src/cli.mjs render     # skriv rapporten
 *   node enterprise/src/cli.mjs report     # skriv rapporten til stdout
 *   node enterprise/src/cli.mjs priority   # vis prioriteringen efter efterspørgsel og TCO
 *   node enterprise/src/cli.mjs scaffold   # se scaffold-kommandoen
 *
 * Alt er deterministisk (`measured: false`). En faktisk testkunde, en
 * underskrevet aftale og en bekræftet faglig/sektor-/AI-vurdering er særskilt
 * NOT RUN (`make enterprise-live`).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { repoRoot } from "../../conformance/src/schemas.mjs";
import { runEnterpriseCheck, buildEnterpriseReport } from "./check.mjs";
import { renderEnterpriseReport } from "./report.mjs";

function writeFile(root, rel, contents) {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

function main() {
  const command = process.argv[2];
  if (command === "check") {
    const result = runEnterpriseCheck(repoRoot);
    if (!result.ok) {
      console.error("✘ Enterprise- og branchepakker fejlede:\n");
      for (const p of result.problems) console.error(`  - ${p}`);
      process.exit(1);
    }
    console.log("✔ Enterprise- og branchepakker er konsistente");
    return;
  }
  if (command === "run") {
    const result = runEnterpriseCheck(repoRoot);
    for (const pkg of result.report.packages) {
      console.log(`${pkg.implementable ? "READY" : "BLOCKED"} ${pkg.id} (${pkg.segment}, ${pkg.profile}); kapabiliteter mangler: ${pkg.capabilities.missing.join(", ") || "ingen"}; blokeringer: ${pkg.blockers.length}`);
    }
    console.log(`${result.ok ? "PASS" : "FAIL"} enterprise-pakker (${result.report.summary.packages} pakker, ${result.report.summary.implementable} implementerbare, ${result.report.summary.blocked} blokerede)`);
    if (!result.ok) process.exit(1);
    return;
  }
  if (command === "render") {
    const report = buildEnterpriseReport(repoRoot);
    const rendered = renderEnterpriseReport(report);
    for (const [rel, value] of rendered) writeFile(repoRoot, rel, value);
    console.log(`✔ Skrev ${rendered.size} enterprise-artefakter`);
    return;
  }
  if (command === "report") {
    process.stdout.write(JSON.stringify(buildEnterpriseReport(repoRoot), null, 2) + "\n");
    return;
  }
  if (command === "priority") {
    const report = buildEnterpriseReport(repoRoot);
    for (const row of report.priority) {
      console.log(`${row.position}. ${row.title} (${row.id}): efterspørgsel ${row.demandScore}, TCO ${row.tco ? row.tco.twelveMonthTco : "—"}, score ${row.priorityScore}`);
    }
    return;
  }
  if (command === "scaffold") {
    console.log("Brug: node enterprise/src/scaffold.mjs new <pakke-id> [--out <mappe>]");
    console.log("Skabelon: enterprise/scaffold/package.template.json");
    return;
  }
  console.error("Brug: node enterprise/src/cli.mjs <check|run|render|report|priority|scaffold>");
  process.exit(2);
}

main();
