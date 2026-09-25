#!/usr/bin/env node
/**
 * DKC-033 — CLI for pilotforløb og readiness.
 *
 *   node pilot/src/cli.mjs run      # kør de 18 scenarier + abuse + belastning
 *   node pilot/src/cli.mjs check    # validér og sammenlign med den skrevne rapport
 *   node pilot/src/cli.mjs render   # skriv JSON + markdown-rapporten
 *   node pilot/src/cli.mjs report   # udskriv readiness-rapporten som JSON
 *
 * En grøn kørsel er hverken en 30-dages observation, en uafhængig vurdering
 * eller en kundcaccept; de forbliver NOT RUN.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { repoRoot } from "../../conformance/src/schemas.mjs";
import { buildPilotReport, runPilotCheck } from "./check.mjs";
import { renderPilotReport } from "./report.mjs";

const HELP = `Brug: node pilot/src/cli.mjs <kommando>

Kommandøer:
  run     kør pilotscenarier, abuse-prober og afgrænset belastning
  check   validér scenarier, gates og rapportens synkronisering
  render  skriv pilot/report/pilot-readiness-report.json og docs/pilot/readiness-report.md
  report  udskriv readiness-rapporten som JSON
  live    kræver en levende serviceprofil og en navngivet kunde (NOT RUN)
`;

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

async function run() {
  const { report, problems } = await buildPilotReport(repoRoot);
  const passed = report.profiles.filter((p) => p.complete).length;
  console.log(`Pilot: ${passed}/${report.profiles.length} profiler gennemførte alle seks arbejdsgange`);
  for (const profile of report.profiles) {
    const failed = profile.workflows.filter((w) => w.status !== "passed").map((w) => w.journey);
    console.log(`  ${profile.profileRef} (${profile.segment}, ${profile.deploymentProfileRef}): ${profile.complete ? "alle seks" : `mangler ${failed.join(", ")}`}`);
  }
  console.log(`Abuse: ${report.abuse.violations.length} omgåelser | Belastning: ${report.load.failures} fejl, ${report.load.bypasses} omgåelser`);
  console.log(`Readiness: ${report.readiness}`);
  const hardProblems = problems.filter((p) => !/readiness 'not-ready'/.test(p));
  if (hardProblems.length) {
    console.error("✘ Pilotkørsel fejlede:\n");
    for (const p of hardProblems) console.error(`  - ${p}`);
    process.exit(1);
  }
}

async function render() {
  const { report, problems } = await buildPilotReport(repoRoot);
  const rendered = renderPilotReport(report);
  for (const [path, content] of rendered) write(join(repoRoot, path), content);
  console.log(`✔ Skrev ${rendered.length} rapportfiler (readiness: ${report.readiness}, ${problems.length} problemer)`);
}

async function reportJson() {
  const { report } = await buildPilotReport(repoRoot);
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
}

async function check() {
  const result = await runPilotCheck(repoRoot);
  if (!result.ok) {
    console.error("✘ Pilotkontrol fejlede:\n");
    for (const p of result.problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`✔ Pilotkontrol bestået (readiness: ${result.report.readiness})`);
}

async function main() {
  const command = process.argv[2] ?? "check";
  if (command === "run") await run();
  else if (command === "render") await render();
  else if (command === "report") await reportJson();
  else if (command === "check") await check();
  else if (command === "live") {
    console.error("NOT RUN: der findes ingen levende serviceprofil, ingen 30-dages observation og ingen navngivet kundcaccept i dette miljø.");
    process.exit(1);
  } else if (command === "help" || command === "-h" || command === "--help") console.log(HELP);
  else {
    console.error(`Ukendt kommando '${command}'.\n${HELP}`);
    process.exit(2);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  main().catch((error) => {
    console.error(error.stack ?? error.message);
    process.exit(1);
  });
}
