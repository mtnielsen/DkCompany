#!/usr/bin/env node
/**
 * DKC-063 — fokuseret kontrol af testmatrix, trusselmodel, undtagelser og
 * uafhængige vurderinger.
 *
 *   node release/src/check.mjs
 *
 * Kontrollerer at:
 *   - hele release-materialet validerer mod kontrakterne,
 *   - hver check i matrixen findes i baseline-registeret,
 *   - hver platform og kontrolreference findes,
 *   - de genererede dokumenter (testmatrix og trusselmodel) er i sync,
 *   - trusselmodellen dækker præcis de syv testede grænser.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadAll, releaseProblems, repoRoot } from "./load.mjs";
import { renderTestMatrix, renderThreatModel } from "./render.mjs";

export const TEST_MATRIX_DOC = join(repoRoot, "docs", "testing", "test-matrix.md");
export const THREAT_MODEL_DOC = join(repoRoot, "docs", "security", "threat-model.md");

export function collectProblems() {
  const { matrix, threats, exceptions, assessments } = loadAll();
  const problems = releaseProblems({ matrix, threats, exceptions, assessments });

  const checkDoc = (path, expected, hint) => {
    if (!existsSync(path)) {
      problems.push(`${path.replace(repoRoot + "/", "")} mangler. Kør '${hint}'.`);
      return;
    }
    if (readFileSync(path, "utf8") !== expected) {
      problems.push(`${path.replace(repoRoot + "/", "")} er ude af trit med den kanoniske kilde. Kør '${hint}'.`);
    }
  };
  checkDoc(TEST_MATRIX_DOC, renderTestMatrix(matrix), "make release-write");
  checkDoc(THREAT_MODEL_DOC, renderThreatModel(threats), "make release-write");
  return { problems, matrix, threats, exceptions, assessments };
}

function main() {
  const { problems, matrix } = collectProblems();
  if (problems.length) {
    console.error("✘ Release-kontrol fejlede:\n");
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  const reqs = matrix.requirements ?? [];
  const mandatory = reqs.filter((r) => r.mandatory).length;
  const independent = reqs.filter((r) => r.independentAssessment?.required).length;
  console.log(`✔ Release-kontrol bestået (${reqs.length} krav, ${mandatory} obligatoriske, ${independent} med uafhængig vurdering; matrixversion ${matrix.matrixVersion})`);
  console.log("✔ docs/testing/test-matrix.md og docs/security/threat-model.md er i sync");
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));
if (invokedDirectly) main();
