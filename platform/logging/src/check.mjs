#!/usr/bin/env node
/**
 * DKC-049 — fokuseret kontrol af loggepolitikken og det genererede dokument.
 *
 *   node logging/src/check.mjs
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../../conformance/src/schemas.mjs";
import { loadLoggingPolicy, policyProblems } from "./policy.mjs";
import { renderLogCoverage } from "./render.mjs";

export const LOG_COVERAGE_DOC = join(repoRoot, "docs", "compliance", "log-coverage.md");

export function collectLoggingProblems() {
  const problems = [];
  let policy = null;
  try {
    policy = loadLoggingPolicy(repoRoot);
  } catch (err) {
    problems.push(`logging/logging-policy.json: ${err.message}`);
  }
  if (policy) {
    for (const p of policyProblems(policy)) problems.push(`logging/logging-policy.json${p.path}: ${p.message}`);
    const expected = renderLogCoverage(policy);
    if (!existsSync(LOG_COVERAGE_DOC)) {
      problems.push("docs/compliance/log-coverage.md mangler. Kør 'make logging-write'.");
    } else if (readFileSync(LOG_COVERAGE_DOC, "utf8") !== expected) {
      problems.push("docs/compliance/log-coverage.md er ude af trit med politikken. Kør 'make logging-write'.");
    }
  }
  return { problems, policy };
}

function main() {
  const { problems, policy } = collectLoggingProblems();
  if (problems.length) {
    console.error("✘ Loggekontrol fejlede:\n");
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`✔ Loggepolitik '${policy.metadata.name}' v${policy.metadata.version} valideret (default-deny, adskilt provenance, WORM-arkiv)`);
  console.log("✔ docs/compliance/log-coverage.md er i sync");
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));
if (invokedDirectly) main();
