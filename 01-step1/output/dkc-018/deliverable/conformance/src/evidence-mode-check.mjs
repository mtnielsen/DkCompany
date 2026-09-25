#!/usr/bin/env node
/**
 * DKC-018 — fokuseret, offline kontraktkontrol for evidensposter og prober.
 *
 *   node conformance/src/evidence-mode-check.mjs
 *
 * Kontrollerer at:
 *   - evidenseksemplet validerer mod `evidence-record.schema.json` og den
 *     semantiske validator (mode, friskhed, binding, digest),
 *   - probe-manifestet er strukturelt gyldigt og kun erklærer
 *     integration/runtime-prober,
 *   - den kanoniske demonstration «fixture-only giver ikke produktionsbadge»
 *     holder offline.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { buildAjv, repoRoot } from "./schemas.mjs";
import { validateEvidenceRecord, productionBadge, sealRecord } from "./evidence-mode.mjs";
import { loadProbeManifest, probeManifestProblems } from "../../evidence/src/probes.mjs";

export function collectProblems(root = repoRoot) {
  const problems = [];
  const ajv = buildAjv().ajv;

  const examplePath = join(root, "contracts", "examples", "evidence-record.example.json");
  if (!existsSync(examplePath)) problems.push("contracts/examples/evidence-record.example.json mangler");
  else {
    const record = JSON.parse(readFileSync(examplePath, "utf8"));
    const result = validateEvidenceRecord(record, ajv, { now: Date.parse(record.capturedAt) + 1000 });
    for (const e of result.errors) problems.push(`evidence-record.example.json: ${e.path} ${e.message}`.trim());
  }

  const probePath = join(root, "evidence", "probes.json");
  if (!existsSync(probePath)) problems.push("evidence/probes.json mangler");
  else {
    for (const p of probeManifestProblems(loadProbeManifest(root))) problems.push(`probes.json: ${p}`);
  }

  // Kanonisk negativ: et rent fixture-/kontraktsæt må aldrig blive production.
  const now = Date.parse("2026-09-23T09:00:00Z");
  const sealed = sealRecord({
    apiVersion: "contracts.platform/v1alpha1",
    kind: "EvidenceRecord",
    id: "fixture-only",
    subject: { kind: "verb", name: "dummy-ok", verb: "backup" },
    mode: "fixture",
    result: "pass",
    commit: "a".repeat(40),
    imageDigest: null,
    environment: "staging",
    upstreamVersion: "dummy-ok@1.2.0",
    runId: "fixture",
    capturedAt: "2026-09-23T08:00:00Z",
    expiresAt: "2026-10-23T08:00:00Z",
    producer: { type: "ci", name: "fixture", subject: "ci|fixture" },
    command: ["make", "conform"],
    artifact: { uri: "x", sha256: "b".repeat(64) },
  });
  const badge = productionBadge({
    requirements: [{ id: "REQ-BACKUP" }],
    records: [sealed],
    now,
    expected: { commit: "a".repeat(40), environment: "staging" },
  });
  if (badge.productionReady || badge.badge !== "fixture-only") {
    problems.push(`fixture-only-reglen holdt ikke: fik badge '${badge.badge}' (productionReady=${badge.productionReady})`);
  }
  return problems;
}

function main() {
  const problems = collectProblems();
  if (problems.length) {
    console.error("✘ Evidensmode-kontrol fejlede:\n");
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  const probeManifest = loadProbeManifest(repoRoot);
  console.log("✔ Evidenspost-eksempel valideret (skema + mode/friskhed/binding/digest)");
  console.log(`✔ Probemanifest valid: ${probeManifest.probes.length} integration/runtime-prober`);
  console.log("✔ Fixture-only-sæt giver badge 'fixture-only', ikke 'production'");
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));
if (invokedDirectly) main();
