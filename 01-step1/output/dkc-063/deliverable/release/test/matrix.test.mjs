/**
 * DKC-063 — testmatrix, trusselmodel og registre: konsistens og dækning.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { loadAll, releaseProblems, knownPlatformIds, knownControlRefs, repoRoot } from "../src/load.mjs";
import { collectProblems, TEST_MATRIX_DOC, THREAT_MODEL_DOC } from "../src/check.mjs";
import { renderTestMatrix, renderThreatModel } from "../src/render.mjs";
import { CHECKS } from "../../tools/baseline/registry.mjs";
import { BOUNDARIES } from "../../conformance/src/release.mjs";

test("hele release-materialet er internt konsistent og krydsrefereret", () => {
  const { matrix, threats, exceptions, assessments } = loadAll();
  assert.deepEqual(releaseProblems({ matrix, threats, exceptions, assessments }), []);
});

test("hvert obligatorisk krav mapper til en check eller en uafhængig vurdering", () => {
  const { matrix } = loadAll();
  const checkIds = new Set(CHECKS.map((c) => c.id));
  for (const r of matrix.requirements) {
    if (!r.mandatory) continue;
    const hasCheck = (r.checks ?? []).length > 0;
    const hasAssessment = r.independentAssessment?.required === true;
    assert.ok(hasCheck || hasAssessment, `${r.id} mangler både check og uafhængig vurdering`);
    for (const c of r.checks) assert.ok(checkIds.has(c.id), `${r.id} peger på ukendt check ${c.id}`);
  }
});

test("hver check i matrixen findes i baseline-registeret", () => {
  const { matrix } = loadAll();
  const byId = new Map(CHECKS.map((c) => [c.id, c]));
  for (const r of matrix.requirements) {
    for (const c of r.checks) {
      const reg = byId.get(c.id);
      assert.ok(reg, `${r.id}: ukendt check ${c.id}`);
      assert.ok(reg.command.length > 0, `${c.id} mangler kommando`);
    }
  }
});

test("understøttede miljøer og kontrolreferencer findes", () => {
  const { matrix } = loadAll();
  const platforms = knownPlatformIds();
  const controls = knownControlRefs();
  for (const env of matrix.supportedEnvironments) assert.ok(platforms.has(env), `ukendt platform ${env}`);
  for (const r of matrix.requirements) for (const ref of r.controlRefs) assert.ok(controls.has(ref), `${r.id}: ukendt kontrolreference ${ref}`);
});

test("trusselmodellen dækker præcis de syv testede grænser", () => {
  const { threats, matrix } = loadAll();
  assert.deepEqual(threats.boundaries.map((b) => b.id).sort(), [...BOUNDARIES].sort());
  const requirementIds = new Set(matrix.requirements.map((r) => r.id));
  for (const t of threats.threats) {
    for (const rid of t.requirementIds) assert.ok(requirementIds.has(rid), `${t.id}: ukendt krav ${rid}`);
  }
  for (const b of threats.boundaries) {
    for (const rid of b.requirementIds) assert.ok(requirementIds.has(rid), `${b.id}: ukendt krav ${rid}`);
  }
});

test("de genererede dokumenter er i sync med den kanoniske kilde", () => {
  assert.ok(existsSync(TEST_MATRIX_DOC), "docs/testing/test-matrix.md mangler");
  assert.ok(existsSync(THREAT_MODEL_DOC), "docs/security/threat-model.md mangler");
  assert.deepEqual(collectProblems().problems, []);
});

test("rendering er deterministisk", () => {
  const { matrix, threats } = loadAll();
  assert.equal(renderTestMatrix(matrix), renderTestMatrix(matrix));
  assert.equal(renderThreatModel(threats), renderThreatModel(threats));
  assert.match(renderTestMatrix(matrix), /Testmatrix/);
  assert.match(renderThreatModel(threats), /Trusselmodel/);
});

test("repo-roden kan findes fra release-modulet", () => {
  assert.ok(existsSync(`${repoRoot}/release/matrix/test-matrix.json`));
});
