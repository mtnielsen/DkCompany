/**
 * DKC-045 — runtime-integration: server-side runbook-resolver.
 *
 * Runtimen må ikke stole på en klientmedsendt runbook-digest. Den slår den
 * godkendte, signerede runbookversion op server-side, håndhæver scope,
 * parametre, forudsætninger, udløb og forsøgsgrænse, og lader kun en dækket
 * standard-change slippe for en godkendelse pr. mutation.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createAgentRuntime } from "../src/runtime.mjs";
import { createMemoryAuditLog } from "../src/clients.mjs";
import { createApprovalService } from "../../approvals/src/approval-service.mjs";
import { createChangeService } from "../../approvals/src/change-service.mjs";
import { createChangeCalendar } from "../../approvals/src/change-calendar.mjs";
import { signRunbook, runbookDigest } from "../../approvals/src/runbook.mjs";
import { evidenceFixture } from "./evidence-fixtures.mjs";
import { validDecision } from "./pdp-fixtures.mjs";

const manifest = JSON.parse(readFileSync(new URL("../../modules/dummy-ok/agents/backup-agent.json", import.meta.url), "utf8"));
const EVIDENCE = evidenceFixture(["tests-pass", "dry-run-clean", "rollback-tested"]);
const TRAINING = ["evidence-over-prose", "when-to-reject"];
const NOW = Date.parse("2025-09-02T00:00:00Z");
const KEYRING = { "runbook-key-1": "synthetic-runbook-signing-secret" };

const human = (id) => ({ kind: "human", id, tenantId: "acme", groups: ["platform-approvers"] });

function runbook(overrides = {}) {
  const base = {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "Runbook",
    metadata: {
      name: "patch-dummy-ok",
      version: "1.0.0",
      description: "Patchopdater dummy-ok med dry-run, tests og rollback.",
      owner: { team: "platform" },
      accountableHuman: { subject: "oidc|anna.andersen", role: "Platform Owner" },
    },
    scope: { verbs: ["upgrade.patch"], targets: ["dummy-ok"], environments: ["staging"], tenants: ["*"] },
    parameters: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: { library: { type: "string", minLength: 1 }, to: { type: "string", minLength: 1 } },
      },
      limits: { maxDurationSeconds: 300, maxTargets: 1 },
    },
    preconditions: [{ id: "dry-run-clean", check: "dryrun", expect: "clean" }],
    maxImpact: { blastRadius: "single-service", maxTargets: 1, customerVisible: false, maxDurationSeconds: 300 },
    expiry: { approvedAt: "2025-09-01T00:00:00Z", expiresAt: "2025-09-03T00:00:00Z", maxAgeSeconds: 604800 },
    attempts: { maxAttempts: 3, windowSeconds: 3600 },
    rollback: { required: true, method: "git-revert", tested: true },
    postchecks: [{ id: "tests-after", check: "tests", expect: "green", timeoutSeconds: 120, onFailure: "rollback" }],
    approval: { flow: "standard", preApproved: true, preApprovalRef: "APR-x", requiredApprovals: 2, eligibleGroups: ["platform-approvers"] },
    ...overrides,
  };
  return signRunbook(base, { keyId: "runbook-key-1", secret: KEYRING["runbook-key-1"], signedAt: "2025-09-01T00:00:00Z" });
}

function approvalPayload({ id = `apr-${randomUUID()}`, digest, targets = ["dummy-ok"], verb = "runbook.approve" } = {}) {
  return {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "ApprovalRequest",
    id,
    tenantId: "acme",
    createdAt: new Date(NOW).toISOString(),
    agent: { ref: "change-service", spiffeId: "spiffe://platform.example.org/services/change-service", manifestVersion: "1.0.0" },
    trigger: { sourceEventId: randomUUID(), sourceType: "runbook-approval", observedAt: new Date(NOW).toISOString(), untrustedInput: false },
    change: { verb, autonomyClass: "A3", environment: "staging", targets, diff: { sha256: "a".repeat(64) }, parameters: { reason: "runbook" }, runbook: { sha256: digest } },
    evidence: { policyEvaluation: { bundleVersion: "2025.09.01.1", decision: "allow-with-approval" }, tests: { status: "pass", passed: 1, failed: 0 }, dryRun: { status: "clean", exitCode: 0 }, scans: [] },
    blastRadius: { tenants: 1, users: 0, services: ["dummy-ok"], estimatedDowntimeSeconds: 0, reversible: true, personalDataAffected: false, dataCategories: ["operational"] },
    rollback: { method: "git-revert", tested: true },
    agentAssessment: { rationale: "Runbook-godkendelse.", doNothingConsequence: "Ingen.", confidence: 0.9, uncertainties: [], notChecked: [], claims: [] },
    decision: { state: "pending", expiresAt: "2025-09-03T00:00:00Z" },
  };
}

function setupChangeService({ signed = runbook(), postchecks = { tests: () => "green" } } = {}) {
  const approval = createApprovalService({ trainingRegistry: () => TRAINING, clock: () => NOW });
  const calendar = createChangeCalendar({ clock: () => NOW });
  const change = createChangeService({
    approvalService: approval,
    runbookKeyring: KEYRING,
    calendar,
    preconditions: { dryrun: () => "clean" },
    postchecks,
    rollbackExecutor: () => {},
    clock: () => NOW,
  });
  change.registerRunbook(signed);
  const req = approval.create(structuredClone(approvalPayload({ digest: runbookDigest(signed), targets: signed.scope.targets })));
  approval.decide(req.id, { principal: human("oidc|one"), verdict: "approve" });
  approval.decide(req.id, { principal: human("oidc|two"), verdict: "approve" });
  change.approveRunbook({ runbookRef: "patch-dummy-ok@1.0.0", approvalId: req.id });
  return { approval, change };
}

const planningPdp = { decide: async (input) => validDecision(input, { decision: "allow-with-approval", requiredApprovals: 2, requiredEvidence: ["policy-allow"] }) };

function task(actions) {
  return {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "AgentTask",
    taskId: randomUUID(),
    tenantId: "acme",
    agentRef: manifest.metadata.name,
    objective: "dkc-045",
    evidenceIndex: EVIDENCE.index,
    actions,
  };
}

const action = (extra = {}) => ({
  verb: "upgrade.patch",
  target: "dummy-ok",
  environment: "staging",
  parameters: { library: "libfoo", to: "1.2.0" },
  runbookRef: "patch-dummy-ok@1.0.0",
  evidence: ["tests-pass", "dry-run-clean", "rollback-tested"],
  ...extra,
});

/* -------------------------------------------------------------------------- */
/* Standard change: forhåndsgodkendt runbook dækker A3                       */
/* -------------------------------------------------------------------------- */
test("en forhåndsgodkendt standard-change udfører uden godkendelse pr. mutation", async () => {
  const { change } = setupChangeService();
  const record = [];
  const runtime = createAgentRuntime({
    manifest,
    pdp: planningPdp,
    auditLog: createMemoryAuditLog(),
    runbookResolver: change,
    executors: { "upgrade.patch": async () => { record.push("patched"); return { summary: "patched" }; } },
  });
  const result = await runtime.runTask(task([action({ runbookDigest: "f".repeat(64) })]));
  assert.equal(result.status, "completed", JSON.stringify(result));
  assert.deepEqual(record, ["patched"]);
  // Den klientmedsendte digest blev overskrevet af den server-resolvede.
  assert.equal(result.results[0].summary, "patched");
});

test("runtimen overskriver en klientmedsendt runbook-digest med den signerede", async () => {
  const { change } = setupChangeService();
  const runtime = createAgentRuntime({
    manifest,
    pdp: planningPdp,
    auditLog: createMemoryAuditLog(),
    runbookResolver: change,
    executors: { "upgrade.patch": async (a) => ({ summary: `digest=${a.runbookDigest}` }) },
  });
  const result = await runtime.runTask(task([action({ runbookDigest: "f".repeat(64) })]));
  assert.equal(result.status, "completed");
  assert.notEqual(result.results[0].summary, "digest=" + "f".repeat(64));
  assert.match(result.results[0].summary, /^digest=[0-9a-f]{64}$/);
});

/* -------------------------------------------------------------------------- */
/* Uden for scope / ugyldige parametre                                        */
/* -------------------------------------------------------------------------- */
test("en handling uden for runbookens scope afvises", async () => {
  const canary = runbook({ scope: { verbs: ["upgrade.patch"], targets: ["dummy-ok/canary"], environments: ["staging"], tenants: ["*"] } });
  const { change } = setupChangeService({ signed: canary });
  const record = [];
  const runtime = createAgentRuntime({ manifest, pdp: planningPdp, auditLog: createMemoryAuditLog(), runbookResolver: change, executors: { "upgrade.patch": async () => { record.push(1); } } });
  const result = await runtime.runTask(task([action({ target: "dummy-ok" })]));
  assert.equal(result.status, "refused");
  assert.ok(result.runbookReasons.some((r) => /scope/.test(r)), JSON.stringify(result));
  assert.equal(record.length, 0);
});

test("en parameter uden for runbookens skema afvises", async () => {
  const { change } = setupChangeService();
  const record = [];
  const runtime = createAgentRuntime({ manifest, pdp: planningPdp, auditLog: createMemoryAuditLog(), runbookResolver: change, executors: { "upgrade.patch": async () => { record.push(1); } } });
  const result = await runtime.runTask(task([action({ parameters: { library: "libfoo", to: "1.2.0", region: "eu-west-1" } })]));
  assert.equal(result.status, "refused", JSON.stringify(result));
  assert.ok(result.runbookReasons.some((r) => /region/.test(r)));
  assert.equal(record.length, 0);
});

/* -------------------------------------------------------------------------- */
/* Normal change: ingen pre-approval ⇒ godkendelse pr. mutation               */
/* -------------------------------------------------------------------------- */
test("en normal-runbook kræver en godkendelse pr. mutation", async () => {
  const normalRunbook = runbook({ approval: { flow: "normal", preApproved: false, preApprovalRef: null, requiredApprovals: 2, eligibleGroups: ["platform-approvers"] } });
  const approval = createApprovalService({ trainingRegistry: () => TRAINING, clock: () => NOW });
  const change = createChangeService({ approvalService: approval, runbookKeyring: KEYRING, calendar: createChangeCalendar({ clock: () => NOW }), preconditions: { dryrun: () => "clean" }, postchecks: { tests: () => "green" }, clock: () => NOW });
  const reg = change.registerRunbook(normalRunbook);
  assert.equal(reg.ok, true, JSON.stringify(reg.errors));
  const record = [];
  const runtime = createAgentRuntime({ manifest, pdp: planningPdp, auditLog: createMemoryAuditLog(), runbookResolver: change, executors: { "upgrade.patch": async () => { record.push(1); } } });
  const result = await runtime.runTask(task([action({ runbookRef: "patch-dummy-ok@1.0.0" })]));
  assert.equal(result.status, "escalated", JSON.stringify(result));
  assert.match(result.reason, /approvalId mangler/);
  assert.equal(record.length, 0);
});

/* -------------------------------------------------------------------------- */
/* Postcheck-fejl ruller tilbage                                              */
/* -------------------------------------------------------------------------- */
test("en fejlet postcheck efter handlingen ruller tilbage", async () => {
  const { change } = setupChangeService({ postchecks: { tests: () => "red" } });
  const runtime = createAgentRuntime({ manifest, pdp: planningPdp, auditLog: createMemoryAuditLog(), runbookResolver: change, executors: { "upgrade.patch": async () => ({ summary: "patched" }) } });
  const result = await runtime.runTask(task([action()]));
  assert.equal(result.status, "escalated", JSON.stringify(result));
  assert.match(result.reason, /postcheck/);
  assert.equal(result.runbookFinalization.state, "rolled_back");
});

/* -------------------------------------------------------------------------- */
/* A4/immutable kan ikke omgås                                                 */
/* -------------------------------------------------------------------------- */
test("en A4-beskyttet ressource afvises før runbook-resolveren", async () => {
  const { change } = setupChangeService();
  const record = [];
  const runtime = createAgentRuntime({ manifest, pdp: planningPdp, auditLog: createMemoryAuditLog(), runbookResolver: change, executors: { "upgrade.patch": async () => { record.push(1); } } });
  const result = await runtime.runTask(task([action({ target: "policy/bundles" })]));
  assert.equal(result.status, "refused");
  assert.match(result.reason, /A4/);
  assert.equal(record.length, 0);
  // Ingen change må være oprettet for den afviste A4-handling.
  assert.equal(change.listChanges().length, 0);
});
