/**
 * DKC-021 — indlæsning af slettepolitikken.
 *
 * Den kanoniske kilde er `retention/deletion-policy.json`. Den valideres mod
 * `contracts/retention-deletion-policy.schema.json` og de semantiske regler i
 * `conformance/src/retention.mjs`, og `docs/compliance/deletion-coverage.md`
 * genereres herfra. En politik der ikke dækker de fem datalag, eller som slår en
 * ufravigelig regel fra, afvises før den bruges.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateDeletionPolicy } from "../../conformance/src/retention.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, "..", "..");
export const policyPath = join(repoRoot, "retention", "deletion-policy.json");
export const examplePath = join(repoRoot, "contracts", "examples", "retention-deletion-policy.example.json");
export const outputPath = join(repoRoot, "docs", "compliance", "deletion-coverage.md");

export function policyProblems(policy) {
  return validateDeletionPolicy(policy).errors.map((e) => `${e.path} ${e.message}`.trim());
}

export function loadPolicy(path = policyPath) {
  if (!existsSync(path)) throw new Error(`Mangler ${path}`);
  const policy = JSON.parse(readFileSync(path, "utf8"));
  const problems = policyProblems(policy);
  if (problems.length) throw new Error(`Slettepolitikken er ugyldig:\n  - ${problems.join("\n  - ")}`);
  return policy;
}

export function loadCommittedExample(path = examplePath) {
  if (!existsSync(path)) throw new Error(`Mangler ${path}`);
  return JSON.parse(readFileSync(path, "utf8"));
}
