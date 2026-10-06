#!/usr/bin/env node
/**
 * DKC-046 — fokuseret check af begrænset selvreparation.
 *
 *   node conformance/src/remediation-check.mjs
 *
 * Validerer remediation-eksemplerne (skema + state machine/reversibilitet/
 * lease/health-semantik), de to signerede selvreparations-runbooks og at
 * runbook-kataloget peger på de rigtige digests.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot, contractsDir, buildAjv } from "./schemas.mjs";
import { validateRemediationPlanDir, validateResourceLeaseDir, validateHealthObservationDir, knownRemediationRunbooks } from "./remediation.mjs";
import { validateRunbook } from "./runbook.mjs";
import { runbookDigest, runbookRef, verifyRunbookSignature } from "../../approvals/src/runbook.mjs";
import { DEFAULT_REMEDIATION_RUNBOOKS } from "../../runtime/src/remediation.mjs";

const NOW = Date.parse("2025-09-02T00:00:00Z");
const examplesDir = join(contractsDir, "examples");
const keyring = JSON.parse(readFileSync(join(repoRoot, "runbooks/dev-keyring.json"), "utf8"));
const ajv = buildAjv().ajv;
const problems = [];

const planResults = validateRemediationPlanDir(examplesDir, { runbooks: knownRemediationRunbooks(repoRoot) });
const leaseResults = validateResourceLeaseDir(examplesDir);
const healthResults = validateHealthObservationDir(examplesDir);
for (const result of [...planResults, ...leaseResults, ...healthResults]) {
  if (result.ok) continue;
  problems.push(`${result.file}\n` + result.errors.slice(0, 10).map((e) => `      ${e.path} ${e.message}`.trim()).join("\n"));
}

// De to initiale runbooks skal være signerede og dække præcis de to verber.
const remediationRunbooks = ["runbooks/stateless-restart.runbook.json", "runbooks/bounded-scale.runbook.json"];
const seenRefs = new Set();
for (const file of remediationRunbooks) {
  let rb;
  try {
    rb = JSON.parse(readFileSync(join(repoRoot, file), "utf8"));
  } catch (err) {
    problems.push(`${file}: kan ikke læses (${err.message})`);
    continue;
  }
  const ref = runbookRef(rb);
  seenRefs.add(ref);
  if (!DEFAULT_REMEDIATION_RUNBOOKS.has(ref)) problems.push(`${file}: '${ref}' er ikke en af de forhåndsgodkendte selvreparations-runbooks`);
  const sig = verifyRunbookSignature(rb, keyring);
  if (!sig.ok) problems.push(`${file}: ${sig.reason}`);
  for (const p of validateRunbook(rb, ajv, { now: NOW, keyring }).errors) problems.push(`${file}: ${p.path} ${p.message}`);
}

// Runbook-katalogets digests skal matche de faktiske, signerede runbooks.
const registry = JSON.parse(readFileSync(join(repoRoot, "runbooks/registry.json"), "utf8"));
let checked = 0;
for (const [i, entry] of (registry.runbooks ?? []).entries()) {
  if (!entry.contract?.endsWith(".runbook.json")) continue;
  const rb = JSON.parse(readFileSync(join(repoRoot, entry.contract), "utf8"));
  if (runbookRef(rb) !== entry.ref) problems.push(`/runbooks/${i}/ref: katalogets ref '${entry.ref}' matcher ikke '${runbookRef(rb)}'`);
  if (runbookDigest(rb) !== entry.digest) problems.push(`/runbooks/${i}/digest: katalogets digest matcher ikke kontrakten`);
  checked += 1;
}
for (const ref of DEFAULT_REMEDIATION_RUNBOOKS) {
  if (!seenRefs.has(ref)) problems.push(`runbook-kataloget mangler '${ref}'`);
}

if (problems.length === 0) {
  console.log(`✔ ${planResults.length} remediation-plan valideret (skema + state machine + reversibilitet + roller + fallback)`);
  console.log(`✔ ${leaseResults.length} resource-lease og ${healthResults.length} health-observation valideret (skema + semantik)`);
  console.log(`✔ ${remediationRunbooks.length} signerede selvreparations-runbooks valideret (${[...DEFAULT_REMEDIATION_RUNBOOKS].join(", ")})`);
  console.log(`✔ runbook-kataloget peger på ${checked} verifikationsdigest(s)`);
  process.exit(0);
}

console.error("✘ Remediation-validering fejlede:\n");
for (const p of problems) console.error(`  - ${p}`);
process.exit(1);
