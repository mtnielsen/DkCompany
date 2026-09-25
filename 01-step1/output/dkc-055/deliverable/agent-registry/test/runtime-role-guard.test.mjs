/**
 * DKC-055 — rollegrænsen ved runtime og den rigtige runtime-integration.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { guardIndependentVerification, guardRoleAction } from "../src/runtime-role-guard.mjs";
import { createAgentRuntime } from "../../runtime/src/runtime.mjs";
import { createMemoryAuditLog } from "../../runtime/src/clients.mjs";
import { validDecision } from "../../runtime/test/pdp-fixtures.mjs";
import { manifestFor } from "../fixtures/manifests.mjs";

const baseManifest = JSON.parse(readFileSync(new URL("../../modules/dummy-ok/agents/backup-agent.json", import.meta.url), "utf8"));

test("planner kan ikke eksekvere, executor kan ikke planlægge", () => {
  const planner = guardRoleAction({ manifest: { role: "planner" }, action: { verb: "upgrade.patch", target: "dummy-ok" } });
  assert.equal(planner.ok, false);
  const propose = guardRoleAction({ manifest: { role: "executor" }, action: { verb: "propose", target: "dummy-ok" } });
  assert.equal(propose.ok, false);
  const executor = guardRoleAction({ manifest: { role: "executor" }, action: { verb: "upgrade.patch", target: "dummy-ok" } });
  assert.equal(executor.ok, true);
});

test("implementer kan ikke ændre godkendt scope eller godkende", () => {
  const scope = guardRoleAction({ manifest: { role: "implementer" }, action: { verb: "propose", target: "dummy-ok", scopeChange: true }, approvedScope: { targets: ["dummy-ok"] } });
  assert.equal(scope.ok, false);
  assert.ok(scope.errors.some((e) => /godkendte scope/.test(e.message)));
  const approve = guardRoleAction({ manifest: { role: "implementer" }, action: { verb: "propose", target: "dummy-ok", approves: true } });
  assert.equal(approve.ok, false);
  assert.ok(approve.errors.some((e) => /kan ikke godkende/.test(e.message)));
});

test("kun verifier må producere et verifier-resultat", () => {
  assert.equal(guardRoleAction({ manifest: { role: "implementer" }, action: { verb: "verify-restore", target: "dummy-ok", produces: "verification" } }).ok, false);
  assert.equal(guardRoleAction({ manifest: { role: "verifier" }, action: { verb: "verify-restore", target: "dummy-ok", produces: "verification" } }).ok, true);
});

test("executor må ikke generere ny plan eller kode ved fejl", () => {
  const result = guardRoleAction({ manifest: { role: "executor" }, action: { verb: "restart", target: "dummy-ok", onFailure: "propose" } });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /ny plan eller kode/.test(e.message)));
});

test("uafhængig verifikation afviser samme identitet, rolle eller model", () => {
  assert.equal(guardIndependentVerification({ producer: { spiffeId: "a", role: "implementer", modelRef: "anthropic/m" }, verifier: { spiffeId: "b", role: "verifier", modelRef: "openai/m" } }).ok, true);
  assert.equal(guardIndependentVerification({ producer: { spiffeId: "a", role: "implementer", modelRef: "anthropic/m" }, verifier: { spiffeId: "a", role: "verifier", modelRef: "openai/m" } }).ok, false);
  assert.equal(guardIndependentVerification({ producer: { spiffeId: "a", role: "implementer", modelRef: "anthropic/m" }, verifier: { spiffeId: "b", role: "implementer", modelRef: "openai/m" } }).ok, false);
  assert.equal(guardIndependentVerification({ producer: { spiffeId: "a", role: "implementer", modelRef: "anthropic/m" }, verifier: { spiffeId: "b", role: "verifier", modelRef: "anthropic/m" } }).ok, false);
});

function taskFor(actions) {
  return {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "AgentTask",
    taskId: "task-role-1",
    tenantId: "acme",
    agentRef: "test-planner",
    objective: "rolletest",
    actions,
  };
}

test("runtimen afviser en executor-handling fra en planner-agent", async () => {
  const record = [];
  const manifest = manifestFor("planner", {
    name: "test-planner",
    capabilities: [{ verb: "observe.read", target: "dummy-ok", autonomyClass: "A0" }],
  });
  const runtime = createAgentRuntime({
    manifest,
    pdp: { decide: async (input) => validDecision(input, { requiredEvidence: ["policy-allow"] }) },
    auditLog: createMemoryAuditLog(),
    executors: { "observe.read": async () => (record.push("observe.read"), { summary: "ok" }), "upgrade.patch": async () => (record.push("upgrade.patch"), { summary: "patched" }) },
    clock: () => Date.parse("2025-09-02T00:00:00Z"),
  });
  const result = await runtime.runTask(taskFor([{ verb: "upgrade.patch", target: "dummy-ok", environment: "staging" }]));
  assert.equal(result.status, "refused");
  assert.deepEqual(record, [], "planner-agenten må ikke eksekvere");
  assert.match(result.reason, /ikke deklareret|rolle/i);
});

test("runtimens manifest afviser et verbum uden for rollen", () => {
  const manifest = manifestFor("planner", { capabilities: [{ verb: "upgrade.patch", target: "dummy-ok", autonomyClass: "A3" }] });
  assert.throws(() => createAgentRuntime({ manifest, pdp: { decide: async () => ({}) }, auditLog: createMemoryAuditLog() }), /manifest/i);
});

test("base-manifestet har rollen executor og kan konstruere runtimen", () => {
  assert.equal(baseManifest.role, "executor");
  const runtime = createAgentRuntime({ manifest: baseManifest, pdp: { decide: async (input) => validDecision(input, { requiredEvidence: ["policy-allow"] }) }, auditLog: createMemoryAuditLog() });
  assert.ok(runtime);
});
