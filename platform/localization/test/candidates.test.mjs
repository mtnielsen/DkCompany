import { test } from "node:test";
import assert from "node:assert/strict";
import { repoRoot } from "../../conformance/src/schemas.mjs";
import { loadFamilies } from "../src/model.mjs";
import { evaluateFamilyCandidates, scoreCandidate, loadCandidate } from "../src/candidates.mjs";

const families = JSON.parse(JSON.stringify(loadFamilies(repoRoot))).families;

test("hver families erklærede kandidat er også den bedst scorende", () => {
  for (const family of families) {
    const evaluation = evaluateFamilyCandidates(repoRoot, family);
    assert.equal(evaluation.matchesDeclaration, true, `${family.id}: valgt ${evaluation.selected}, bedst ${evaluation.bestByScore}`);
  }
});

test("ingen kandidat er menneskeligt godkendt, så gate er blokeret", () => {
  for (const family of families) {
    const evaluation = evaluateFamilyCandidates(repoRoot, family);
    assert.equal(evaluation.selectedGateStatus, "blocked", family.id);
    assert.ok(evaluation.selectedBlockers.length > 0, family.id);
  }
});

test("en kandidat med OIDC, REST og dedikeret database scorer positivt", () => {
  const candidate = loadCandidate(repoRoot, "integration-candidate.tryton.example.json");
  const scored = scoreCandidate(candidate);
  assert.ok(scored.reasons.includes("OIDC-SSO"));
  assert.ok(scored.reasons.includes("dokumenteret REST-API"));
  assert.ok(scored.reasons.includes("dedikeret database pr. tenant"));
});

test("en kandidat med ukendt SSO giver en gate-blokering", () => {
  const candidate = loadCandidate(repoRoot, "integration-candidate.tryton.example.json");
  candidate.sso.capability = "unknown";
  const scored = scoreCandidate(candidate);
  assert.equal(scored.gate.status, "blocked");
  assert.ok(scored.gate.blockers.some((b) => /sso/i.test(b)));
});
