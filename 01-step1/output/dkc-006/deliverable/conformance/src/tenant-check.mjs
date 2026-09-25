#!/usr/bin/env node
/**
 * DKC-006 — fokuseret check af tenant-konteksten.
 *
 *   node conformance/src/tenant-check.mjs
 *
 * Validerer hver `contracts/examples/tenant-context*.json` mod skemaet og de
 * semantiske regler (kanonisk tenant, ressource-ID'ers tenant, claims og scope).
 */
import { join } from "node:path";
import { contractsDir } from "./schemas.mjs";
import { validateTenantDir } from "./tenant.mjs";

const results = validateTenantDir(join(contractsDir, "examples"));
const problems = results.filter((r) => !r.ok);

if (problems.length === 0) {
  console.log(`✔ ${results.length} tenant-konteksteksempel valideret (skema + ressource-/scope-semantik)`);
  process.exit(0);
}

console.error("✘ Tenant-kontekstvalidering fejlede:\n");
for (const result of problems) {
  console.error(`  - ${result.file}`);
  for (const e of result.errors.slice(0, 10)) console.error(`      ${e.path} ${e.message}`.trimEnd());
}
process.exit(1);
