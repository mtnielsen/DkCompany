#!/usr/bin/env node
/**
 * DKC-037 — recovery-rapport.
 *
 *   node continuity/src/report.mjs [--probes fil.json] [--json] [--out fil.md]
 *
 * Uden `--probes` er alle mål `declared-only`/`not-measured`: en konfiguration
 * certificerer ikke et serviceniveau. En probe-fil er en liste af
 * `{ moduleRef, kind, value, capturedAt, evidenceRef }`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { loadServiceClasses } from "./classes.mjs";
import { buildRecoveryReport, renderMarkdown } from "./recovery.mjs";

function parseArgs(argv) {
  const args = { json: false, out: null, probes: null, freshnessDays: 90 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--probes") args.probes = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--freshness-days") args.freshnessDays = Number(argv[++i]);
    else if (a === "--json") args.json = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else throw new Error(`ukendt argument: ${a}`);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Brug: node continuity/src/report.mjs [--probes fil.json] [--freshness-days 90] [--json] [--out fil.md]");
    return;
  }
  const probes = args.probes ? JSON.parse(readFileSync(args.probes, "utf8")) : [];
  const report = buildRecoveryReport({ serviceClasses: loadServiceClasses(), probes, freshnessDays: args.freshnessDays });
  const rendered = args.json ? `${JSON.stringify(report, null, 2)}\n` : `${renderMarkdown(report)}\n`;
  if (args.out) {
    writeFileSync(args.out, rendered);
    console.log(`✔ Recovery-rapport skrevet: ${args.out} (${report.summary.total} tjenester; ${report.summary.measured} målt, ${report.summary.declaredOnly} kun erklæret)`);
    return;
  }
  process.stdout.write(rendered);
}

main();
