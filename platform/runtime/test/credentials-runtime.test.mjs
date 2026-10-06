/**
 * DKC-010 — runtime udsteder kortlivede, scope-bundne rettigheder og håndhæver
 * nødstop. Executoren (modtageren) verificerer credentialet.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createAgentRuntime } from "../src/runtime.mjs";
import { createMemoryAuditLog } from "../src/clients.mjs";
import { createLocalSigner, signersToJwks } from "../../credentials/src/keys.mjs";
import { createCredentialBroker } from "../../credentials/src/broker.mjs";
import { createCredentialVerifier } from "../../credentials/src/verifier.mjs";
import { createExecutorGuard, CredentialRejected } from "../../credentials/src/receiver.mjs";
import { createKillSwitch } from "../../credentials/src/kill-switch.mjs";
import { createRevocationList } from "../../credentials/src/revocation.mjs";
import { evidenceFixture } from "./evidence-fixtures.mjs";
import { validDecision } from "./pdp-fixtures.mjs";

const manifest = JSON.parse(readFileSync(new URL("../../modules/dummy-ok/agents/backup-agent.json", import.meta.url), "utf8"));
const EVIDENCE = evidenceFixture(["tests-pass", "dry-run-clean", "rollback-tested", "restore-verified", "scan-clean"]);
const AUDIENCE = "module:dummy-ok";
const HUMAN = { kind: "human", id: "oidc|security-officer", roles: ["security-officer"] };

const task = (actions, extra = {}) => ({ apiVersion: "contracts.platform/v1alpha1", kind: "AgentTask", taskId: randomUUID(), tenantId: "acme", agentRef: manifest.metadata.name, objective: "test", evidenceIndex: EVIDENCE.index, actions, ...extra });
const action = (verb, extra = {}) => ({ verb, target: extra.target ?? "dummy-ok", environment: "staging", ...extra });
const allowPdp = () => ({ decide: async (input) => validDecision(input, { requiredEvidence: ["policy-allow"] }) });

function credentials({ audience = AUDIENCE } = {}) {
  let now = 1_700_000_000_000;
  const clock = () => now;
  const signer = createLocalSigner({ kid: "rt-1" });
  const revocations = createRevocationList({ clock });
  const killSwitch = createKillSwitch({ clock, cacheTtlMs: 500 });
  const broker = createCredentialBroker({ signer, clock, revocations, killSwitch, maxTtlSeconds: 900 });
  const verifier = createCredentialVerifier({ jwks: signersToJwks([signer]), clock, revocations, killSwitch, issuer: broker.issuer });
  const guard = createExecutorGuard({ verifier, audience });
  return { clock, advance: (ms) => { now += ms; }, broker, verifier, revocations, killSwitch, guard };
}

function makeRuntime({ creds, record = [], executors = null, killSwitch = creds.killSwitch, credentialBroker = creds.broker, ttl = null } = {}) {
  const base = executors ?? {
    "observe.read": async () => { record.push("observe.read"); return { summary: "read" }; },
    "upgrade.dry-run": async () => { record.push("upgrade.dry-run"); return { summary: "clean" }; },
    "upgrade.patch": async () => { record.push("upgrade.patch"); return { summary: "patched" }; },
  };
  return createAgentRuntime({
    manifest,
    pdp: allowPdp(),
    auditLog: createMemoryAuditLog(),
    credentialBroker,
    killSwitch,
    credentialTtlSeconds: ttl,
    clock: creds.clock,
    executors: creds.guard.guardAll(base),
  });
}

test("runtimen udsteder et scope-bundet credential som modtageren verificerer", async () => {
  const record = [];
  const creds = credentials();
  let seen = null;
  const executors = {
    "upgrade.dry-run": async (input) => {
      seen = input.credential;
      record.push(input.verb);
      return { summary: "clean" };
    },
  };
  const runtime = makeRuntime({ creds, record, executors });
  const result = await runtime.runTask(task([action("upgrade.dry-run", { idempotencyId: "c1", evidence: ["tests-pass"] })]));
  assert.equal(result.status, "completed");
  assert.deepEqual(record, ["upgrade.dry-run"]);
  assert.ok(seen?.token, "executoren skal modtage et signeret token");
  assert.deepEqual(seen.claims.aud, [AUDIENCE]);
  assert.equal(seen.claims.tenant_id, "acme");
  assert.equal(seen.claims.scope.verb, "upgrade.dry-run");
  assert.equal(seen.claims.scope.resource, "dummy-ok");
  assert.ok(seen.claims.exp > seen.claims.iat);
  assert.equal(creds.verifier.verify(seen.token, { audience: AUDIENCE, verb: "upgrade.dry-run", resource: "dummy-ok", tenantId: "acme", environment: "staging" }).ok, true);
});

test("credential til en anden executor afvises hos modtageren", async () => {
  const record = [];
  const creds = credentials();
  // Kapabilitetens executor peger på en anden tjeneste end den der faktisk lytter.
  const other = structuredClone(manifest);
  other.capabilities.find((c) => c.verb === "upgrade.dry-run").executor = "module:other";
  const runtime = createAgentRuntime({
    manifest: other,
    pdp: allowPdp(),
    auditLog: createMemoryAuditLog(),
    credentialBroker: creds.broker,
    killSwitch: creds.killSwitch,
    clock: creds.clock,
    executors: creds.guard.guardAll({ "upgrade.dry-run": async () => { record.push("ran"); return { summary: "x" }; } }),
  });
  const result = await runtime.runTask(task([action("upgrade.dry-run", { idempotencyId: "c2", evidence: ["tests-pass"] })]));
  assert.equal(result.status, "escalated");
  assert.match(result.reason, /credential afvist/);
  assert.deepEqual(record, [], "et token til en anden executor må ikke udføre handlingen");
});

test("udløbet credential afvises i runtimen før executor", async () => {
  const record = [];
  const creds = credentials();
  const runtime = makeRuntime({ creds, record, ttl: 5 });
  // Uret rykker 10 s mellem udstedelse og brug.
  const original = creds.broker.issue.bind(creds.broker);
  creds.broker.issue = (opts) => {
    const issued = original(opts);
    creds.advance(10_000);
    return issued;
  };
  const result = await runtime.runTask(task([action("upgrade.dry-run", { idempotencyId: "c3", evidence: ["tests-pass"] })]));
  assert.equal(result.status, "halted");
  assert.match(result.reason, /credential udløbet/);
  assert.deepEqual(record, []);
});

test("tilbagekaldt credential afvises hos modtageren", async () => {
  const record = [];
  const creds = credentials();
  const base = { "upgrade.dry-run": async () => { record.push("ran"); return { summary: "x" }; } };
  // Tilbagekald agentens credentials, så snart de udstedes.
  const original = creds.broker.issue.bind(creds.broker);
  creds.broker.issue = (opts) => {
    const issued = original(opts);
    creds.revocations.revoke({ jti: issued.jti, reason: "test", revokedBy: "oidc|sec" });
    return issued;
  };
  const runtime = makeRuntime({ creds, record, executors: base, ttl: 900 });
  const result = await runtime.runTask(task([action("upgrade.dry-run", { idempotencyId: "c4", evidence: ["tests-pass"] })]));
  assert.equal(result.status, "escalated");
  assert.match(result.reason, /credential afvist/);
  assert.deepEqual(record, []);
});

test("nødstop afviser nye handlinger inden fem sekunder i staging", async () => {
  const record = [];
  const creds = credentials();
  const runtime = makeRuntime({ creds, record });
  // Aktivér et globalt nødstop som security-officer.
  creds.killSwitch.activate({ scope: "global", reason: "incident", principal: HUMAN });
  const started = Date.now();
  const result = await runtime.runTask(task([action("upgrade.dry-run", { idempotencyId: "c5", evidence: ["tests-pass"] })]));
  const elapsed = Date.now() - started;
  assert.equal(result.status, "halted");
  assert.equal(result.emergencyStop, true);
  assert.deepEqual(record, [], "nødstoppet skal afvise før executor");
  assert.ok(elapsed < 5000, `nødstoppet skulle slå igennem med det samme (tog ${elapsed} ms)`);
  assert.ok(creds.killSwitch.maxPropagationMs <= 5000, "propagationsgrænsen skal være ≤ 5 s");
});

test("nødstop pr. kunde rammer kun den kunde", async () => {
  const creds = credentials();
  creds.killSwitch.activate({ scope: "tenant", subjectId: "acme", reason: "kundeincident", principal: HUMAN });
  const acme = makeRuntime({ creds, record: [] });
  const result = await acme.runTask(task([action("upgrade.dry-run", { idempotencyId: "c6", evidence: ["tests-pass"] })]));
  assert.equal(result.status, "halted");
  assert.equal(result.emergencyStop, true);

  const otherCrew = credentials();
  otherCrew.killSwitch.activate({ scope: "tenant", subjectId: "acme", reason: "kundeincident", principal: HUMAN });
  const globexTask = { ...task([action("upgrade.dry-run", { idempotencyId: "c7", evidence: ["tests-pass"] })]), tenantId: "globex" };
  const globex = makeRuntime({ creds: otherCrew, record: [] });
  const other = await globex.runTask(globexTask);
  assert.equal(other.status, "completed", "en anden kundes nødstop må ikke ramme globex");
});

test("agenten kan ikke ændre policy, audit, egne rettigheder eller sit eget manifest", async () => {
  const record = [];
  const creds = credentials();
  // Giv agenten et bredt scope, så det kun er A4-klassifikationen der stopper den.
  const broad = structuredClone(manifest);
  for (const target of ["policy", "audit", "credentials", "agent-registry", "gitops"]) {
    broad.capabilities.push({ verb: "upgrade.patch", target, autonomyClass: "A3", requiredEvidence: ["policy-allow"] });
  }
  const runtime = createAgentRuntime({ manifest: broad, pdp: allowPdp(), auditLog: createMemoryAuditLog(), credentialBroker: creds.broker, killSwitch: creds.killSwitch, clock: creds.clock, executors: creds.guard.guardAll({ "upgrade.patch": async () => { record.push("ran"); return {}; } }) });
  for (const target of ["policy/bundles", "audit/log", "credentials/keys", "agent-registry/agents", "gitops/manifests"]) {
    const result = await runtime.runTask(task([action("upgrade.patch", { target, idempotencyId: `a4-${target}`, evidence: ["tests-pass", "dry-run-clean", "rollback-tested"] })]));
    assert.equal(result.status, "refused", `${target} skulle afvises`);
    assert.match(result.reason, /A4/);
  }
  assert.deepEqual(record, [], "ingen kontrolplans-handling må udføres");
});
