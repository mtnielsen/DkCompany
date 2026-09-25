import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createAgentRuntime } from "../src/runtime.mjs";
import { createMemoryAuditLog, GovernanceUnavailable } from "../src/clients.mjs";

const manifest = JSON.parse(readFileSync(new URL("../../modules/dummy-ok/agents/backup-agent.json", import.meta.url), "utf8"));

const task = (actions) => ({ apiVersion: "contracts.platform/v1alpha1", kind: "AgentTask", taskId: randomUUID(), tenantId: "acme", agentRef: manifest.metadata.name, objective: "test", actions });
const action = (verb, extra = {}) => ({ verb, target: extra.target ?? "dummy-ok", environment: "staging", ...extra });

const allowPdp = (requiredEvidence = ["policy-allow"]) => ({ decide: async () => ({ decision: "allow", requiredEvidence }) });
const approvalPdp = (n) => ({ decide: async () => ({ decision: "allow-with-approval", requiredApprovals: n, requiredEvidence: ["policy-allow"] }) });
const downPdp = { decide: async () => { const e = new Error("PDP utilgængelig: timeout"); e.name = "GovernanceUnavailable"; throw e; } };

function executors(record = []) {
  return {
    "observe.read": async () => { record.push("observe.read"); return { summary: "read" }; },
    "upgrade.dry-run": async () => { record.push("upgrade.dry-run"); return { summary: "clean", tokens: 5, costEur: 0.001 }; },
    "upgrade.patch": async () => { record.push("upgrade.patch"); return { summary: "patched" }; },
  };
}

function makeRuntime({ pdp = allowPdp(), auditLog = createMemoryAuditLog(), executorRecord = [], clock, credentialIssuer, approvalVerifier } = {}) {
  return createAgentRuntime({ manifest, pdp, auditLog, executors: executors(executorRecord), ...(clock ? { clock } : {}), ...(credentialIssuer ? { credentialIssuer } : {}), ...(approvalVerifier ? { approvalVerifier } : {}) });
}

test("A1-verbum udføres end-to-end med audit-spor", async () => {
  const record = [];
  const auditLog = createMemoryAuditLog();
  const runtime = makeRuntime({ pdp: allowPdp(["policy-allow"]), auditLog, executorRecord: record });
  const result = await runtime.runTask(task([action("upgrade.dry-run", { evidence: ["tests-pass"] })]));
  assert.equal(result.status, "completed");
  assert.equal(result.actionsRun, 1);
  assert.deepEqual(record, ["upgrade.dry-run"]);
  assert.equal(result.tokensUsed, 5);
  const types = auditLog.events.map((e) => e.type);
  assert.deepEqual(types, ["agent.task.started", "agent.action.completed", "agent.task.completed"]);
  assert.ok(result.credentialId, "der skal være udstedt et JIT-credential");
});

test("udeklareret verbum afvises — ingen fri shell", async () => {
  const record = [];
  const runtime = makeRuntime({ executorRecord: record });
  const result = await runtime.runTask(task([action("shell.exec", { command: "rm -rf /" })]));
  assert.equal(result.status, "refused");
  assert.match(result.reason, /ikke deklareret/);
  assert.equal(record.length, 0);
});

test("mister PDP → stopper (dødemandsgreb)", async () => {
  const record = [];
  const runtime = makeRuntime({ pdp: downPdp, executorRecord: record });
  const result = await runtime.runTask(task([action("upgrade.dry-run", { evidence: ["tests-pass"] })]));
  assert.equal(result.status, "halted");
  assert.match(result.reason, /governance utilgængelig/);
  assert.equal(record.length, 0, "intet må udføres uden governance");
});

test("mister audit-log → stopper før nogen handling", async () => {
  const record = [];
  const runtime = makeRuntime({ auditLog: createMemoryAuditLog({ fail: true }), executorRecord: record });
  const result = await runtime.runTask(task([action("upgrade.dry-run", { evidence: ["tests-pass"] })]));
  assert.equal(result.status, "halted");
  assert.match(result.reason, /audit-log utilgængelig/);
  assert.equal(record.length, 0);
});

test("A3 kræver menneske: uden godkendelse eskalerer den", async () => {
  const record = [];
  const runtime = makeRuntime({ pdp: approvalPdp(2), executorRecord: record });
  const result = await runtime.runTask(task([action("upgrade.patch", { evidence: ["tests-pass"] })]));
  assert.equal(result.status, "escalated");
  assert.equal(result.requiredApprovals, 2);
  assert.equal(record.length, 0);
});

test("A3 med serververificeret godkendelse udføres", async () => {
  const record = [];
  const approvalVerifier = { authorizeExecution: async () => ({ ok: true, approvalId: "appr-1", bindingDigest: "x" }) };
  const runtime = makeRuntime({ pdp: approvalPdp(2), executorRecord: record, approvalVerifier });
  const result = await runtime.runTask(
    task([
      action("upgrade.patch", {
        evidence: ["tests-pass", "dry-run-clean", "rollback-tested"],
        approvalId: "appr-1",
        changeDigest: "3".repeat(64),
      }),
    ])
  );
  assert.equal(result.status, "completed");
  assert.deepEqual(record, ["upgrade.patch"]);
});

test("DKC-005 regression: to anonyme approve-objekter udfører nul handlinger", async () => {
  const record = [];
  const runtime = makeRuntime({ pdp: approvalPdp(2), executorRecord: record });
  // Klienten forsøger at forfalske godkendelsen direkte i action'en.
  const approvals = [{ subject: "a", verdict: "approve" }, { subject: "b", verdict: "approve" }];
  const result = await runtime.runTask(
    task([action("upgrade.patch", { evidence: ["tests-pass", "dry-run-clean", "rollback-tested"], approvals })])
  );
  assert.equal(result.status, "escalated");
  assert.deepEqual(record, [], "en klientpåstand om godkendelse må ikke føre til handling");
});

test("budgetoverskridelse eskalerer", async () => {
  const record = [];
  const runtime = makeRuntime({ executorRecord: record });
  const result = await runtime.runTask({ ...task([action("upgrade.dry-run", { evidence: ["tests-pass"] })]), budget: { maxTokens: 3 } });
  assert.equal(result.status, "escalated");
  assert.match(result.reason, /tokens overskredet/);
});

test("loop-detektion eskalerer efter N gentagne fix", async () => {
  const record = [];
  const runtime = makeRuntime({ executorRecord: record });
  const actions = Array.from({ length: 5 }, () => action("upgrade.dry-run", { evidence: ["tests-pass"] }));
  const result = await runtime.runTask(task(actions));
  assert.equal(result.status, "escalated");
  assert.match(result.reason, /loop/);
  // repeatFailureLimit er 3, så 4. gentagelse eskalerer — kun 3 udføres.
  assert.equal(record.length, 3);
});

test("A4: agenten må ikke ændre policy (selv med bredt scope)", async () => {
  const record = [];
  const broadManifest = structuredClone(manifest);
  broadManifest.capabilities.push({ verb: "upgrade.patch", target: "policy", autonomyClass: "A3", requiredEvidence: ["policy-allow"] });
  const runtime = createAgentRuntime({ manifest: broadManifest, pdp: allowPdp(), auditLog: createMemoryAuditLog(), executors: executors(record) });
  const result = await runtime.runTask(task([action("upgrade.patch", { target: "policy/bundles/platform" })]));
  assert.equal(result.status, "refused");
  assert.match(result.reason, /A4/);
  assert.equal(record.length, 0);
});

test("udløbet JIT-credential stopper videre handling", async () => {
  let now = 1_000_000;
  const runtime = makeRuntime({
    clock: () => now,
    credentialIssuer: () => ({ id: "cred-1", ttlSeconds: 1, issuedAt: now, expiresAt: now + 1000 }),
  });
  const first = await runtime.runTask(task([action("observe.read", { evidence: ["policy-allow"] })]));
  assert.equal(first.status, "completed");

  // Ny task hvor uret rykker mellem handling 1 og 2.
  const record = [];
  const timedExecutors = executors(record);
  const timed = createAgentRuntime({
    manifest,
    pdp: allowPdp(),
    auditLog: createMemoryAuditLog(),
    executors: {
      ...timedExecutors,
      "observe.read": async () => { record.push("observe.read"); now += 5000; return { summary: "read" }; },
    },
    clock: () => now,
    credentialIssuer: () => ({ id: "cred-2", ttlSeconds: 1, issuedAt: now, expiresAt: now + 1000 }),
  });
  const result = await timed.runTask(task([action("observe.read", { evidence: ["policy-allow"] }), action("observe.read", { evidence: ["policy-allow"] })]));
  assert.equal(result.status, "halted");
  assert.match(result.reason, /credential udløbet/);
  assert.equal(record.length, 1);
});
