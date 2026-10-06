/**
 * DKC-063 — indlæsning og krydsvalidering af release-materialet.
 *
 * Den kanoniske kilde er `release/matrix/test-matrix.json` plus de tre registre
 * (trusler, undtagelser, uafhængige vurderinger). Alt valideres mod kontrakterne
 * og krydsrefereres mod det eksisterende regelsæt: baseline-registeret,
 * platformmatricen fra DKC-053 og kontrolmappingen. En matrix der peger på en
 * check der ikke findes, er værre end ingen matrix.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAjv } from "../../conformance/src/schemas.mjs";
import { validateTestMatrix, validateThreatRegister, validateRiskExceptions, validateIndependentAssessments } from "../../conformance/src/release.mjs";
import { CHECKS } from "../../tools/baseline/registry.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, "..", "..");
export const matrixDir = join(repoRoot, "release", "matrix");

export const MATRIX_PATH = join(matrixDir, "test-matrix.json");
export const THREATS_PATH = join(matrixDir, "threats.json");
export const EXCEPTIONS_PATH = join(matrixDir, "exceptions.json");
export const ASSESSMENTS_PATH = join(matrixDir, "assessments.json");
export const CONTROL_MAPPING_PATH = join(repoRoot, "compliance", "control-mapping.json");
export const PLATFORMS_PATH = join(repoRoot, "catalog", "platforms.json");

function readJson(path) {
  if (!existsSync(path)) throw new Error(`Mangler ${relative(repoRoot, path)}`);
  return JSON.parse(readFileSync(path, "utf8"));
}

export function loadTestMatrix() {
  return readJson(MATRIX_PATH);
}
export function loadThreatRegister() {
  return readJson(THREATS_PATH);
}
export function loadRiskExceptions() {
  return readJson(EXCEPTIONS_PATH);
}
export function loadIndependentAssessments() {
  return readJson(ASSESSMENTS_PATH);
}

/** Alle kendte krav-id'er fra kontrolmappingen (framework-krav og kontroller). */
export function knownControlRefs() {
  const mapping = readJson(CONTROL_MAPPING_PATH);
  const refs = new Set();
  for (const fw of mapping.frameworks ?? []) for (const r of fw.requirements ?? []) refs.add(r.id);
  for (const c of mapping.controls ?? []) refs.add(c.id);
  return refs;
}

export function knownPlatformIds() {
  const data = readJson(PLATFORMS_PATH);
  return new Set((data.platforms ?? []).map((p) => p.id));
}

/**
 * Krydsvalidering af hele release-materialet. Returnerer en liste af
 * menneskelæsbare problemer. `now` kan injiceres i tests.
 */
export function releaseProblems({ matrix, threats, exceptions, assessments, registry = CHECKS, controlRefs = knownControlRefs(), platformIds = knownPlatformIds() } = {}) {
  const problems = [];
  const checkIds = new Set(registry.map((c) => c.id));
  const requirementIds = new Set((matrix?.requirements ?? []).map((r) => r.id));

  for (const r of matrix?.requirements ?? []) {
    for (const c of r.checks ?? []) {
      if (!checkIds.has(c.id)) problems.push(`kravet '${r.id}' peger på den ukendte check '${c.id}'`);
    }
    for (const ref of r.controlRefs ?? []) {
      if (!controlRefs.has(ref)) problems.push(`kravet '${r.id}' peger på den ukendte kontrolreference '${ref}'`);
    }
  }
  for (const env of matrix?.supportedEnvironments ?? []) {
    if (!platformIds.has(env)) problems.push(`matrixen understøtter den ukendte platform '${env}'`);
  }

  const push = (results) => {
    for (const res of results) {
      if (res.ok) continue;
      for (const e of res.errors) problems.push(`${res.file}: ${e.path} ${e.message}`.trim());
    }
  };
  const ajv = buildAjv().ajv;
  push([{ file: "test-matrix.json", ...validateTestMatrix(matrix, ajv) }]);
  push([{ file: "threats.json", ...validateThreatRegister(threats, ajv, { requirementIds }) }]);
  push([{ file: "exceptions.json", ...validateRiskExceptions(exceptions, ajv, { requirementIds }) }]);
  push([{ file: "assessments.json", ...validateIndependentAssessments(assessments, ajv, { requirementIds }) }]);
  return problems;
}

export function loadAll() {
  return {
    matrix: loadTestMatrix(),
    threats: loadThreatRegister(),
    exceptions: loadRiskExceptions(),
    assessments: loadIndependentAssessments(),
  };
}
