/**
 * DKC-055 — konformanstest for én rolle pr. agent.
 *
 * Spejler de syv acceptkriterier, så `make test` dækker dem sammen med
 * agent-registry'ets egne tests.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createAgentRegistry } from "../../agent-registry/src/registry.mjs";
import { roleAllowsVerb, roleMayApprove, roleMayProduce, validateRoleManifest } from "../../agent-registry/src/roles.mjs";
import { assertIndependentVerification, createChangeApprovalBinding, verifyChangeApprovalBinding } from "../../agent-registry/src/handoff.mjs";
import { manifestFor, humanAdmin } from "../../agent-registry/fixtures/manifests.mjs";

test("manifest med flere roller eller en godkenderrolle for AI afvises", () => {
  const multi = manifestFor("planner");
  multi.roles = ["planner", "implementer"];
  assert.equal(validateRoleManifest(multi).ok, false);
  assert.equal(validateRoleManifest(manifestFor("planner", { role: "approver" })).ok, false);
});

test("planner kan ikke deploye; implementer kan ikke godkende", () => {
  assert.equal(roleAllowsVerb("planner", "upgrade.patch"), false);
  assert.equal(roleMayProduce("planner", "implementation"), false);
  assert.equal(roleMayApprove("implementer"), false);
});

test("implementer kan køre egne tests, men ikke udstede verifier-resultatet", () => {
  assert.equal(roleAllowsVerb("implementer", "upgrade.dry-run"), true);
  assert.equal(roleMayProduce("implementer", "verification"), false);
});

test("executor kører kun godkendt indhold og kan ikke planlægge", () => {
  assert.equal(roleAllowsVerb("executor", "propose"), false);
  assert.equal(roleMayProduce("executor", "plan"), false);
});

test("selvoprettelse, shared token og delegation kan ikke omgå rollegrænsen", () => {
  const registry = createAgentRegistry();
  assert.throws(() => registry.register({ principal: { kind: "agent", id: "spiffe://x" }, manifest: manifestFor("planner") }), (e) => e.code === "human_required");
  const a = registry.register({ principal: humanAdmin(), manifest: manifestFor("planner") });
  const b = registry.register({ principal: humanAdmin(), manifest: manifestFor("executor") });
  const ta = registry.issueCredential(a.spiffeId, { taskId: "t1" });
  const tb = registry.issueCredential(b.spiffeId, { taskId: "t1" });
  assert.notEqual(ta.id, tb.id);
  assert.throws(() => registry.retire({ principal: { kind: "agent", id: "spiffe://x" }, spiffeId: a.spiffeId }), (e) => e.code === "human_required");
});

test("genbrug af godkendelse efter ændret plan/diff afvises", () => {
  const plan = { sha256: "1".repeat(64) };
  const diff = { sha256: "2".repeat(64) };
  const binding = createChangeApprovalBinding({ changeId: "chg-1", plan, diff, runbook: null });
  assert.equal(verifyChangeApprovalBinding(binding, { changeId: "chg-1", plan, diff, runbook: null }).ok, true);
  assert.equal(verifyChangeApprovalBinding(binding, { changeId: "chg-1", plan: { sha256: "9".repeat(64) }, diff, runbook: null }).ok, false);
  assert.equal(verifyChangeApprovalBinding(binding, { changeId: "chg-1", plan, diff: { sha256: "9".repeat(64) }, runbook: null }).ok, false);
});

test("samme model i to isolerede identiteter tæller ikke som uafhængighed", () => {
  assert.throws(
    () => assertIndependentVerification({ producer: { spiffeId: "a", role: "implementer", modelRef: "anthropic/m" }, verifier: { spiffeId: "b", role: "verifier", modelRef: "anthropic/m" } }),
    (e) => e.code === "same_model"
  );
});
