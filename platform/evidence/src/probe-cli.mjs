#!/usr/bin/env node
/**
 * DKC-018 — CLI for integration- og runtime-prober.
 *
 *   node evidence/src/probe-cli.mjs check   # validér probemanifestet (offline)
 *   node evidence/src/probe-cli.mjs run     # kør mod levende endpoints og skriv evidensposter
 *
 * Bindingen (commit, image-digest, miljø, upstream-version, run-ID) læses fra
 * miljøet, så en probe aldrig kan genbruges på tværs af artefakter:
 *
 *   DKC_PROBE_COMMIT            fuld commit-SHA (påkrævet for run)
 *   DKC_PROBE_IMAGE_DIGEST      sha256:<64 hex> (valgfri for ikke-containere)
 *   DKC_PROBE_ENVIRONMENT       local|dev|staging|prod (påkrævet for run)
 *   DKC_PROBE_UPSTREAM_VERSION  version af det målte system
 *   DKC_PROBE_RUN_ID            CI-/runtime-run-id
 *   DKC_PROBE_TTL_DAYS          evidensens levetid (default fra manifestet)
 *
 * Endpoints: DKC_PROBE_PDP_URL, DKC_PROBE_AUDIT_URL, DKC_PROBE_GATEWAY_URL,
 * DKC_PROBE_RUNTIME_URL. Mangler de, skrives posten som not-run — aldrig pass.
 * Output skrives til .conformance-out/evidence-probes/ (gitignored).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadProbeManifest, probeManifestProblems, runProbes } from "./probes.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, "..", "..");
const DEFAULT_OUT = join(repoRoot, ".conformance-out", "evidence-probes");

const HELP = `Brug: node evidence/src/probe-cli.mjs <kommando> [flag]

Kommandøer:
  check   validér probemanifestet (offline)
  run     kør prober og skriv evidensposter

Flag til run:
  --out <mappe>   outputmappe (default ${DEFAULT_OUT.replace(repoRoot + "/", "")})
  --json          udskriv kørselen til stdout
`;

function parseArgs(argv) {
  const args = { command: argv[0] ?? "check", out: DEFAULT_OUT, json: false };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") args.out = resolve(argv[++i]);
    else if (a === "--json") args.json = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else throw new Error(`ukendt argument: ${a}`);
  }
  return args;
}

function bindingFromEnv(env) {
  const problems = [];
  if (!env.DKC_PROBE_COMMIT) problems.push("DKC_PROBE_COMMIT mangler");
  if (!env.DKC_PROBE_ENVIRONMENT) problems.push("DKC_PROBE_ENVIRONMENT mangler");
  if (!env.DKC_PROBE_RUN_ID) problems.push("DKC_PROBE_RUN_ID mangler");
  const image = env.DKC_PROBE_IMAGE_DIGEST ?? null;
  if (image && !/^sha256:[a-f0-9]{64}$/.test(image)) problems.push("DKC_PROBE_IMAGE_DIGEST er ikke på formen sha256:<64 hex>");
  return {
    problems,
    binding: {
      commit: env.DKC_PROBE_COMMIT ?? "",
      imageDigest: image,
      environment: env.DKC_PROBE_ENVIRONMENT ?? "",
      upstreamVersion: env.DKC_PROBE_UPSTREAM_VERSION ?? "unknown",
    },
    runId: env.DKC_PROBE_RUN_ID ?? "",
  };
}

async function run(args) {
  const manifest = loadProbeManifest(repoRoot);
  const manifestProblems = probeManifestProblems(manifest);
  if (manifestProblems.length) {
    console.error("✘ Probemanifestet er ugyldigt:\n");
    for (const p of manifestProblems) console.error(`  - ${p}`);
    process.exit(1);
  }
  const { problems, binding, runId } = bindingFromEnv(process.env);
  if (problems.length) {
    console.error("✘ Kan ikke køre prober uden en komplet binding:\n");
    for (const p of problems) console.error(`  - ${p}`);
    console.error("\nSæt miljøvariablerne og prøv igen. Uden binding er et bevis ubrugeligt.");
    process.exit(2);
  }
  const ttlDays = process.env.DKC_PROBE_TTL_DAYS ? Number(process.env.DKC_PROBE_TTL_DAYS) : manifest.ttlDays;
  const result = await runProbes({ manifest, binding, runId, ttlDays });

  mkdirSync(args.out, { recursive: true });
  for (const record of result.records) {
    writeFileSync(join(args.out, `${record.id}.evidence.json`), JSON.stringify(record, null, 2) + "\n");
  }
  const summary = {
    kind: "ProbeRun",
    generatedAt: new Date().toISOString(),
    binding,
    runId,
    summary: result.summary,
    records: result.records.map((r) => ({ id: r.id, mode: r.mode, result: r.result, notes: r.notes ?? null, digest: r.digest })),
  };
  writeFileSync(join(args.out, "probe-run.json"), JSON.stringify(summary, null, 2) + "\n");

  if (args.json) console.log(JSON.stringify(summary, null, 2));
  else {
    console.log(`Prober — ${binding.environment} @ ${binding.commit.slice(0, 12)} (run ${runId})`);
    for (const r of result.records) console.log(`  ${r.result === "pass" ? "✔" : r.result === "fail" ? "✘" : "•"} ${r.id} [${r.mode}] — ${r.notes ?? r.result}`);
    console.log(`  ${result.summary.pass} pass, ${result.summary.fail} fail, ${result.summary["not-run"]} not-run — output: ${args.out}`);
  }
  if (!result.ok) process.exit(1);
}

function check() {
  const manifest = loadProbeManifest(repoRoot);
  const problems = probeManifestProblems(manifest);
  if (problems.length) {
    console.error("✘ Probemanifestet er ugyldigt:\n");
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`✔ Probemanifest valid: ${manifest.probes.length} prober (${manifest.probes.map((p) => p.mode).join(", ")})`);
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
  if (args.help) return console.log(HELP);
  if (args.command === "check") check();
  else if (args.command === "run") await run(args);
  else {
    console.error(`Ukendt kommando: ${args.command}\n\n${HELP}`);
    process.exit(2);
  }
}

main();
