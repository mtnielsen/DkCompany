/**
 * DKC-055 — scheduleren router uden adgang til alle agenters credentials.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createAgentRegistry } from "../src/registry.mjs";
import { createScheduler } from "../src/scheduler.mjs";
import { manifestFor, humanAdmin } from "../fixtures/manifests.mjs";

test("scheduleren udsteder kun den valgte agents credential", () => {
  const registry = createAgentRegistry();
  registry.register({ principal: humanAdmin(), manifest: manifestFor("executor", { name: "exec-a", spiffeId: "spiffe://platform.example.org/agents/exec-a" }) });
  registry.register({ principal: humanAdmin(), manifest: manifestFor("executor", { name: "exec-b", spiffeId: "spiffe://platform.example.org/agents/exec-b" }) });
  const scheduler = createScheduler({ registry });
  const dispatched = scheduler.dispatch({ taskId: "t1", role: "executor" });
  assert.equal(dispatched.agent.role, "executor");
  assert.equal(dispatched.credential.spiffeId, dispatched.agent.spiffeId);
  // Scheduleren kan bevidst ikke samle alle credentials.
  assert.throws(() => scheduler.allCredentials(), (e) => e.code === "all_credentials_forbidden");
});

test("scheduleren afviser en opgave uden aktiv agent i rollen", () => {
  const registry = createAgentRegistry();
  const scheduler = createScheduler({ registry });
  assert.throws(() => scheduler.dispatch({ taskId: "t1", role: "executor" }), (e) => e.code === "no_agent");
});

test("scheduleren ruter til forskellige roller uden at blande dem", () => {
  const registry = createAgentRegistry();
  registry.register({ principal: humanAdmin(), manifest: manifestFor("planner") });
  registry.register({ principal: humanAdmin(), manifest: manifestFor("executor") });
  const scheduler = createScheduler({ registry });
  const planner = scheduler.dispatch({ taskId: "t1", role: "planner" });
  const executor = scheduler.dispatch({ taskId: "t2", role: "executor" });
  assert.equal(planner.credential.role, "planner");
  assert.equal(executor.credential.role, "executor");
  assert.ok(!planner.credential.allowedVerbs.includes("upgrade.patch"));
  assert.ok(executor.credential.allowedVerbs.includes("upgrade.patch"));
});
