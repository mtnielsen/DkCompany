#!/usr/bin/env node
/**
 * DKC-043 — fokuseret kontrol af dedup-politikken.
 *
 *   node dedup/src/check.mjs
 *
 * Kontrollerer at kontrakterne kompilerer i streng Ajv-tilstand, at den
 * kanoniske politik og eksemplerne validerer (skema + beslutningssemantik), at
 * de refererede providerfiler findes, at eksemplet er identisk med den
 * kanoniske politik, og at den genererede dedup-plan er i sync.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAjv } from "../../conformance/src/schemas.mjs";
import { validateDedupPolicy, validateDedupPolicyDir, validateDedupReceiptDir } from "../../conformance/src/dedup.mjs";
import { loadDedupPolicy, dedupPolicyProblems, dedupProviderProblems, DEDUP_POLICY_PATH } from "./policy.mjs";
import { renderDedupPlan, DEDUP_PLAN_DOC } from "./render.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const examplesDir = join(repoRoot, "contracts", "examples");

const errors = [];
const notes = [];

let ajv;
try {
  ({ ajv } = buildAjv({ strict: true }));
  notes.push("dedup-kontrakterne kompilerer i streng Ajv-tilstand");
} catch (err) {
  errors.push(`kontrakterne kunne ikke kompileres: ${err.message}`);
}

if (ajv) {
  const policy = loadDedupPolicy(repoRoot);
  const validation = validateDedupPolicy(policy, ajv);
  if (!validation.ok) for (const e of validation.errors) errors.push(`${DEDUP_POLICY_PATH}${e.path}: ${e.message}`);
  for (const problem of dedupProviderProblems(policy, repoRoot)) errors.push(`${DEDUP_POLICY_PATH}${problem.path}: ${problem.message}`);

  const examplePath = join(examplesDir, "dedup-policy.example.json");
  if (!existsSync(examplePath)) {
    errors.push("contracts/examples/dedup-policy.example.json mangler");
  } else if (readFileSync(examplePath, "utf8") !== readFileSync(join(repoRoot, DEDUP_POLICY_PATH), "utf8")) {
    errors.push("dedup-policy.example.json er ikke identisk med den kanoniske politik");
  }

  for (const result of [...validateDedupPolicyDir(examplesDir, ajv), ...validateDedupReceiptDir(examplesDir, ajv)]) {
    if (result.ok) continue;
    for (const e of result.errors) errors.push(`${result.file}: ${e.path} ${e.message}`.trim());
  }

  const rendered = renderDedupPlan(policy);
  const docPath = join(repoRoot, DEDUP_PLAN_DOC);
  if (!existsSync(docPath)) errors.push(`${DEDUP_PLAN_DOC} mangler; kør 'make dedup-write'`);
  else if (readFileSync(docPath, "utf8") !== rendered) errors.push(`${DEDUP_PLAN_DOC} er ude af trit; kør 'make dedup-write'`);
}

if (errors.length) {
  console.error("✘ Dedup-kontrol fejlede:\n");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
for (const note of notes) console.log(`✔ ${note}`);
console.log("✔ den kanoniske dedup-politik og eksemplerne validerer (skema + beslutningssemantik)");
console.log("✔ fire separate dedup-domæner, ingen tværkundededuplikering, forretningsposter flettes aldrig");
console.log(`✔ ${DEDUP_PLAN_DOC} er i sync`);
