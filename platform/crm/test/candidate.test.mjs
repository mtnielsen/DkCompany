import { test } from "node:test";
import assert from "node:assert/strict";
import { repoRoot } from "../../conformance/src/schemas.mjs";
import { evaluateCandidates, loadCandidate, scoreCandidate, SELECTED_PROVIDER } from "../src/candidate-check.mjs";

test("kandidatchecken vælger EspoCRM foran ERPNext", () => {
  const evaluation = evaluateCandidates(repoRoot);
  assert.equal(evaluation.selected, SELECTED_PROVIDER);
  assert.equal(evaluation.selected, "espocrm");
  assert.equal(evaluation.matchesDeclaration, true);
});

test("EspoCRM scorer højere på tenantisolation end ERPNext", () => {
  const espo = scoreCandidate(loadCandidate(repoRoot, "espocrm"));
  const erp = scoreCandidate(loadCandidate(repoRoot, "erpnext"));
  assert.ok(espo.score > erp.score);
  assert.ok(espo.reasons.includes("dedikeret database pr. tenant"));
  assert.ok(!erp.reasons.includes("dedikeret database pr. tenant"));
});

test("ingen kandidat kan være godkendt så længe en nødvendig egenskab er ukendt", () => {
  const espo = loadCandidate(repoRoot, "espocrm");
  assert.equal(espo.verification.status, "candidate_not_approved");
  const evaluation = evaluateCandidates(repoRoot);
  assert.ok(evaluation.candidates.every((c) => c.gateStatus === "blocked"));
});
