#!/usr/bin/env node
/**
 * DKC-052 — CLI for overtagelsesøvelser og beredskabskontrol.
 *
 *   node continuity/src/takeover-cli.mjs write    # skriv plan + øvelsesrapport
 *   node continuity/src/takeover-cli.mjs check     # validér plan, øvelse og artefakter
 *   node continuity/src/takeover-cli.mjs report    # skriv den kørte øvelse til stdout
 *
 * Øvelsen er deterministisk (`measured: false`); menneskelige out-of-band-trin
 * forbliver AFVENTER. En målt øvelse på levende hosts er `make takeover-live`
 * og er NOT RUN.
 */
import { buildTakeoverSuite, writeTakeoverArtifacts, DRILL_REPORT_PATH, DRILL_DOC_PATH, PLAN_DOC_PATH } from "./takeover-run.mjs";
import { runTakeoverCheck } from "./takeover-check.mjs";

async function main() {
  const command = process.argv[2];
  if (command === "write" || command === "run" || command === "render") {
    const suite = await writeTakeoverArtifacts(process.cwd());
    console.log(`✔ Skrev ${DRILL_REPORT_PATH}, ${PLAN_DOC_PATH} og ${DRILL_DOC_PATH}`);
    console.log(`  Gate: ${suite.gate.status}; scenarier: ${suite.summary.total}; afventer menneske: ${suite.summary.awaitingHuman}`);
    return;
  }
  if (command === "check") {
    const result = await runTakeoverCheck(process.cwd());
    if (!result.ok) {
      console.error("✘ Overtagelses-/beredskabskontrol fejlede:\n");
      for (const p of result.problems) console.error(`  - ${p}`);
      process.exit(1);
    }
    console.log("✔ Overtagelsesplan, øvelse og artefakter er konsistente");
    return;
  }
  if (command === "report") {
    const suite = await buildTakeoverSuite(process.cwd());
    process.stdout.write(JSON.stringify(suite, null, 2) + "\n");
    return;
  }
  console.error("Brug: node continuity/src/takeover-cli.mjs <write|check|report>");
  process.exit(2);
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));
if (invokedDirectly) main();
