/**
 * DKC-046 — begrænset selvreparation med sikker fallback.
 *
 * Tester den deterministiske orkestrator mod den rigtige runtime (DKC-005/007/011),
 * den rigtige change-service/runbook-resolver (DKC-045) og den rigtige
 * approval-service (DKC-004). Dækker acceptkriterierne:
 *
 *   1. Agent udfører kun godkendt runbook med verificerede parametergrænser.
 *   2. To agenter kan ikke reparere samme ressource samtidigt.
 *   3. Fejlet postcheck udløser kun autoriseret rollback; ellers stop og menneske.
 *   4. Audit/PDP/approval-tab stopper nye agentmutationer.
 *   5. Irreversibel migration/restore beskrives ikke som generelt reversibel.
 *   6. Modeludfald stopper AI-ændringer, mens uafhængige godkendte
 *      infrastrukturfunktioner fortsætter.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createAgentRuntime } from "../src/runtime.mjs";
import { createMemoryAuditLog, createApprovalClient } from "../src/clients.mjs";
import { createApprovalService } from "../../approvals/src/approval-service.mjs";
import { createChangeService } from "../../approvals/src/change-service.mjs";
import { createChangeCalendar } from "../../approvals/src/change-calendar.mjs";
import { runbookDigest } from "../../approvals/src/runbook.mjs";
import {
  createRemediationOrchestrator,
  createResourceLease,
  createRemediationBudget,
  createSafeFallback,
  observeHealth,
  describeReversibility,
  assertRoleSeparation,
} from "../src/remediation.mjs";
import { validDecision } from "./pdp-fixtures.mjs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const read = (rel) => JSON.parse(readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8"));
const statelessRestart = read("runbooks/stateless-restart.runbook.json");
const boundedScale = read("runbooks/bounded-scale.runbook.json");
const keyring = read("runbooks/dev-keyring.json");
const NOW = Date.parse("2025-09-02T00:00:00Z");
const TRAINING = ["evidence-over-prose", "when-to-reject"];

const manifest = {
  apiVersion: "contracts.platform/v1alpha1",
  kind: "AgentManifest",
  role: "executor",
  metadata: {
    name: "remediation-executor",
    version: "1.0.0",
    description: "Udfører afgrænsede selvreparationer inden for en godkendt runbook.",
    accountableHuman: { subject: "oidc|anna.andersen", role: "Platform Owner" },
  },
  identity: { spiffeId: "spiffe://platform.example.org/agents/remediation-executor", credentialMode: "just-in-time", maxCredentialTtlSeconds: 900 },
  scope: { ownedComponents: ["service/checkout"], environments: ["staging", "prod"], dataCategories: ["operational"] },
  capabilities: [
    { verb: "restart", target: "service/checkout", executor: "module:checkout", autonomyClass: "A3", requiredEvidence: ["policy-allow"] },
    { verb: "scale", target: "service/checkout", executor: "module:checkout", autonomyClass: "A3", requiredEvidence: ["policy-allow"] },
  ],
  escalation: { repeatFailureLimit: 3, onGovernanceUnreachable: "halt" },
};

const human = (id) => ({ kind: "human", id, tenantId: "acme", groups: ["platform-approvers"] });

function approvalPayload({ digest, targets }) {
  return {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "ApprovalRequest",
    id: `apr-${randomUUID()}`,
    tenantId: "acme",
    createdAt: new Date(NOW).toISOString(),
    agent: { ref: "remediation", spiffeId: "spiffe://platform.example.org/services/remediation", manifestVersion: "1.0.0" },
    trigger: { sourceEventId: randomUUID(), sourceType: "runbook-approval", observedAt: new Date(NOW).toISOString(), untrustedInput: false },
    change: { verb: "runbook.approve", autonomyClass: "A3", environment: "staging", targets, diff: { sha256: "a".repeat(64) }, parameters: {}, runbook: { sha256: digest } },
    evidence: { policyEvaluation: { bundleVersion: "1", decision: "allow-with-approval" }, tests: { status: "pass", passed: 1, failed: 0 }, dryRun: { status: "clean", exitCode: 0 }, scans: [] },
    blastRadius: { tenants: 1, users: 0, services: ["checkout"], estimatedDowntimeSeconds: 0, reversible: true, personalDataAffected: false, dataCategories: ["operational"] },
    rollback: { method: "restart", tested: true },
    agentAssessment: { rationale: "Runbook-godkendelse til selvreparation.", doNothingConsequence: "Ingen.", confidence: 0.9, uncertainties: [], notChecked: [], claims: [] },
    decision: { state: "pending", expiresAt: "2025-09-03T00:00:00Z" },
  };
}

function setup({ postchecks = { healthcheck: () => "green" }, calendarOverrides = {} } = {}) {
  const auditLog = createMemoryAuditLog();
  const approvalService = createApprovalService({ trainingRegistry: () => TRAINING, clock: () => NOW });
  const calendar = createChangeCalendar({ clock: () => NOW, ...calendarOverrides });
  const changeService = createChangeService({
    approvalService,
    runbookKeyring: keyring,
    calendar,
    preconditions: { healthcheck: () => "green", stateless: () => true, headroom: () => true },
    postchecks,
    rollbackExecutor: () => {},
    clock: () => NOW,
  });
  for (const rb of [statelessRestart, boundedScale]) {
    const reg = changeService.registerRunbook(rb);
    assert.equal(reg.ok, true, JSON.stringify(reg.errors));
    const req = approvalService.create(structuredClone(approvalPayload({ digest: runbookDigest(rb), targets: rb.scope.targets })));
    approvalService.decide(req.id, { principal: human("oidc|one"), verdict: "approve" });
    approvalService.decide(req.id, { principal: human("oidc|two"), verdict: "approve" });
    changeService.approveRunbook({ runbookRef: `${rb.metadata.name}@${rb.metadata.version}`, approvalId: req.id });
  }
  const record = [];
  const executors = {
    restart: async () => { record.push("restart"); return { summary: "restarted" }; },
    scale: async () => { record.push("scale"); return { summary: "scaled" }; },
  };
  const runtime = createAgentRuntime({
    manifest,
    pdp: { decide: async (input) => validDecision(input, { decision: "allow" }) },
    auditLog,
    runbookResolver: changeService,
    approvalVerifier: createApprovalClient({ service: approvalService }),
    executors,
  });
  const lease = createResourceLease({ clock: () => NOW });
  const budget = createRemediationBudget({ clock: () => NOW });
  return { auditLog, approvalService, changeService, runtime, lease, budget, record };
}

function orchestrator(parts, { pdp = { decide: async () => ({ decision: "allow" }) }, diagnose = null, propose = null, verifier = null, safeFallback = null } = {}) {
  return createRemediationOrchestrator({
    changeService: parts.changeService,
    agentRuntime: parts.runtime,
    lease: parts.lease,
    budget: parts.budget,
    auditLog: parts.auditLog,
    pdp,
    diagnose,
    propose,
    verifier,
    safeFallback,
    clock: () => NOW,
  });
}

const signal = (extra = {}) => ({
  target: "service/checkout",
  environment: "staging",
  tenantId: "acme",
  owner: "agent-a",
  executorAgentRef: manifest.metadata.name,
  runbookRef: "stateless-restart@1.0.0",
  verb: "restart",
  parameters: { maxDurationSeconds: 60, reason: "unhealthy" },
  healthSamples: [1, 1, 1],
  ...extra,
});

/* -------------------------------------------------------------------------- */
/* Accept 1: kun godkendt runbook med verificerede parametergrænser           */
/* -------------------------------------------------------------------------- */
test("accept 1: en forhåndsgodkendt runbook udfører og genopretter", async () => {
  const parts = setup();
  const orch = orchestrator(parts);
  const result = await orch.run(signal());
  assert.equal(result.state, "recovered", JSON.stringify(result));
  assert.deepEqual(parts.record, ["restart"]);
  const states = result.history.filter((h) => h.type.startsWith("state:")).map((h) => h.type.slice(6));
  for (const expected of ["detected", "correlated", "diagnosed", "proposed", "authorized", "intent", "executing", "verifying", "recovered"]) {
    assert.ok(states.includes(expected), `mangler tilstand '${expected}' i ${states.join(",")}`);
  }
});

test("accept 1b: parametre uden for runbookens grænser afvises før eksekvering", async () => {
  const parts = setup();
  const orch = orchestrator(parts);
  const result = await orch.run(signal({ parameters: { maxDurationSeconds: 9999, reason: "for stor" } }));
  assert.equal(result.state, "escalated", JSON.stringify(result));
  assert.equal(parts.record.length, 0);
  assert.ok(result.reason.includes("parametre"));
});

test("accept 1c: en runbook uden pre-approval kræver menneskelig godkendelse", async () => {
  const parts = setup();
  // Fjern pre-approvalen.
  parts.changeService.preApprovals.clear();
  const orch = orchestrator(parts);
  const result = await orch.run(signal());
  assert.equal(result.state, "escalated");
  assert.match(result.reason, /godkendelse/);
  assert.equal(parts.record.length, 0);
});

/* -------------------------------------------------------------------------- */
/* Accept 2: to agenter kan ikke reparere samme ressource samtidigt           */
/* -------------------------------------------------------------------------- */
test("accept 2: en anden agents aktive lease blokerer reparationen", async () => {
  const parts = setup();
  const held = parts.lease.acquire({ resource: "service/checkout", owner: "agent-a", ttlSeconds: 900, at: NOW });
  assert.equal(held.ok, true);
  const orch = orchestrator(parts);
  const result = await orch.run(signal({ owner: "agent-b" }));
  assert.equal(result.state, "cooldown", JSON.stringify(result));
  assert.match(result.reason, /agent-a/);
  assert.equal(parts.record.length, 0);
});

test("accept 2b: efter frigivelse gælder cooldown", async () => {
  const parts = setup();
  const held = parts.lease.acquire({ resource: "service/checkout", owner: "agent-a", ttlSeconds: 900, at: NOW });
  parts.lease.release({ resource: "service/checkout", owner: "agent-a", fencingToken: held.lease.fencingToken, at: NOW });
  const orch = orchestrator(parts);
  const result = await orch.run(signal({ owner: "agent-b" }));
  assert.equal(result.state, "cooldown");
  assert.match(result.reason, /cooldown/);
});

test("accept 2c: leasen kan ikke omgås af en anden ejer (fencing)", async () => {
  const parts = setup();
  const a = parts.lease.acquire({ resource: "service/checkout", owner: "agent-a", ttlSeconds: 900, at: NOW });
  const b = parts.lease.acquire({ resource: "service/checkout", owner: "agent-b", ttlSeconds: 900, at: NOW });
  assert.equal(b.ok, false);
  assert.equal(parts.lease.isValid({ resource: "service/checkout", owner: "agent-a", fencingToken: a.lease.fencingToken, at: NOW }), true);
});

/* -------------------------------------------------------------------------- */
/* Accept 3: fejlet postcheck → kun autoriseret rollback, ellers menneske    */
/* -------------------------------------------------------------------------- */
test("accept 3: forværring udløser en autoriseret rollback", async () => {
  const parts = setup();
  const orch = orchestrator(parts);
  const result = await orch.run(signal({ healthSamples: [1, 1, 0.1] }));
  assert.equal(result.state, "rolled_back", JSON.stringify(result));
  assert.deepEqual(parts.record, ["restart", "restart"]);
  assert.equal(result.health.degraded, true);
});

test("accept 3c: hvis rollback ikke er autoriseret, stoppes der og eskaleres", async () => {
  const parts = setup();
  const orch = orchestrator(parts);
  // Tving en normal-runbook uden pre-approval for rollback-verbummet.
  const result = await orch.run(signal({ healthSamples: [1, 0.1], rollbackRunbookRef: "unknown-rollback@1.0.0" }));
  assert.equal(result.state, "escalated", JSON.stringify(result));
  assert.ok(result.reason.includes("rollback") || result.safeFallback || result.rollbackReasons);
});

/* -------------------------------------------------------------------------- */
/* Accept 4: audit/PDP/approval-tab stopper nye agentmutationer               */
/* -------------------------------------------------------------------------- */
test("accept 4: PDP-tab stopper AI-ændringer, men sikker fallback fortsætter", async () => {
  const parts = setup();
  const fallbackRuns = [];
  const safeFallback = createSafeFallback({
    authorizedBy: { subject: "oidc|anna.andersen" },
    actions: ["pause", "read-only"],
    executor: async ({ action }) => { fallbackRuns.push(action); return { ok: true, summary: action }; },
    clock: () => NOW,
  });
  const orch = orchestrator(parts, { pdp: { decide: async () => { throw new Error("PDP utilgængelig"); } }, safeFallback });
  const result = await orch.run(signal());
  assert.equal(result.state, "halted", JSON.stringify(result));
  assert.equal(result.aiChangesStopped, true);
  assert.deepEqual(result.safeFallback.ran, ["pause", "read-only"]);
  assert.deepEqual(fallbackRuns, ["pause", "read-only"]);
  assert.equal(parts.record.length, 0);
});

test("accept 4b: audit-tab under forløbet stopper nye mutationer", async () => {
  const parts = setup();
  parts.auditLog.append = async () => { throw new Error("audit-log utilgængelig"); };
  const orch = orchestrator(parts);
  await assert.rejects(() => orch.run(signal()));
  assert.equal(parts.record.length, 0);
});

/* -------------------------------------------------------------------------- */
/* Accept 5: irreversible verber er ikke generelt reversible                  */
/* -------------------------------------------------------------------------- */
test("accept 5: migrate/restore beskrives som irreversible, ikke reversible", () => {
  for (const verb of ["migrate", "migrate.schema", "restore"]) {
    const r = describeReversibility(verb);
    assert.equal(r.reversible, false, `${verb} må ikke være reversibel`);
    assert.equal(r.compensation, null);
    assert.match(r.fallback, /stop-and-escalate/);
  }
  assert.equal(describeReversibility("restart").reversible, true);
  assert.equal(describeReversibility("restart").compensation, "restart");
});

/* -------------------------------------------------------------------------- */
/* Accept 6: modeludfald stopper AI-ændringer; fallback fortsætter            */
/* -------------------------------------------------------------------------- */
test("accept 6: modeludfald stopper AI-ændringer og kører sikker fallback", async () => {
  const parts = setup();
  const fallbackRuns = [];
  const safeFallback = createSafeFallback({
    authorizedBy: { subject: "oidc|anna.andersen" },
    actions: ["pause"],
    executor: async ({ action }) => { fallbackRuns.push(action); return { ok: true }; },
    clock: () => NOW,
  });
  const orch = orchestrator(parts, { diagnose: async () => { throw new Error("model gateway timeout"); }, safeFallback });
  const result = await orch.run(signal());
  assert.equal(result.state, "halted", JSON.stringify(result));
  assert.equal(result.aiChangesStopped, true);
  assert.deepEqual(result.safeFallback.ran, ["pause"]);
  assert.deepEqual(fallbackRuns, ["pause"]);
  assert.equal(parts.record.length, 0);
});

/* -------------------------------------------------------------------------- */
/* Øvrige leverancer                                                          */
/* -------------------------------------------------------------------------- */
test("kun de to initiale runbooks er aktiveret uden særskilt evidens", async () => {
  const parts = setup();
  const orch = orchestrator(parts);
  const result = await orch.run(signal({ runbookRef: "unknown-runbook@1.0.0" }));
  assert.equal(result.state, "escalated");
  assert.match(result.reason, /særskilt evidens|ukendt runbook/);
});

test("budgettet deles på tværs af agenter og stopper gentagelser", () => {
  const budget = createRemediationBudget({ clock: () => NOW, config: { maxAttempts: 2, maxFailures: 1, maxChanges: 1, windowSeconds: 3600 } });
  assert.equal(budget.consume({ resource: "service/checkout", kind: "attempt", by: "agent-a" }).ok, true);
  assert.equal(budget.consume({ resource: "service/checkout", kind: "failure", by: "agent-a" }).ok, true);
  const check = budget.canStart({ resource: "service/checkout" });
  assert.equal(check.ok, false);
  assert.ok(check.reasons.some((r) => /fejl-budgettet/.test(r)));
  // En anden agent rammes af samme budget.
  const other = budget.consume({ resource: "service/checkout", kind: "attempt", by: "agent-b" });
  assert.equal(other.ok, false);
});

test("observeHealth stopper ved forværring inden for observationsvinduet", () => {
  const good = observeHealth({ check: "user-flow", target: "service/checkout", samples: [0.99, 1.0, 0.98], baseline: 1, tolerance: 0.05 });
  assert.equal(good.healthy, true);
  const bad = observeHealth({ check: "user-flow", target: "service/checkout", samples: [0.99, 0.4], baseline: 1, tolerance: 0.05 });
  assert.equal(bad.healthy, false);
  assert.equal(bad.degraded, true);
});

test("rolleadskillelse afvises når planlægger og eksekverer er samme identitet", () => {
  const planner = { spiffeId: "spiffe://x/planner", role: "planner" };
  const verifier = { spiffeId: "spiffe://x/verifier", role: "verifier" };
  const bad = assertRoleSeparation({ planner, executor: planner, verifier });
  assert.equal(bad.ok, false);
  const good = assertRoleSeparation({ planner, executor: { spiffeId: "spiffe://x/executor", role: "executor" }, verifier });
  assert.equal(good.ok, true);
});

test("en filbaseret lease giver gensidig udelukkelse", async () => {
  const { createFileLeaseStore } = await import("../src/remediation.mjs");
  const dir = mkdtempSync(join(tmpdir(), "dkc046-lease-"));
  const store = createFileLeaseStore({ dir });
  const lease = createResourceLease({ store, clock: () => NOW });
  const a = lease.acquire({ resource: "service/checkout", owner: "agent-a", at: NOW });
  assert.equal(a.ok, true);
  const b = lease.acquire({ resource: "service/checkout", owner: "agent-b", at: NOW });
  assert.equal(b.ok, false);
});
