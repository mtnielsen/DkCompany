#!/usr/bin/env node
/**
 * DKC-063 — CLI for testmatrix og release-gate.
 *
 *   node release/src/cli.mjs check          # validér matrix, registre og dokumenter
 *   node release/src/cli.mjs write          # skriv docs/testing/test-matrix.md og docs/security/threat-model.md
 *   node release/src/cli.mjs gate           # evaluér seneste baseline og skriv release-gate
 *   node release/src/cli.mjs gate --baseline sti.json --out sti.json --md sti.md
 *
 * Gaten læser en baselinekørsel (evidens) og svarer på om kørslen kan bære en
 * release. Den ændrer intet i repoet ud over det valgte output.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAll, repoRoot } from "./load.mjs";
import { collectProblems, TEST_MATRIX_DOC, THREAT_MODEL_DOC } from "./check.mjs";
import { renderTestMatrix, renderThreatModel, renderGateMarkdown } from "./render.mjs";
import { evaluateGate } from "./gate.mjs";
import { CHECKS } from "../../tools/baseline/registry.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_BASELINE = join(repoRoot, ".conformance-out", "baseline", "latest.json");
const DEFAULT_OUT = join(repoRoot, ".conformance-out", "release-gate.json");
const DEFAULT_MD = join(repoRoot, "docs", "status", "release-gate.md");

const HELP = `Brug: node release/src/cli.mjs <kommando> [flag]

Kommandøer:
  check   validér matrix, registre, krydsreferencer og genererede dokumenter
  write   skriv docs/testing/test-matrix.md og docs/security/threat-model.md
  gate    evaluér en baselinekørsel og skriv release-gate-resultatet

Flag til gate:
  --baseline <sti>   baselinekørsel (default ${DEFAULT_BASELINE.replace(repoRoot + "/", "")})
  --out <sti>        JSON-resultat (default .conformance-out/release-gate.json)
  --md <sti>         Markdown-rapport (default docs/status/release-gate.md)
  --no-md            skriv ikke markdown
  --target-commit <sha>
  --producer-type <implementer|independent-verifier>
  --profile <navn>
  --json             udskriv JSON til stdout
`;

function parseArgs(argv) {
  const args = { command: argv[0] ?? "check", baseline: DEFAULT_BASELINE, out: DEFAULT_OUT, md: DEFAULT_MD, targetCommit: null, producerType: "implementer", profile: "default", json: false, noMd: false };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--baseline") args.baseline = resolve(argv[++i]);
    else if (a === "--out") args.out = resolve(argv[++i]);
    else if (a === "--md") args.md = resolve(argv[++i]);
    else if (a === "--no-md") args.noMd = true;
    else if (a === "--target-commit") args.targetCommit = argv[++i];
    else if (a === "--producer-type") args.producerType = argv[++i];
    else if (a === "--profile") args.profile = argv[++i];
    else if (a === "--json") args.json = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else throw new Error(`ukendt argument: ${a}`);
  }
  return args;
}

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function runCheck() {
  const { problems, matrix } = collectProblems();
  if (problems.length) {
    console.error("✘ Release-kontrol fejlede:\n");
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`✔ Release-kontrol bestået (${matrix.requirements.length} krav, matrixversion ${matrix.matrixVersion})`);
}

function runWrite() {
  const { matrix, threats } = loadAll();
  write(TEST_MATRIX_DOC, renderTestMatrix(matrix));
  write(THREAT_MODEL_DOC, renderThreatModel(threats));
  console.log(`✔ Skrev ${TEST_MATRIX_DOC.replace(repoRoot + "/", "")} og ${THREAT_MODEL_DOC.replace(repoRoot + "/", "")}`);
}

function runGate(args) {
  if (!existsSync(args.baseline)) {
    console.error(`Ingen baseline-evidence fundet: ${args.baseline}\nKør 'make baseline' først.`);
    process.exit(2);
  }
  const baseline = JSON.parse(readFileSync(args.baseline, "utf8"));
  const { matrix, threats, exceptions, assessments } = loadAll();
  const result = evaluateGate({
    baseline,
    matrix,
    registry: CHECKS,
    exceptions,
    assessments,
    threats,
    targetCommit: args.targetCommit,
    producer: { type: args.producerType, name: args.producerType === "implementer" ? "local-baseline" : "independent", subject: args.producerType === "implementer" ? "process|baseline" : "human|independent" },
    profile: args.profile,
  });
  write(args.out, JSON.stringify(result, null, 2) + "\n");
  if (!args.noMd) write(args.md, renderGateMarkdown(result));
  if (args.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    console.log(`Release-gate: ${result.decision.toUpperCase()} (${result.statuses.passed}/${result.statuses.total} krav pass, ${result.statuses.blocking} blokerende)`);
    for (const r of result.requirements) {
      if (r.status === "passed") continue;
      console.log(`  • ${r.requirementId} — ${r.status}: ${(r.reasons[0] ?? "").slice(0, 140)}`);
    }
    console.log(`  Evidens: ${args.baseline}`);
    console.log(`  Resultat: ${args.out}`);
    if (!args.noMd) console.log(`  Rapport: ${args.md}`);
  }
  if (result.decision === "blocked") process.exit(1);
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
  if (args.help) {
    console.log(HELP);
    return;
  }
  if (args.command === "check") runCheck();
  else if (args.command === "write") runWrite();
  else if (args.command === "gate") runGate(args);
  else {
    console.error(`Ukendt kommando: ${args.command}\n\n${HELP}`);
    process.exit(2);
  }
}

main();
