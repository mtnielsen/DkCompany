#!/usr/bin/env node
/**
 * 3.1 — CLI: genererer OSCAL-assessment-results fra platformens artefakter.
 *
 *   node evidence/src/cli.mjs [--out <sti>] [--strict]
 *
 * Standard er at skrive til .conformance-out/oscal-assessment-results.json og
 * altid exit 0. Evidenspakken skal registrere sandheden — også når et fund ikke
 * er opfyldt — ikke skjule den. --strict gør manglende opfyldelse til exit 1.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { collect } from "./collect.mjs";
import { buildAssessmentResults } from "./oscal.mjs";

function parseArgs(argv) {
  const args = { out: ".conformance-out/oscal-assessment-results.json", strict: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out" || a === "-o") args.out = argv[++i];
    else if (a === "--strict") args.strict = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else throw new Error(`Ukendt argument: ${a}`);
  }
  return args;
}

const HELP = `Brug: node evidence/src/cli.mjs [--out <sti>] [--strict]

Bygger en OSCAL 1.1 assessment-results-profil fra:
  - .conformance-out/report.json (konformanskørsler)
  - modulernes verbums-beviser og PDP-beslutninger
  - modulernes audit-hændelser (CloudEvents)
  - git change loggen (NIS2)
  - GitOps-gate-resultaterne

Flag:
  --out <sti>   hvor pakken skrives (default: .conformance-out/oscal-assessment-results.json)
  --strict      exit 1 hvis mindst ét finding er 'not-satisfied'
  -h, --help    vis denne hjælp
`;

function summarize(doc) {
  const results = doc["assessment-results"].results;
  let observations = 0;
  let findings = 0;
  let unsatisfied = 0;
  for (const r of results) {
    observations += r.observations?.length ?? 0;
    for (const f of r.findings ?? []) {
      findings += 1;
      if (f.target.status.state === "not-satisfied") unsatisfied += 1;
    }
  }
  return { results: results.length, observations, findings, unsatisfied };
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
  if (args.help) {
    console.log(HELP);
    return;
  }

  const artifacts = collect();
  const doc = buildAssessmentResults(artifacts);
  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, JSON.stringify(doc, null, 2) + "\n");

  const s = summarize(doc);
  console.log(`✔ OSCAL-evidens skrevet: ${args.out}`);
  console.log(`  ${s.results} resultater · ${s.observations} observationer · ${s.findings} findings`);
  console.log(
    s.unsatisfied === 0
      ? "  ✔ alle findings er 'satisfied'"
      : `  ✘ ${s.unsatisfied} findings er 'not-satisfied' — registreret, ikke skjult`
  );
  if (args.strict && s.unsatisfied > 0) process.exit(1);
}

main();
