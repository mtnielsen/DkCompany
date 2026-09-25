#!/usr/bin/env node
/**
 * DKC-004 — fokuseret check af godkendelsesbindingen.
 *
 *   node conformance/src/approval-check.mjs
 *
 * Validérer hver `contracts/examples/approval-request*.json` mod skemaet og de
 * semantiske regler (binding, unikke godkendere, selv-godkendelse, tilstand).
 */
import { join } from "node:path";
import { contractsDir } from "./schemas.mjs";
import { validateApprovalDir } from "./approval.mjs";

const results = validateApprovalDir(join(contractsDir, "examples"));
const problems = results.filter((r) => !r.ok);

if (problems.length === 0) {
  console.log(`✔ ${results.length} godkendelseseksempel valideret (skema + binding + state machine)`);
  process.exit(0);
}

console.error("✘ Godkendelsesvalidering fejlede:\n");
for (const result of problems) {
  console.error(`  - ${result.file}`);
  for (const e of result.errors.slice(0, 10)) console.error(`      ${e.path} ${e.message}`.trimEnd());
}
process.exit(1);
