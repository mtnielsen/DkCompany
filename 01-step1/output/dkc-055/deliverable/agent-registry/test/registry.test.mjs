/**
 * DKC-055 — agentregister: menneskekontrolleret oprettelse, uforanderlig rolle,
 * retire/reprovision og separate credentials.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createAgentRegistry, AgentRegistryError } from "../src/registry.mjs";
import { manifestFor, humanAdmin, humanOwner } from "../fixtures/manifests.mjs";

const agentPrincipal = { kind: "agent", id: "spiffe://platform.example.org/agents/x" };

test("kun et verificeret menneske med platformrolle kan oprette agenter", () => {
  const registry = createAgentRegistry();
  assert.throws(() => registry.register({ principal: agentPrincipal, manifest: manifestFor("planner") }), (e) => e.code === "human_required");
  assert.throws(
    () => registry.register({ principal: { kind: "human", id: "oidc|x", roles: ["viewer"] }, manifest: manifestFor("planner") }),
    (e) => e.code === "authority_required"
  );
  assert.throws(
    () => registry.register({ principal: { kind: "human", id: "oidc|x", roles: ["platform-admin"], demo: true }, manifest: manifestFor("planner") }),
    (e) => e.code === "demo_forbidden"
  );
  const ok = registry.register({ principal: humanOwner(), manifest: manifestFor("planner") });
  assert.equal(ok.role, "planner");
});

test("rollen er uforanderlig pr. agentidentitet", () => {
  const registry = createAgentRegistry();
  registry.register({ principal: humanAdmin(), manifest: manifestFor("planner") });
  assert.throws(
    () => registry.register({ principal: humanAdmin(), manifest: manifestFor("executor", { spiffeId: "spiffe://platform.example.org/agents/test-planner" }) }),
    (e) => e.code === "role_immutable"
  );
  // Samme rolle er idempotent.
  assert.equal(registry.register({ principal: humanAdmin(), manifest: manifestFor("planner") }).role, "planner");
});

test("reprovision kræver en ny identitet og tilbagetrækker den gamle", () => {
  const registry = createAgentRegistry();
  const oldId = "spiffe://platform.example.org/agents/repro-old";
  registry.register({ principal: humanAdmin(), manifest: manifestFor("planner", { spiffeId: oldId, name: "repro-old" }) });
  assert.throws(
    () => registry.reprovision({ principal: humanAdmin(), spiffeId: oldId, manifest: manifestFor("executor", { spiffeId: oldId, name: "repro-old" }) }),
    (e) => e.code === "identity_reuse"
  );
  const fresh = registry.reprovision({
    principal: humanAdmin(),
    spiffeId: oldId,
    manifest: manifestFor("executor", { spiffeId: "spiffe://platform.example.org/agents/repro-new", name: "repro-new" }),
  });
  assert.equal(fresh.role, "executor");
  assert.equal(fresh.previousIdentity, oldId);
  assert.equal(registry.get(oldId).status, "retired");
});

test("en tilbagetrukket agent kan ikke få et nyt credential", () => {
  const registry = createAgentRegistry();
  const a = registry.register({ principal: humanAdmin(), manifest: manifestFor("executor") });
  registry.retire({ principal: humanAdmin(), spiffeId: a.spiffeId, reason: "test" });
  assert.throws(() => registry.issueCredential(a.spiffeId, { taskId: "t1" }), (e) => e.code === "inactive");
});

test("et agentnavn kan ikke genbruges som alias for en anden identitet", () => {
  const registry = createAgentRegistry();
  registry.register({ principal: humanAdmin(), manifest: manifestFor("planner", { name: "alias-agent" }) });
  assert.throws(
    () => registry.register({ principal: humanAdmin(), manifest: manifestFor("planner", { name: "alias-agent", spiffeId: "spiffe://platform.example.org/agents/other" }) }),
    (e) => e.code === "alias_reuse"
  );
});

test("hver agent får separate, rollebundne credentials", () => {
  const registry = createAgentRegistry();
  const planner = registry.register({ principal: humanAdmin(), manifest: manifestFor("planner") });
  const executor = registry.register({ principal: humanAdmin(), manifest: manifestFor("executor") });
  const plannerToken = registry.issueCredential(planner.spiffeId, { taskId: "t1" });
  const executorToken = registry.issueCredential(executor.spiffeId, { taskId: "t2" });
  assert.notEqual(plannerToken.id, executorToken.id);
  assert.deepEqual(plannerToken.allowedVerbs, ["observe.read", "observe.correlate", "diagnose", "health", "slo", "retention.policy", "subject.locate", "propose"]);
  assert.ok(executorToken.allowedVerbs.includes("upgrade.patch"));
  assert.ok(!executorToken.allowedVerbs.includes("propose"));
  // Credentialet er bundet til den ene agent — ikke et delt token.
  assert.equal(plannerToken.spiffeId, planner.spiffeId);
  assert.equal(executorToken.spiffeId, executor.spiffeId);
});

test("en agent kan ikke administrere registret (ingen selvoprettelse/delegation)", () => {
  const registry = createAgentRegistry();
  assert.throws(() => registry.retire({ principal: agentPrincipal, spiffeId: "x" }), (e) => e.code === "human_required");
  assert.throws(() => registry.reprovision({ principal: agentPrincipal, spiffeId: "x", manifest: manifestFor("planner") }), (e) => e.code === "human_required");
});

test("registret afviser et manifest med flere roller", () => {
  const registry = createAgentRegistry();
  const manifest = manifestFor("planner");
  manifest.roles = ["planner", "implementer"];
  assert.throws(() => registry.register({ principal: humanAdmin(), manifest }), (e) => e instanceof AgentRegistryError && e.code === "invalid_manifest");
});
