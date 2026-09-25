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

test("en almindelig post uden beskyttelse passerer uændret (kontrol)", async () => {
  const calls = [];
  const runtime = makeRuntime({ protectedData: guardFor([record({ dataClass: "ordinary", noAiAccess: false })]), record: calls });
  const result = await runtime.runTask(task([action("observe.read")]));
  assert.equal(result.status, "completed");
  assert.deepEqual(calls, ["observe.read"]);
});
