/**
 * DKC-055 — den menneskelige godkendelse binder plan/diff/runbook, og
 * executoren kan kun eksekvere den godkendte digest/parametre.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createApprovalService } from "../../approvals/src/approval-service.mjs";
import { computeBindingDigest } from "../../approvals/src/binding.mjs";

const EXAMPLE = JSON.parse(readFileSync(new URL("../../contracts/examples/approval-request.example.json", import.meta.url), "utf8"));
const TRAINING = ["evidence-over-prose", "when-to-reject"];
const NOW = Date.parse("2025-09-02T00:00:00Z");
const PLAN = "a".repeat(64);
const RUNBOOK = "b".repeat(64);

function makeRequest() {
  const req = structuredClone(EXAMPLE);
  req.change.plan = { uri: "git://plans/chg-1.md", sha256: PLAN };
  req.change.runbook = { uri: "git://runbooks/chg-1.md", sha256: RUNBOOK };
  req.change.producer = "spiffe://platform.example.org/agents/dummy-ok-planner";
  return req;
}

function service() {
  return createApprovalService({ trainingRegistry: () => TRAINING, clock: () => NOW });
}

const human = (id) => ({ kind: "human", id, tenantId: "acme", groups: ["platform-approvers"] });

function descriptorFor(req, extra = {}) {
  return {
    approvalId: req.id,
    executionId: "exec-1",
    tenantId: req.tenantId,
    verb: req.change.verb,
    environment: req.change.environment,
    target: req.change.targets[0],
    diffSha256: req.change.diff.sha256,
    planSha256: req.change.plan.sha256,
    runbookSha256: req.change.runbook.sha256,
    producer: req.change.producer,
    parameters: req.change.parameters,
    policyBundleVersion: req.evidence.policyEvaluation.bundleVersion,
    ...extra,
  };
}

test("godkendelsen binder plan, runbook og producent", () => {
  const svc = service();
  const req = svc.create(makeRequest());
  svc.decide(req.id, { principal: human("oidc|one"), verdict: "approve" });
  svc.decide(req.id, { principal: human("oidc|two"), verdict: "approve" });

  const descriptor = descriptorFor(req);
  assert.ok(descriptor.planSha256);
  assert.equal(descriptor.planSha256, PLAN);
  assert.equal(descriptor.runbookSha256, RUNBOOK);
  assert.equal(descriptor.producer, "spiffe://platform.example.org/agents/dummy-ok-planner");
  assert.equal(computeBindingDigest(req), req.decision.binding.digest);
});

test("executor kan ikke eksekvere en ændret plan", () => {
  const svc = service();
  const req = svc.create(makeRequest());
  svc.decide(req.id, { principal: human("oidc|one"), verdict: "approve" });
  svc.decide(req.id, { principal: human("oidc|two"), verdict: "approve" });

  const wrongPlan = svc.authorizeExecution(req.id, descriptorFor(req, { executionId: "exec-wrong-plan", planSha256: "f".repeat(64) }));
  assert.equal(wrongPlan.ok, false);
  assert.ok(wrongPlan.reasons.some((r) => /binding/i.test(r)), wrongPlan.reasons.join("; "));

  const wrongProducer = svc.authorizeExecution(req.id, descriptorFor(req, { executionId: "exec-wrong-producer", producer: "spiffe://evil.example.org/agents/x" }));
  assert.equal(wrongProducer.ok, false);

  const ok = svc.authorizeExecution(req.id, descriptorFor(req, { executionId: "exec-ok" }));
  assert.equal(ok.ok, true, ok.reasons?.join("; "));
});
