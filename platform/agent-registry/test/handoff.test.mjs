/**
 * DKC-055 — handoff, uafhængig verifikation og approval-binding.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createAgentRegistry } from "../src/registry.mjs";
import {
  createChangeApprovalBinding,
  createHandoff,
  verifyChangeApprovalBinding,
  verifyHandoff,
  HandoffError,
} from "../src/handoff.mjs";
import { assertIndependentVerification } from "../src/handoff.mjs";
import { manifestFor, humanAdmin } from "../fixtures/manifests.mjs";

function setup() {
  const registry = createAgentRegistry();
  const planner = registry.register({ principal: humanAdmin(), manifest: manifestFor("planner") });
  const implementer = registry.register({ principal: humanAdmin(), manifest: manifestFor("implementer", { model: { provider: "anthropic", model: "claude-opus", modelVersion: "2025-02", promptRef: "p.md" } }) });
  const verifier = registry.register({ principal: humanAdmin(), manifest: manifestFor("verifier", { model: { provider: "openai", model: "gpt-x", promptRef: "p.md" } }) });
  const executor = registry.register({ principal: humanAdmin(), manifest: manifestFor("executor") });
  return { registry, planner, implementer, verifier, executor };
}

test("plan kan kun overdrages fra planner til implementer", () => {
  const { registry, planner, implementer, verifier } = setup();
  const handoff = createHandoff({ changeId: "chg-1", artifactKind: "plan", artifactDigest: "a".repeat(64), inputDigest: "b".repeat(64), producer: planner, receiver: implementer, registry });
  assert.equal(handoff.producerRole, "planner");
  assert.equal(handoff.receiverRole, "implementer");
  assert.match(handoff.digest, /^[a-f0-9]{64}$/);
  assert.throws(
    () => createHandoff({ changeId: "chg-1", artifactKind: "plan", producer: planner, receiver: verifier, registry }),
    (e) => e instanceof HandoffError && e.code === "receiver_role"
  );
});

test("diff og verification følger den asymmetriske graf", () => {
  const { registry, planner, implementer, verifier, executor } = setup();
  createHandoff({ changeId: "chg-1", artifactKind: "diff", producer: implementer, receiver: verifier, registry });
  createHandoff({ changeId: "chg-1", artifactKind: "verification", producer: verifier, receiver: executor, registry });
  // Implementeren kan ikke verificere sin egen diff.
  assert.throws(() => createHandoff({ changeId: "chg-1", artifactKind: "verification", producer: implementer, receiver: executor, registry }), (e) => e.code === "producer_role");
  // Planner kan ikke sende direkte til executor.
  assert.throws(() => createHandoff({ changeId: "chg-1", artifactKind: "plan", producer: planner, receiver: executor, registry }), (e) => e.code === "receiver_role");
});

test("en agent kan ikke overdrage til sig selv", () => {
  const { registry, implementer } = setup();
  assert.throws(() => createHandoff({ changeId: "chg-1", artifactKind: "diff", producer: implementer, receiver: implementer, registry }), (e) => e.code === "self_handoff");
});

test("verifyHandoff opdager en ændret overdragelse", () => {
  const { registry, planner, implementer } = setup();
  const handoff = createHandoff({ changeId: "chg-1", artifactKind: "plan", artifactDigest: "a".repeat(64), producer: planner, receiver: implementer, registry });
  assert.equal(verifyHandoff(handoff, { receiver: implementer, registry }).ok, true);
  const tampered = { ...handoff, artifactDigest: "c".repeat(64) };
  const result = verifyHandoff(tampered, { receiver: implementer, registry });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /digest/.test(e.message)));
});

test("uafhængig verifikation afviser samme identitet, rolle eller model", () => {
  const { registry, planner, implementer, verifier } = setup();
  assert.equal(assertIndependentVerification({ producer: implementer, verifier }), true);
  assert.throws(() => assertIndependentVerification({ producer: implementer, verifier: implementer }), (e) => e.code === "same_identity");
  assert.throws(() => assertIndependentVerification({ producer: implementer, verifier: { ...verifier, role: "implementer" } }), (e) => e.code === "same_role");

  const sameModel = { ...verifier, modelRef: implementer.modelRef, spiffeId: "spiffe://platform.example.org/agents/other" };
  // Samme model i en anden isoleret identitet tæller ikke som uafhængighed.
  assert.throws(() => assertIndependentVerification({ producer: implementer, verifier: sameModel }), (e) => e.code === "same_model");
  assert.ok(registry.get(verifier.spiffeId));
});

test("menneskelig godkendelse binder plan/diff/runbook og kan ikke genbruges", () => {
  const { registry, planner, implementer } = setup();
  const handoff = createHandoff({ changeId: "chg-1", artifactKind: "plan", producer: planner, receiver: implementer, registry });
  const plan = { sha256: "1".repeat(64) };
  const diff = { sha256: "2".repeat(64) };
  const runbook = { sha256: "3".repeat(64) };
  const binding = createChangeApprovalBinding({ changeId: "chg-1", handoff, plan, diff, runbook, approvedBy: "oidc|owner" });
  assert.equal(verifyChangeApprovalBinding(binding, { changeId: "chg-1", handoff, plan, diff, runbook }).ok, true);

  const changedPlan = verifyChangeApprovalBinding(binding, { changeId: "chg-1", handoff, plan: { sha256: "f".repeat(64) }, diff, runbook });
  assert.equal(changedPlan.ok, false);
  assert.ok(changedPlan.errors.some((e) => /planen/.test(e.message)));

  const changedDiff = verifyChangeApprovalBinding(binding, { changeId: "chg-1", handoff, plan, diff: { sha256: "e".repeat(64) }, runbook });
  assert.equal(changedDiff.ok, false);
  assert.ok(changedDiff.errors.some((e) => /diffen/.test(e.message)));

  const changedRunbook = verifyChangeApprovalBinding(binding, { changeId: "chg-1", handoff, plan, diff, runbook: { sha256: "d".repeat(64) } });
  assert.equal(changedRunbook.ok, false);
  assert.ok(changedRunbook.errors.some((e) => /runbooken/.test(e.message)));
});
