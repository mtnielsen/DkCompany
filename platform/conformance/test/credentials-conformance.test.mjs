/**
 * DKC-010 — konformanstest for kortlivede rettigheder og nødstop.
 *
 * Spejler de fire acceptkriterier i conformance-suiten, så `make test` dækker
 * dem sammen med credentials-modulet, runtimen og audit-servicen:
 *
 *   1. credential virker kun hos tilsigtet executor og til det tilladte scope,
 *   2. udløb og tilbagekaldelse afviser efterfølgende handlinger hos modtageren,
 *   3. nødstop afviser nye handlinger inden fem sekunder i staging,
 *   4. agenten kan ikke ændre sit eget manifest, deployment eller kontroltjenesters adgang.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createLocalSigner, signersToJwks } from "../../credentials/src/keys.mjs";
import { createCredentialBroker } from "../../credentials/src/broker.mjs";
import { createCredentialVerifier } from "../../credentials/src/verifier.mjs";
import { createExecutorGuard, CredentialRejected } from "../../credentials/src/receiver.mjs";
import { createRevocationList } from "../../credentials/src/revocation.mjs";
import { createKillSwitch } from "../../credentials/src/kill-switch.mjs";
import { createAgentRuntime } from "../../runtime/src/runtime.mjs";
import { createMemoryAuditLog } from "../../runtime/src/clients.mjs";
import { runVerify } from "../../gitops/src/verify.mjs";
import { evidenceFixture } from "../../runtime/test/evidence-fixtures.mjs";
import { validDecision } from "../../runtime/test/pdp-fixtures.mjs";

const HUMAN = { kind: "human", id: "oidc|security-officer", roles: ["security-officer"] };
const manifest = JSON.parse(readFileSync(new URL("../../modules/dummy-ok/agents/backup-agent.json", import.meta.url), "utf8"));
const EVIDENCE = evidenceFixture(["tests-pass", "dry-run-clean", "rollback-tested", "restore-verified", "scan-clean"]);
const AUDIENCE = "module:dummy-ok";
const allowPdp = () => ({ decide: async (input) => validDecision(input, { requiredEvidence: ["policy-allow"] }) });

function credentials() {
  let now = 1_700_000_000_000;
  const clock = () => now;
  const signer = createLocalSigner({ kid: "conf-1" });
  const revocations = createRevocationList({ clock });
  const killSwitch = createKillSwitch({ clock, cacheTtlMs: 500 });
  const broker = createCredentialBroker({ signer, clock, revocations, killSwitch, maxTtlSeconds: 900 });
  const verifier = createCredentialVerifier({ jwks: signersToJwks([signer]), clock, revocations, killSwitch, issuer: broker.issuer });
  return { clock, advance: (ms) => { now += ms; }, broker, verifier, revocations, killSwitch, guard: createExecutorGuard({ verifier, audience: AUDIENCE }) };
}
const base = { spiffeId: manifest.identity.spiffeId, agentRef: manifest.metadata.name, role: "executor", tenantId: "acme", verb: "upgrade.dry-run", resource: "dummy-ok", audience: AUDIENCE, environment: "staging" };
const expect = { audience: AUDIENCE, verb: "upgrade.dry-run", resource: "dummy-ok", tenantId: "acme", environment: "staging" };

test("credential virker kun hos tilsigtet executor og til det tilladte scope", async () => {
  const creds = credentials();
  const { token } = creds.broker.issue(base);
  assert.equal(creds.verifier.verify(token, expect).ok, true);
  assert.equal(creds.verifier.verify(token, { ...expect, audience: "module:other" }).ok, false);
  assert.equal(creds.verifier.verify(token, { ...expect, verb: "restart" }).ok, false);
  assert.equal(creds.verifier.verify(token, { ...expect, resource: "other" }).ok, false);
  assert.throws(() => creds.broker.issue({ ...base, resource: "credentials/keys" }), /A4-beskyttet/);

  const executed = [];
  const executor = creds.guard.guard(async () => { executed.push("ran"); return {}; });
  await executor({ verb: "upgrade.dry-run", target: "dummy-ok", tenantId: "acme", environment: "staging", credential: { token } });
  await assert.rejects(() => executor({ verb: "upgrade.dry-run", target: "dummy-ok", tenantId: "acme", environment: "staging", credential: { token: creds.broker.issue({ ...base, audience: "module:other" }).token } }), CredentialRejected);
  assert.deepEqual(executed, ["ran"]);
});

test("udløb og tilbagekaldelse afviser efterfølgende handlinger hos modtageren", () => {
  const creds = credentials();
  const expired = creds.broker.issue({ ...base, ttlSeconds: 5 });
  creds.advance(20_000);
  assert.equal(creds.verifier.verify(expired.token, expect).ok, false);

  const revoked = creds.broker.issue(base);
  creds.revocations.revoke({ jti: revoked.jti, reason: "test", revokedBy: "oidc|sec" });
  const check = creds.verifier.verify(revoked.token, expect);
  assert.equal(check.ok, false);
  assert.match(check.reasons.join(" "), /tilbagekaldt/);
});

test("nødstop afviser nye handlinger inden fem sekunder i staging", async () => {
  const creds = credentials();
  creds.killSwitch.activate({ scope: "global", reason: "incident", principal: HUMAN });
  const runtime = createAgentRuntime({
    manifest,
    pdp: allowPdp(),
    auditLog: createMemoryAuditLog(),
    credentialBroker: creds.broker,
    killSwitch: creds.killSwitch,
    clock: creds.clock,
    executors: creds.guard.guardAll({ "upgrade.dry-run": async () => { throw new Error("må ikke kaldes"); } }),
  });
  const task = { apiVersion: "contracts.platform/v1alpha1", kind: "AgentTask", taskId: randomUUID(), tenantId: "acme", agentRef: manifest.metadata.name, objective: "conf", evidenceIndex: EVIDENCE.index, actions: [{ verb: "upgrade.dry-run", target: "dummy-ok", environment: "staging", evidence: ["tests-pass"], idempotencyId: "conf-stop" }] };
  const started = Date.now();
  const result = await runtime.runTask(task);
  const elapsed = Date.now() - started;
  assert.equal(result.status, "halted");
  assert.equal(result.emergencyStop, true);
  assert.ok(elapsed < 5000, `nødstoppet tog ${elapsed} ms`);
  assert.ok(creds.killSwitch.maxPropagationMs <= 5000);
});

test("agenten kan ikke ændre sit eget manifest, deployment eller kontroltjenesters adgang", async () => {
  const creds = credentials();
  // GitOps-gaten: en agent-ServiceAccount må ikke have RBAC mod kontrolplanet (i det rigtige repo).
  const report = runVerify(undefined, { excludeModules: ["dummy-broken"] });
  const g009 = report.checks.find((c) => c.id === "G-009");
  assert.equal(g009.status, "pass");

  // Runtimen afviser A4-handlinger mod egen registrering, deployment og kontroltjenester.
  const broad = structuredClone(manifest);
  for (const target of ["policy", "audit", "credentials", "agent-registry", "gitops"]) broad.capabilities.push({ verb: "upgrade.patch", target, autonomyClass: "A3", requiredEvidence: ["policy-allow"] });
  const runtime = createAgentRuntime({ manifest: broad, pdp: allowPdp(), auditLog: createMemoryAuditLog(), credentialBroker: creds.broker, killSwitch: creds.killSwitch, clock: creds.clock, executors: creds.guard.guardAll({ "upgrade.patch": async () => { throw new Error("må ikke kaldes"); } }) });
  for (const target of ["policy/bundles", "audit/log", "credentials/keys", "agent-registry/agents", "gitops/manifests"]) {
    const task = { apiVersion: "contracts.platform/v1alpha1", kind: "AgentTask", taskId: randomUUID(), tenantId: "acme", agentRef: manifest.metadata.name, objective: "conf", evidenceIndex: EVIDENCE.index, actions: [{ verb: "upgrade.patch", target, environment: "staging", evidence: ["tests-pass", "dry-run-clean", "rollback-tested"], idempotencyId: `conf-${target}` }] };
    const result = await runtime.runTask(task);
    assert.equal(result.status, "refused");
    assert.match(result.reason, /A4/);
  }
});
