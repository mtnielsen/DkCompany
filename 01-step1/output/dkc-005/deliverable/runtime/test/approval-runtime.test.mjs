/**
 * DKC-005 — luk runtime-bypass af godkendelser.
 *
 * Runtimen må ikke stole på `action.approvals`; den skal bruge et approval-ID
 * og en serververificeret, ændringsbundet beslutning, revalidere lige før
 * handlingen og forbruge godkendelsen atomisk. Testene kører mod den rigtige
 * approval-service fra DKC-004.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createAgentRuntime } from "../src/runtime.mjs";
import { createMemoryAuditLog, createApprovalClient } from "../src/clients.mjs";
import { createApprovalService } from "../../approvals/src/approval-service.mjs";

const manifest = JSON.parse(readFileSync(new URL("../../modules/dummy-ok/agents/backup-agent.json", import.meta.url), "utf8"));
const approvalExample = JSON.parse(readFileSync(new URL("../../contracts/examples/approval-request.example.json", import.meta.url), "utf8"));
const TRAINING = ["evidence-over-prose", "when-to-reject"];
const NOW = Date.parse("2025-09-02T00:00:00Z");
const A3_EVIDENCE = ["tests-pass", "dry-run-clean", "rollback-tested"];

const human = (id) => ({ kind: "human", id, tenantId: "acme", groups: ["platform-approvers"] });
const approvalPdp = (n) => ({ decide: async () => ({ decision: "allow-with-approval", requiredApprovals: n, requiredEvidence: ["policy-allow"] }) });

function makeService() {
  return createApprovalService({ trainingRegistry: () => TRAINING, clock: () => NOW });
}

function approveWithTwo(service) {
  const req = service.create(structuredClone(approvalExample));
  service.decide(req.id, { principal: human("oidc|one"), verdict: "approve" });
  service.decide(req.id, { principal: human("oidc|two"), verdict: "approve" });
  return req;
}

const descriptorFor = (req) => ({
  approvalId: req.id,
  executionId: `exec-${randomUUID()}`,
  tenantId: req.tenantId,
  verb: req.change.verb,
  environment: req.change.environment,
  target: req.change.targets[0],
  diffSha256: req.change.diff.sha256,
  parameters: req.change.parameters,
  policyBundleVersion: req.evidence.policyEvaluation.bundleVersion,
});

const task = (actions, tenantId = "acme") => ({
  apiVersion: "contracts.platform/v1alpha1",
  kind: "AgentTask",
  taskId: randomUUID(),
  tenantId,
  agentRef: manifest.metadata.name,
  objective: "dkc-005",
  actions,
});

const actionFrom = (descriptor, extra = {}) => ({
  verb: descriptor.verb,
  target: descriptor.target,
  environment: descriptor.environment,
  evidence: A3_EVIDENCE,
  approvalId: descriptor.approvalId,
  executionId: descriptor.executionId,
  changeDigest: descriptor.diffSha256,
  parameters: descriptor.parameters,
  policyBundleVersion: descriptor.policyBundleVersion,
  ...extra,
});

function runtimeWith(record, approvalVerifier, pdp = approvalPdp(2)) {
  return createAgentRuntime({
    manifest,
    pdp,
    auditLog: createMemoryAuditLog(),
    approvalVerifier,
    executors: { "upgrade.patch": async () => { record.push("upgrade.patch"); return { summary: "patched" }; } },
  });
}

/* -------------------------------------------------------------------------- */
/* Gyldig godkendelse gennem den rigtige service                              */
/* -------------------------------------------------------------------------- */
test("gyldig godkendelse virker gennem den rigtige service", async () => {
  const service = makeService();
  const req = approveWithTwo(service);
  const client = createApprovalClient({ service });
  const record = [];
  const runtime = runtimeWith(record, client);

  const result = await runtime.runTask(task([actionFrom(descriptorFor(req))]));
  assert.equal(result.status, "completed", JSON.stringify(result));
  assert.deepEqual(record, ["upgrade.patch"]);
  assert.ok(req.decision.consumed, "godkendelsen skal være serverforbrugt");
  assert.equal(req.decision.consumed.executionId.startsWith("exec-"), true);
});

/* -------------------------------------------------------------------------- */
/* Replay og atomisk forbrug                                                  */
/* -------------------------------------------------------------------------- */
test("en godkendelse kan kun forbruges én gang (replay afvises)", async () => {
  const service = makeService();
  const req = approveWithTwo(service);
  const client = createApprovalClient({ service });
  const record = [];
  const runtime = runtimeWith(record, client);

  const first = await runtime.runTask(task([actionFrom(descriptorFor(req), { executionId: "exec-first" })]));
  assert.equal(first.status, "completed");

  const second = await runtime.runTask(task([actionFrom(descriptorFor(req), { executionId: "exec-second" })]));
  assert.equal(second.status, "escalated");
  assert.match(second.reason, /allerede forbrugt|reserveret/);
  assert.equal(record.length, 1, "den anden eksekvering må ikke genbruge godkendelsen");
});

test("serviceens atomiske forbrug tillader kun én samtidig autorisation", async () => {
  const service = makeService();
  const req = approveWithTwo(service);
  const first = descriptorFor(req);
  const second = descriptorFor(req);
  const results = await Promise.all([
    service.authorizeExecution(req.id, first),
    service.authorizeExecution(req.id, second),
  ]);
  assert.equal(results.filter((r) => r.ok).length, 1, "præcis én worker må vinde");
});

test("to samtidige workers kan ikke forbruge samme godkendelse", async () => {
  const service = makeService();
  const req = approveWithTwo(service);
  const client = createApprovalClient({ service });
  const record = [];
  const runtime = runtimeWith(record, client);

  const results = await Promise.all([
    runtime.runTask(task([actionFrom(descriptorFor(req))])),
    runtime.runTask(task([actionFrom(descriptorFor(req))])),
  ]);
  assert.equal(results.filter((r) => r.status === "completed").length, 1);
  assert.equal(record.length, 1);
});

/* -------------------------------------------------------------------------- */
/* Afvisning: forkert handling, kunde eller diff                              */
/* -------------------------------------------------------------------------- */
test("godkendelse til en anden handling afvises", async () => {
  const service = makeService();
  const req = approveWithTwo(service);
  const client = createApprovalClient({ service });
  const record = [];
  const runtime = runtimeWith(record, client);

  const result = await runtime.runTask(task([actionFrom(descriptorFor(req), { target: "dummy-ok/other" })]));
  assert.equal(result.status, "escalated");
  assert.ok(result.approvalReasons.some((r) => /binding/i.test(r)), result.reason);
  assert.equal(record.length, 0);
});

test("godkendelse til en anden kunde afvises", async () => {
  const service = makeService();
  const req = approveWithTwo(service);
  const client = createApprovalClient({ service });
  const record = [];
  const runtime = runtimeWith(record, client);

  const result = await runtime.runTask(task([actionFrom(descriptorFor(req))], "globex"));
  assert.equal(result.status, "escalated");
  assert.ok(result.approvalReasons.some((r) => /binding/i.test(r)), result.reason);
  assert.equal(record.length, 0);
});

test("godkendelse til en tidligere diff afvises", async () => {
  const service = makeService();
  const req = approveWithTwo(service);
  const client = createApprovalClient({ service });
  const record = [];
  const runtime = runtimeWith(record, client);

  const result = await runtime.runTask(task([actionFrom(descriptorFor(req), { changeDigest: "e".repeat(64) })]));
  assert.equal(result.status, "escalated");
  assert.ok(result.approvalReasons.some((r) => /binding/i.test(r)), result.reason);
  assert.equal(record.length, 0);
  assert.equal(req.decision.consumed, undefined, "en afvist binding må ikke forbruge godkendelsen");
});

/* -------------------------------------------------------------------------- */
/* Fail-closed                                                                */
/* -------------------------------------------------------------------------- */
test("utilgængelig approval-service stopper A3", async () => {
  const record = [];
  const client = createApprovalClient({
    endpoint: "http://127.0.0.1:9",
    fetchImpl: async () => { throw new Error("ECONNREFUSED"); },
  });
  const runtime = runtimeWith(record, client);
  const result = await runtime.runTask(task([actionFrom({ approvalId: "appr-x", verb: "upgrade.patch", environment: "staging", target: "dummy-ok", diffSha256: "3".repeat(64), parameters: null, policyBundleVersion: "1" })]));
  assert.equal(result.status, "halted");
  assert.match(result.reason, /approval-service utilgængelig/);
  assert.equal(record.length, 0);
});

test("A3 uden approvalId afvises", async () => {
  const record = [];
  const runtime = runtimeWith(record, { authorizeExecution: async () => ({ ok: true }) });
  const { approvalId, ...withoutApproval } = actionFrom({
    approvalId: "appr-1",
    verb: "upgrade.patch",
    environment: "staging",
    target: "dummy-ok",
    diffSha256: "3".repeat(64),
    parameters: null,
    policyBundleVersion: "1",
  });
  const result = await runtime.runTask(task([withoutApproval]));
  assert.equal(result.status, "escalated");
  assert.match(result.reason, /approvalId mangler/);
  assert.equal(record.length, 0);
});

test("A3 uden konfigureret approval-service stopper (dødemandsgreb)", async () => {
  const record = [];
  const runtime = runtimeWith(record, null);
  const result = await runtime.runTask(task([actionFrom({ approvalId: "appr-1", verb: "upgrade.patch", environment: "staging", target: "dummy-ok", diffSha256: "3".repeat(64), parameters: null, policyBundleVersion: "1" })]));
  assert.equal(result.status, "halted");
  assert.match(result.reason, /approval-service er ikke konfigureret/);
  assert.equal(record.length, 0);
});
