#!/usr/bin/env node
/**
 * DKC-045 — fokuseret check af runbooks og changes.
 *
 *   node conformance/src/runbook-check.mjs
 *
 * Validerer hvert `contracts/examples/runbook*.json` mod skemaet, signaturen
 * (med udviklingsnøglesættet) og de semantiske regler, hvert
 * `contracts/examples/change-request*.json` mod flow-/autorisationsreglerne, og
 * at runbook-kataloget i `runbooks/registry.json` peger på de rigtige digests.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot, contractsDir } from "./schemas.mjs";
import { validateRunbookDir, validateChangeRequestDir, knownRunbooksFromExamples } from "./runbook.mjs";
import { runbookDigest, runbookRef } from "../../approvals/src/runbook.mjs";

const NOW = Date.parse("2025-09-02T00:00:00Z");
const examplesDir = join(contractsDir, "examples");
const keyringPath = join(repoRoot, "runbooks/dev-keyring.json");
const keyring = JSON.parse(readFileSync(keyringPath, "utf8"));

const problems = [];
const runbookResults = validateRunbookDir(examplesDir, { now: NOW, keyring });
const changeResults = validateChangeRequestDir(examplesDir, { now: NOW, runbooks: knownRunbooksFromExamples(examplesDir) });

for (const result of [...runbookResults, ...changeResults]) {
  if (result.ok) continue;
  problems.push(`${result.file}\n` + result.errors.slice(0, 10).map((e) => `      ${e.path} ${e.message}`.trim()).join("\n"));
}

// Runbook-kataloget skal pege på de faktiske digests.
const registry = JSON.parse(readFileSync(join(repoRoot, "runbooks/registry.json"), "utf8"));
for (const [i, entry] of (registry.runbooks ?? []).entries()) {
  const contractPath = join(repoRoot, entry.contract ?? "");
  let runbook;
  try {
    runbook = JSON.parse(readFileSync(contractPath, "utf8"));
  } catch (err) {
    problems.push(`/runbooks/${i}/contract: kan ikke læse '${entry.contract}' (${err.message})`);
    continue;
  }
  if (runbookRef(runbook) !== entry.ref) problems.push(`/runbooks/${i}/ref: katalogets ref '${entry.ref}' matcher ikke kontrakten '${runbookRef(runbook)}'`);
  if (runbookDigest(runbook) !== entry.digest) problems.push(`/runbooks/${i}/digest: katalogets digest matcher ikke kontrakten`);
}

if (problems.length === 0) {
  console.log(`✔ ${runbookResults.length} runbook-eksempel valideret (skema + signatur + scope + rollback)`);
  console.log(`✔ ${changeResults.length} change-eksempel valideret (skema + flow + autorisation + runbook-digest)`);
  console.log(`✔ runbook-kataloget peger på ${registry.runbooks?.length ?? 0} verifikationsdigest(s)`);
  process.exit(0);
}

console.error("✘ Runbook-/change-validering fejlede:\n");
for (const p of problems) console.error(`  - ${p}`);
process.exit(1);
