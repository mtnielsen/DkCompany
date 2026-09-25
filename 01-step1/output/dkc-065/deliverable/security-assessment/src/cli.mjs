#!/usr/bin/env node
/**
 * DKC-065 — CLI for regressionsharness og assessment-gate.
 *
 *   node security-assessment/src/cli.mjs write     # skriv den kanoniske vurdering + rapport
 *   node security-assessment/src/cli.mjs render    # skriv kun rapporten
 *   node security-assessment/src/cli.mjs check     # fejl hvis den committede vurdering er ude af trit
 *   node security-assessment/src/cli.mjs run       # kør den isolerede harness og vis resultatet
 *   node security-assessment/src/cli.mjs gate      # evaluér produktionsgaten
 *   node security-assessment/src/cli.mjs report    # udskriv den redigerede rapport
 *   node security-assessment/src/cli.mjs import --findings <sti> --retests <sti> --out <sti>
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { buildAssessment } from "./build.mjs";
import { runSecurityAssessmentCheck, repoRoot } from "./check.mjs";
import { evaluateAssessmentGate, gateResultProblems, loadAssessment, loadRulesOfEngagement, REPORT_GENERATED_AT } from "./model.mjs";
import { importFindings, importRetests, applyImports } from "./import.mjs";
import { buildReport, renderReportMarkdown } from "./report.mjs";

const HELP = `Brug: node security-assessment/src/cli.mjs <kommando> [flag]

Kommandøer:
  write    skriv security-assessment/assessment.json og rapporten
  render   skriv kun rapporten
  check    validér den committede vurdering og gaten (fejler lukket)
  run      kør den isolerede regressionsharness
  gate     evaluér produktionsgaten
  report   udskriv den redigerede markdown-rapport
  import   importér fund/retest til en vurdering

Flag:
  --out <sti>        output for import
  --findings <sti>   rå fundfil
  --retests <sti>    rå retestfil
  --json             udskriv JSON
  --now <iso>        deterministisk tidsstempel (default ${REPORT_GENERATED_AT})
`;

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

async function main() {
  const argv = process.argv.slice(2);
  const command = argv[0] ?? "check";
  if (command === "help" || command === "--help" || command === "-h") {
    console.log(HELP);
    return;
  }
  const now = Date.parse(readFlag(argv, "--now") ?? REPORT_GENERATED_AT);
  if (command === "write" || command === "render") {
    const { assessment } = await buildAssessment({ root: repoRoot, now });
    const gate = evaluateAssessmentGate({ assessment, roe: loadRulesOfEngagement(repoRoot), now, expectedCommit: assessment.artifactBinding.targetCommit, expectedArtifactDigest: assessment.artifactBinding.artifactDigest });
    const report = buildReport(assessment, gate);
    if (command === "write") {
      write(join(repoRoot, "security-assessment", "assessment.json"), JSON.stringify(assessment, null, 2) + "\n");
    }
    write(join(repoRoot, "security-assessment", "report", "security-assessment-report.json"), JSON.stringify(report, null, 2) + "\n");
    write(join(repoRoot, "docs", "release", "security-assessment.md"), renderReportMarkdown(report));
    console.log(`✔ Skrev sikkerhedsvurdering (${assessment.coverage.length} kategorier) og rapport`);
    return;
  }
  if (command === "run") {
    const { run } = await buildAssessment({ root: repoRoot, now });
    console.log(`Sikkerhedsharness ${run.id} mod ${run.targetId}: ${run.summary.passed}/${run.summary.total} sonder bestået`);
    for (const p of run.probes) console.log(`  ${p.result === "passed" ? "✔" : "✘"} ${p.id} [${p.category}] — ${p.assertion}`);
    return;
  }
  if (command === "gate") {
    const assessment = loadAssessment(repoRoot);
    const roe = loadRulesOfEngagement(repoRoot);
    const gate = evaluateAssessmentGate({ assessment, roe, now, expectedCommit: assessment.artifactBinding.targetCommit, expectedArtifactDigest: assessment.artifactBinding.artifactDigest });
    for (const p of gateResultProblems(gate)) throw new Error(`${p.path} ${p.message}`);
    if (readFlag(argv, "--json")) process.stdout.write(JSON.stringify(gate, null, 2) + "\n");
    else {
      console.log(`Produktionsgate: ${gate.decision.toUpperCase()}${gate.outstanding ? " (udestående)" : ""} (${gate.blockers.length} blokker(e))`);
      for (const b of gate.blockers) console.log(`  • ${b.id}: ${b.reason}`);
    }
    return;
  }
  if (command === "report") {
    const assessment = loadAssessment(repoRoot);
    const roe = loadRulesOfEngagement(repoRoot);
    const gate = evaluateAssessmentGate({ assessment, roe, now, expectedCommit: assessment.artifactBinding.targetCommit, expectedArtifactDigest: assessment.artifactBinding.artifactDigest });
    process.stdout.write(renderReportMarkdown(buildReport(assessment, gate)));
    return;
  }
  if (command === "import") {
    const findingsPath = readFlag(argv, "--findings");
    const retestsPath = readFlag(argv, "--retests");
    const out = readFlag(argv, "--out");
    if (!findingsPath || !out) throw new Error("import kræver --findings og --out");
    if (!existsSync(findingsPath)) throw new Error(`findings-filen findes ikke: ${findingsPath}`);
    const assessment = loadAssessment(repoRoot);
    const raw = JSON.parse(readFileSync(resolve(findingsPath), "utf8"));
    const { findings } = importFindings(raw, { artifactDigest: assessment.artifactBinding.artifactDigest, source: raw.source ?? "independent-assessor", now });
    const { retests, problems } = retestsPath && existsSync(retestsPath) ? importRetests(JSON.parse(readFileSync(resolve(retestsPath), "utf8")), { findings, currentArtifactDigest: assessment.artifactBinding.artifactDigest, now }) : { retests: [], problems: [] };
    const { assessment: next, impactReviewRequired } = applyImports(assessment, { findings, retests });
    write(resolve(out), JSON.stringify(next, null, 2) + "\n");
    console.log(`✔ Importerede ${findings.length} fund og ${retests.length} retest til ${out}${impactReviewRequired ? " (impact review påkrævet)" : ""}`);
    for (const p of problems) console.error(`  - ${p}`);
    return;
  }
  if (command === "check") {
    const result = await runSecurityAssessmentCheck(repoRoot);
    if (!result.ok) {
      console.error("✘ Sikkerhedsvurderingskontrol fejlede:\n");
      for (const p of result.problems) console.error(`  - ${p}`);
      process.exit(1);
    }
    console.log(`✔ Sikkerhedsvurdering bestået (${result.assessment.coverage.length} kategorier, gate ${result.gate.decision})`);
    return;
  }
  throw new Error(`Ukendt kommando: ${command}\n\n${HELP}`);
}

function readFlag(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
}

main().catch((err) => {
  console.error(err.message);
  process.exit(2);
});
