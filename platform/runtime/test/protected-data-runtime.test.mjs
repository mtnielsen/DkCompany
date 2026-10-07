/**
 * DKC-047 — runtimehåndhævelse af beskyttede dataklasser.
 *
 * Beviser at beskyttelsesguarden er koblet ind i runtimegrænsen FØR PDP og
 * executor: en AI kan ikke ændre en ai-read-only-post, ikke læse en
 * no-AI-access-post, og en restore-adapter kan ikke omgå beskyttelsen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createAgentRuntime } from "../src/runtime.mjs";
import { createMemoryAuditLog } from "../src/clients.mjs";
import { evidenceFixture } from "./evidence-fixtures.mjs";
import { validDecision } from "./pdp-fixtures.mjs";
import { createProtectedDataGuard, loadPolicy } from "../../data-protection/src/registry.mjs";

const manifest = JSON.parse(readFileSync(new URL("../../modules/dummy-ok/agents/backup-agent.json", import.meta.url), "utf8"));
const EVIDENCE = evidenceFixture(["tests-pass", "dry-run-clean", "rollback-tested"]);
const anna = { subject: "oidc|anna.andersen", name: "Anna Andersen", role: "Platform Owner" };

const record = (over = {}) => ({ id: "rec", dataClass: "ai-read-only", noAiAccess: false, reclassifiers: [anna], consumerModules: ["dummy-ok"], ...over });
const guardFor = (records) => createProtectedDataGuard({ register: { records }, policy: loadPolicy() });

const task = (actions) => ({ apiVersion: "contracts.platform/v1alpha1", kind: "AgentTask", taskId: randomUUID(), tenantId: "acme", agentRef: manifest.metadata.name, objective: "test", evidenceIndex: EVIDENCE.index, actions });
const action = (verb, extra = {}) => ({ verb, target: "dummy-ok", environment: "staging", ...extra });

function makeRuntime({ protectedData, record = [] } = {}) {
  const executors = {
    "observe.read": async () => { record.push("observe.read"); return { summary: "read" }; },
    "upgrade.patch": async () => { record.push("upgrade.patch"); return { summary: "patched" }; },
  };
  return createAgentRuntime({
    manifest,
    pdp: { decide: async (input) => validDecision(input, { requiredEvidence: ["policy-allow"] }) },
    auditLog: createMemoryAuditLog(),
    executors,
    protectedData,
  });
}

test("AI kan ikke ændre en ai-read-only-post — guarden stopper før executor", async () => {
  const calls = [];
  const runtime = makeRuntime({ protectedData: guardFor([record()]), record: calls });
  const result = await runtime.runTask(task([action("upgrade.patch")]));
  assert.equal(result.status, "denied");
  assert.match(result.reason, /beskyttet/);
  assert.equal(calls.length, 0, "executor må ikke kaldes");
});

test("AI kan ikke læse en no-AI-access-post, heller ikke retrieval", async () => {
  const calls = [];
  const runtime = makeRuntime({ protectedData: guardFor([record({ dataClass: "retention-locked", noAiAccess: true })]), record: calls });
  const result = await runtime.runTask(task([action("observe.read")]));
  assert.equal(result.status, "denied");
  assert.match(result.reason, /no-AI-access/i);
  assert.equal(calls.length, 0);
});

test("en restore-operation mod en beskyttet post afvises uanset godkendelse", async () => {
  const calls = [];
  const runtime = makeRuntime({ protectedData: guardFor([record()]), record: calls });
  const result = await runtime.runTask(task([action("upgrade.patch", { operation: "restore" })]));
  assert.equal(result.status, "denied");
  assert.equal(calls.length, 0);
});

test("R1: caller metadata cannot lower the trusted no-AI classification", async () => {
  const calls = [];
  const auditLog = createMemoryAuditLog();
  const runtime = createAgentRuntime({
    manifest,
    pdp: { decide: async (input) => validDecision(input, { requiredEvidence: ["policy-allow"] }) },
    auditLog,
    executors: { "observe.read": async (input) => { calls.push(input); return { summary: "read" }; } },
    protectedData: guardFor([record({ dataClass: "retention-locked", noAiAccess: true, secretValue: "must-not-be-logged" })]),
  });
  const result = await runtime.runTask(task([action("observe.read", {
    protectedData: { dataClass: "ordinary", noAiAccess: false, secretValue: "must-not-be-logged" },
    dataClass: "ordinary",
    noAiAccess: false,
  })]));
  assert.equal(result.status, "denied");
  assert.equal(calls.length, 0);
  assert.doesNotMatch(JSON.stringify(auditLog.events), /must-not-be-logged/);
  assert.equal(Object.hasOwn(result, "action"), false, "afvisningssvaret må ikke kopiere payloaden");
});

test("action.operation cannot disguise a registered mutation as a read", async () => {
  const calls = [];
  const runtime = makeRuntime({ protectedData: guardFor([record({ dataClass: "ai-read-only" })]), record: calls });
  const result = await runtime.runTask(task([action("upgrade.patch", { operation: "read" })]));
  assert.equal(result.status, "denied");
  assert.match(result.reason, /update/);
  assert.equal(calls.length, 0);
});

test("tilladte protected-data reads kopieres ikke ind i audit, observer eller journal", async () => {
  const auditLog = createMemoryAuditLog();
  const observed = [];
  const journal = { begin: async (entry) => { observed.push(entry); return { ok: true }; }, complete: async (entry) => { observed.push(entry); return { ok: true }; } };
  const runtime = createAgentRuntime({
    manifest,
    pdp: { decide: async (input) => validDecision(input, { requiredEvidence: ["policy-allow"] }) },
    auditLog,
    logObserver: async (entry) => observed.push(entry),
    actionJournal: journal,
    executors: { "observe.read": async () => ({ summary: "protected-secret-value" }) },
    protectedData: guardFor([record({ dataClass: "ai-read-only", secret: "protected-secret-value" })]),
  });
  const result = await runtime.runTask(task([action("observe.read", { parameters: { query: "protected-secret-value" } })]));
  assert.equal(result.status, "completed");
  assert.doesNotMatch(JSON.stringify(auditLog.events), /protected-secret-value/);
  assert.doesNotMatch(JSON.stringify(observed), /protected-secret-value/);
  assert.equal(observed.find((entry) => entry.request)?.request.parameters, null);
  assert.equal(observed.find((entry) => Object.hasOwn(entry, "result"))?.result, null);
});

test("unknown, cross-tenant and unavailable classifications fail closed", async () => {
  const calls = [];
  for (const protectedData of [
    guardFor([]),
    guardFor([record({ tenantId: "globex" })]),
    { classify: () => ({ status: "classified", record: { id: "dummy-ok", dataClass: "custom-unknown", noAiAccess: false, tenantId: "acme" } }) },
    { classify: () => ({ status: "classified", record: { id: "dummy-ok", dataClass: "ordinary", noAiAccess: false, tenantId: "contoso" } }) },
    { classify: () => ({ status: "classified", record: { id: "other-target", dataClass: "ordinary", noAiAccess: false } }) },
    { classify: () => ({ status: "classified", record: { id: "dummy", dataClass: "ordinary", noAiAccess: false } }) },
    { classify() { throw new Error("registry unavailable"); } },
    undefined,
  ]) {
    const runtime = makeRuntime({ protectedData, record: calls });
    const result = await runtime.runTask(task([action("observe.read")]));
    assert.equal(result.status, "denied");
    assert.match(result.reason, /klassifikation ukendt eller utilgængelig/);
  }
  assert.equal(calls.length, 0);
});

test("en almindelig post uden beskyttelse passerer uændret (kontrol)", async () => {
  const calls = [];
  const runtime = makeRuntime({ protectedData: guardFor([record({ dataClass: "ordinary", noAiAccess: false })]), record: calls });
  const result = await runtime.runTask(task([action("observe.read")]));
  assert.equal(result.status, "completed");
  assert.deepEqual(calls, ["observe.read"]);
});

test("executor modtager ikke callerens operation- eller klassifikationsfelter", async () => {
  const received = [];
  const runtime = createAgentRuntime({
    manifest,
    pdp: { decide: async (input) => validDecision(input, { requiredEvidence: ["policy-allow"] }) },
    auditLog: createMemoryAuditLog(),
    executors: { "observe.read": async (input) => { received.push(input); return { summary: "ordinary" }; } },
    protectedData: guardFor([record({ dataClass: "ordinary", noAiAccess: false })]),
  });
  const result = await runtime.runTask(task([action("observe.read", {
    operation: "read",
    dataClass: "ordinary",
    noAiAccess: false,
    protectedData: { dataClass: "ordinary", noAiAccess: false },
  })]));
  assert.equal(result.status, "completed");
  assert.equal(Object.hasOwn(received[0], "operation"), false);
  assert.equal(Object.hasOwn(received[0], "protectedData"), false);
});
