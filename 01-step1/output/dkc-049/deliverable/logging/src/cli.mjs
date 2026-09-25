#!/usr/bin/env node
/**
 * DKC-049 — CLI for loggemodulet.
 *
 *   node logging/src/cli.mjs write   # genskab docs/compliance/log-coverage.md
 *   node logging/src/cli.mjs check   # validér politik + dokument-sync
 *   node logging/src/cli.mjs demo    # kør et fuldt tværserverforløb
 */
import { writeFileSync } from "node:fs";
import { repoRoot } from "../../conformance/src/schemas.mjs";
import { loadLoggingPolicy } from "./policy.mjs";
import { renderLogCoverage } from "./render.mjs";
import { LOG_COVERAGE_DOC, collectLoggingProblems } from "./check.mjs";

const command = process.argv[2] ?? "check";

if (command === "write") {
  const policy = loadLoggingPolicy(repoRoot);
  writeFileSync(LOG_COVERAGE_DOC, renderLogCoverage(policy));
  console.log(`✔ Skrev ${LOG_COVERAGE_DOC.replace(repoRoot + "/", "")}`);
} else if (command === "check") {
  const { problems, policy } = collectLoggingProblems();
  if (problems.length) {
    console.error("✘ Loggekontrol fejlede:\n");
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`✔ Loggepolitik '${policy.metadata.name}' v${policy.metadata.version} valideret`);
} else if (command === "demo") {
  const { runDemo } = await import("./demo.mjs");
  await runDemo();
} else {
  console.error(`Ukendt kommando '${command}'. Brug: write | check | demo`);
  process.exit(2);
}
