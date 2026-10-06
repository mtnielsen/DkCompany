/**
 * DKC-047 — transitions- og retention/hold-regler.
 *
 * Beviser at beskyttelsen overlever kopiering, eksport og restore efter vedtaget
 * politik: destinationen skal bære samme klasse og samme no-AI-access-flag, og
 * en WORM-retention (inkl. aktivt hold) må ikke falde bort eller forlænges i en
 * transition.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPolicy } from "../src/registry.mjs";
import { evaluateProtectedData, retentionTransitionProblems } from "../src/guard.mjs";

const policy = loadPolicy();
const anna = { subject: "oidc|anna.andersen", name: "Anna Andersen", role: "Platform Owner" };
const human = { kind: "human", id: "oidc|anna.andersen" };
const agent = { kind: "agent", id: "spiffe://platform.example.org/agents/x" };

const worm = (over = {}) => ({
  id: "worm",
  dataClass: "retention-locked",
  noAiAccess: false,
  reclassifiers: [anna],
  retention: { purpose: "Lovpligtig bogføring", maxDays: 1825, trigger: "legal-deadline", hold: { status: "active", ref: "hold://1" }, assessedBy: anna, assessedAt: "2025-09-01" },
  ...over,
});

test("kopi/eksport/restore bevarer en ai-read-only-post", () => {
  const source = { id: "r", dataClass: "ai-read-only", noAiAccess: false, reclassifiers: [anna] };
  assert.equal(evaluateProtectedData({ principal: human, operation: "copy", record: source, destination: { dataClass: "ai-read-only", noAiAccess: false }, policy }).allowed, true);
  assert.equal(evaluateProtectedData({ principal: human, operation: "copy", record: source, destination: { dataClass: "ordinary", noAiAccess: false }, policy }).allowed, false);
  assert.equal(evaluateProtectedData({ principal: human, operation: "export", record: source, destination: null, policy }).allowed, false);
});

test("restore af en WORM-post kræver at retentionen følger med", () => {
  const source = worm();
  const good = { ...source, versionId: "worm@2", retention: { ...source.retention } };
  assert.equal(evaluateProtectedData({ principal: human, operation: "restore", record: source, destination: good, policy }).allowed, true);
  const noRetention = { ...source, versionId: "worm@3", retention: undefined };
  assert.equal(evaluateProtectedData({ principal: human, operation: "restore", record: source, destination: noRetention, policy }).allowed, false);
});

test("et aktivt hold må ikke fjernes og fristen må ikke forlænges ubestemt", () => {
  const source = worm();
  const holdDropped = { ...source, retention: { ...source.retention, hold: { status: "none" } } };
  assert.ok(retentionTransitionProblems(source, holdDropped).some((p) => p.includes("hold")));
  const extended = { ...source, retention: { ...source.retention, maxDays: 99999 } };
  assert.ok(retentionTransitionProblems(source, extended).some((p) => p.includes("forlænger")));
  assert.ok(retentionTransitionProblems(source, {}).length > 0);
});

test("en AI kan ikke kopiere/eksportere/restore en beskyttet post", () => {
  const source = worm();
  for (const op of ["copy", "export", "restore"]) {
    assert.equal(evaluateProtectedData({ principal: agent, operation: op, record: source, destination: source, policy }).allowed, false, `'${op}' skulle være afvist for AI`);
  }
});
