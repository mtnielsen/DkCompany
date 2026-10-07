import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot, loadEnrollment, loadHostProfile, loadPlatforms, knownHostRunbooks, operationProblems, hostManagementEnabled } from "../src/model.mjs";
import { enrollHost, enableManagement, disableManagement, verifyTrust } from "../src/enrollment.mjs";
import { signOperation, verifyOperationSignature, createHostBroker, canonicalOperation } from "../src/broker.mjs";
import { createHostAdapter, runHostOperation, planHostOperation, EFFECT_CAPABILITIES } from "../src/operations.mjs";
import { guardRecoveryPath, withinMaintenanceWindow, canaryGate, evaluateStopCriteria, mutationGate } from "../src/safety.mjs";
import { guardSecurityDomain, securityDomainProblems, attemptSecurityDomainWrite, loadImmutablePolicy } from "../src/security-domain.mjs";
import { evaluateCapacity } from "../src/capacity.mjs";
import { createCredentialBroker, createLocalSigner, createCredentialVerifier } from "../../credentials/src/index.mjs";
import { createExecutorGuard } from "../../credentials/src/receiver.mjs";

const enrollment = loadEnrollment(repoRoot);
const profile = loadHostProfile(repoRoot);
const platforms = loadPlatforms(repoRoot);
const runbooks = knownHostRunbooks(repoRoot);
const hostKeyring = JSON.parse(readFileSync(join(repoRoot, "host-management/dev-keyring.json"), "utf8"));
const hostSecret = hostKeyring.keys[0].secret;
const exampleOperation = JSON.parse(readFileSync(join(repoRoot, "contracts/examples/host-operation.example.json"), "utf8"));
const allowlist = JSON.parse(readFileSync(join(repoRoot, "host-management/package-allowlist.json"), "utf8"));
const allowlistedPackageSources = allowlist.sources.map((s) => s.id);
const clone = (x) => structuredClone(x);
const enabled = enableManagement({ enrollment, actor: { kind: "human", subject: "oidc|anna.andersen" }, role: { id: "platform-owner" }, profileRef: "linux-lts-host", now: Date.parse("2026-09-24T08:30:00Z") }).enrollment;

function makeCredentialBroker() {
  const signer = createLocalSigner({ kid: "host-broker-signer" });
  const broker = createCredentialBroker({ signer, issuer: "urn:platform:host-broker", clock: () => Date.parse("2026-09-24T09:30:00Z") });
  const verifier = createCredentialVerifier({ jwks: broker.jwks(), issuer: "urn:platform:host-broker", clock: () => Date.parse("2026-09-24T09:30:00Z") });
  return { broker, verifier };
}

test("host-styring er slået fra som standard", () => {
  assert.equal(hostManagementEnabled(enrollment), false);
  const result = enrollHost({ enrollment, actor: { kind: "human", subject: "oidc|anna.andersen" }, platforms, profile });
  assert.equal(result.ok, true, JSON.stringify(result.problems));
  assert.equal(result.enabled, false);
  assert.equal(result.enrollment.management.enabled, false);
});

test("enrollment afviser ikke-understøttede OS og en ikke-menneskelig bootstrap", () => {
  const badOs = clone(enrollment);
  badOs.host.platformRef = "does-not-exist";
  assert.equal(enrollHost({ enrollment: badOs, actor: { kind: "human", subject: "oidc|anna.andersen" }, platforms }).ok, false);

  const badActor = enrollHost({ enrollment, actor: { kind: "agent", subject: "agent|x" }, platforms, profile });
  assert.equal(badActor.ok, false);
});

test("kun et navngivet menneske med platformrolle må slå host-styring til", () => {
  assert.equal(enableManagement({ enrollment, actor: { kind: "human", subject: "oidc|anna.andersen" }, role: { id: "implementer" } }).ok, false);
  assert.equal(enableManagement({ enrollment, actor: { kind: "agent", subject: "agent|x" }, role: { id: "platform-owner" } }).ok, false);
  const ok = enableManagement({ enrollment, actor: { kind: "human", subject: "oidc|anna.andersen" }, role: { id: "platform-owner" }, now: Date.parse("2026-09-24T08:30:00Z") });
  assert.equal(ok.ok, true);
  assert.equal(ok.enrollment.management.enabledBy, "oidc|anna.andersen");
  assert.equal(disableManagement({ enrollment: ok.enrollment, actor: { kind: "human", subject: "oidc|anna.andersen" } }).enrollment.management.enabled, false);
});

test("trust skal matche begge fingeraftryk (default-deny)", () => {
  assert.equal(verifyTrust({ enrollment, presented: { caFingerprint: enrollment.trust.caFingerprint, sshHostKeyFingerprint: enrollment.trust.sshHostKeyFingerprint } }).ok, true);
  assert.equal(verifyTrust({ enrollment, presented: { caFingerprint: "f".repeat(64), sshHostKeyFingerprint: enrollment.trust.sshHostKeyFingerprint } }).ok, false);
});

test("operationens signatur dækker indholdet", () => {
  assert.equal(verifyOperationSignature(exampleOperation, hostKeyring).ok, true);
  const tampered = clone(exampleOperation);
  tampered.operation.dryRun = !tampered.operation.dryRun;
  assert.equal(verifyOperationSignature(tampered, hostKeyring).ok, false);
});

test("operationen afvises ved arbitrær shell, uploadet script, usigneret pakke og brokerændring", () => {
  const shell = clone(exampleOperation);
  shell.operation.parameters = { shell: "rm -rf /" };
  assert.ok(operationProblems(shell, { enrollment: enabled, profile, runbooks }).some((p) => p.message.includes("shell")));

  const script = clone(exampleOperation);
  script.restrictions.uploadedScript = true;
  assert.ok(operationProblems(script, { enrollment: enabled, profile, runbooks }).some((p) => p.path.includes("uploadedScript")));

  const unsigned = clone(exampleOperation);
  unsigned.package.signatureVerified = false;
  assert.ok(operationProblems(unsigned, { enrollment: enabled, profile, runbooks }).some((p) => p.path.includes("signatureVerified")));

  const brokerChange = clone(exampleOperation);
  brokerChange.restrictions.brokerConfigChange = true;
  assert.ok(operationProblems(brokerChange, { enrollment: enabled, profile, runbooks }).some((p) => p.path.includes("brokerConfigChange")));
});

test("brokeren udsteder kun operationsticket til en executor", () => {
  const { broker } = makeCredentialBroker();
  const hostBroker = createHostBroker({ credentialBroker: broker, keyring: hostKeyring, enrollment: enabled, profile, runbooks, allowlistedPackageSources, clock: () => Date.parse("2026-09-24T09:30:00Z") });
  assert.throws(() => hostBroker.issueOperationTicket({ operation: exampleOperation, executorAgent: { id: "planner-1", spiffeId: "spiffe://x/planner", role: "planner" } }), /executor/);
  assert.throws(() => hostBroker.issueOperationTicket({ operation: exampleOperation, executorAgent: { id: "impl-1", spiffeId: "spiffe://x/impl", role: "implementer" } }), /executor/);

  const ticket = hostBroker.issueOperationTicket({ operation: exampleOperation, executorAgent: { id: "exec-1", spiffeId: "spiffe://x/exec", role: "executor" } });
  assert.equal(ticket.verb, "package-update");
  assert.equal(ticket.target, "host/acme-prod-node1");
  assert.ok(ticket.credential);
  assert.equal(hostBroker.assertNoHostCredentials({ agent: { role: "planner" }, credentials: [] }), true);
  assert.throws(() => hostBroker.assertNoHostCredentials({ agent: { role: "planner" }, credentials: ["c"] }), /host-credentials/);
});

test("executor-guarden verificerer det udstedte ticket mod handlingen", async () => {
  const { broker, verifier } = makeCredentialBroker();
  const hostBroker = createHostBroker({ credentialBroker: broker, keyring: hostKeyring, enrollment: enabled, profile, runbooks, allowlistedPackageSources, clock: () => Date.parse("2026-09-24T09:30:00Z") });
  const ticket = hostBroker.issueOperationTicket({ operation: exampleOperation, executorAgent: { id: "exec-1", spiffeId: "spiffe://x/exec", role: "executor" } });
  const guard = createExecutorGuard({ verifier, audience: "module:host", clock: () => Date.parse("2026-09-24T09:30:00Z") });
  const guarded = guard.guard(({ verb, target }) => ({ ok: true, verb, target }));
  const result = await guarded({ credential: ticket.credential, verb: "package-update", target: "host/acme-prod-node1", tenantId: "acme", environment: "staging" });
  assert.equal(result.ok, true);
  await assert.rejects(() => guarded({ credential: ticket.credential, verb: "reboot", target: "host/acme-prod-node1", tenantId: "acme", environment: "staging" }), /credential afvist/);
});

test("den lukkede adapter afviser forbudte capabilities", () => {
  assert.throws(() => createHostAdapter({ effects: { "package-update": { capabilities: ["immutable-write"], run: () => ({}) } } }), /forbudte capability/);
  const adapter = createHostAdapter({ effects: { "package-update": { capabilities: ["package"], run: () => ({ status: "ok" }) } } });
  assert.equal(adapter.has("package-update"), true);
  assert.equal(adapter.has("reboot"), false);
});

test("en operation udføres deterministisk og afviser skjulte immutable-skrivninger", () => {
  const adapter = createHostAdapter({
    effects: {
      "package-update": { capabilities: ["package"], run: ({ hostRef }) => ({ status: "ok", detail: hostRef }) },
    },
  });
  const result = runHostOperation({ operation: exampleOperation, adapter });
  assert.equal(result.status, "ok");
  assert.equal(result.verb, "package-update");

  const plan = planHostOperation({ operation: exampleOperation });
  assert.equal(plan.dryRun, true);
  assert.ok(plan.steps.some((s) => s.id === "canary"));

  const reboot = clone(exampleOperation);
  reboot.operation.verb = "reboot";
  assert.throws(() => runHostOperation({ operation: reboot, adapter }), /ingen effekt/);

  const badParams = clone(exampleOperation);
  badParams.operation.parameters = { nope: 1 };
  assert.throws(() => runHostOperation({ operation: badParams, adapter }), /ikke tilladt/);

  const leaking = createHostAdapter({ effects: { "package-update": { capabilities: ["package"], run: () => ({ writesImmutable: true }) } } });
  assert.throws(() => runHostOperation({ operation: exampleOperation, adapter: leaking }), /immutable data/);
});

test("SSH/firewallændring kan ikke lukke den eneste recoveryvej uden særskilt beslutning", () => {
  const change = { surfaces: ["firewall"], recoveryPath: { outOfBand: true, dependsOn: ["firewall"] } };
  assert.equal(guardRecoveryPath({ change, approval: { humanSubject: "oidc|anna.andersen" } }).ok, false);
  assert.equal(guardRecoveryPath({ change, approval: { humanSubject: "oidc|anna.andersen" }, separateDecision: { humanSubject: "oidc|anna.andersen", accepted: true } }).ok, false);
  assert.equal(guardRecoveryPath({ change, approval: { humanSubject: "oidc|anna.andersen" }, separateDecision: { humanSubject: "oidc|cecilia.christensen", accepted: true } }).ok, true);
  assert.equal(guardRecoveryPath({ change: { surfaces: ["cpu"] } }).ok, true);
});

test("vedligeholdelsesvindue, canary og stopkriterier gater mutationen", () => {
  const windows = [{ start: "2026-09-24T08:00:00Z", end: "2026-09-24T10:00:00Z", announcedAt: "2026-09-23T08:00:00Z" }];
  assert.equal(withinMaintenanceWindow({ profile, windows, at: Date.parse("2026-09-24T09:00:00Z") }).ok, true);
  assert.equal(withinMaintenanceWindow({ profile, windows, at: Date.parse("2026-09-24T12:00:00Z") }).ok, false);

  assert.equal(canaryGate({ operation: exampleOperation, health: { "acme-prod-node1": true } }).ok, true);
  assert.equal(canaryGate({ operation: exampleOperation, health: {} }).ok, false);

  const stop = evaluateStopCriteria({ operation: exampleOperation, signals: { "canary utilgængelig i 60 sekunder": true } });
  assert.equal(stop.ok, false);

  const gate = mutationGate({ operation: exampleOperation, profile, windows, health: { "acme-prod-node1": true }, signals: {}, at: Date.parse("2026-09-24T09:00:00Z") });
  assert.equal(gate.ok, true, JSON.stringify(gate.reasons));
});

test("host-operationen kan ikke røre det separate sikkerhedsdomæne", () => {
  const target = { operation: { target: "host/kms" }, restrictions: { immutableWrite: false, externalKeyDestroy: false } };
  assert.equal(guardSecurityDomain({ operation: target, enrollment }).ok, false);
  assert.equal(guardSecurityDomain({ operation: { operation: { target: "host/acme-prod-node1" }, restrictions: { immutableWrite: false, externalKeyDestroy: false } }, enrollment }).ok, true);

  const policy = loadImmutablePolicy(repoRoot);
  assert.equal(securityDomainProblems({ enrollment, immutablePolicy: policy }).length, 0);
  assert.equal(attemptSecurityDomainWrite({ principal: { kind: "agent", ai: true }, resource: "kms/policy-signing-key", policy }).decision, "deny");
});

test("kapacitetsalarmer er read-only og kræver godkendelse før mutation", () => {
  const result = evaluateCapacity({ hostRef: "acme-prod-node1", readings: { cpu: 0.95, memory: 0.5, disk: 0.8 }, owner: "oidc|anna.andersen" });
  assert.equal(result.readOnly, true);
  assert.equal(result.alerts.length, 2);
  assert.ok(result.alerts.every((a) => a.mutationRequiresApproval === true));
  assert.ok(result.alerts.some((a) => a.severity === "critical"));
});
