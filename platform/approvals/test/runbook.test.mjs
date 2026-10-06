/**
 * DKC-045 — runbook- og change-flow-tests.
 *
 * Tester den rigtige change-service og den rigtige approval-service (DKC-004/005)
 * mod signerede runbooks. Dækker acceptkriterierne:
 *
 *   1. Ingen forhåndsgodkendelse ⇒ menneskelig godkendelse pr. mutation.
 *   2. Ny runbookversion eller større scope kræver ny godkendelse.
 *   3. Timeout, manglende svar eller no-objection er aldrig approval.
 *   4. Emergency kan ikke ophæve A4/AI-immutable (håndhæves i runtimen).
 *   5. To samtidige changes på samme ressource koordineres og kan ikke omgå låse.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApprovalService } from "../src/approval-service.mjs";
import { createChangeService } from "../src/change-service.mjs";
import { createChangeCalendar, createFileLockStore } from "../src/change-calendar.mjs";
import { signRunbook, runbookDigest, runbookProblems } from "../src/runbook.mjs";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const NOW = Date.parse("2025-09-02T00:00:00Z");
const KEYRING = { "runbook-key-1": "synthetic-runbook-signing-secret" };
const TRAINING = ["evidence-over-prose", "when-to-reject"];

function baseRunbook(overrides = {}) {
  const runbook = {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "Runbook",
    metadata: {
      name: "restart-checkout",
      version: "1.0.0",
      description: "Genstart checkout-tjenesten sikkert med healthchecks før og efter.",
      owner: { team: "platform", contact: "platform@example.org" },
      accountableHuman: { subject: "oidc|anna.andersen", role: "Platform Owner" },
    },
    scope: {
      verbs: ["restart"],
      targets: ["service/checkout"],
      environments: ["staging", "prod"],
      tenants: ["*"],
    },
    parameters: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          maxDurationSeconds: { type: "integer", minimum: 1, maximum: 300, required: true },
          reason: { type: "string", minLength: 1 },
        },
      },
      limits: { maxDurationSeconds: 300, maxTargets: 1 },
    },
    preconditions: [{ id: "currently-green", check: "healthcheck", expect: "green" }],
    maxImpact: { blastRadius: "single-service", maxTargets: 1, customerVisible: false, maxDurationSeconds: 300 },
    expiry: { approvedAt: "2025-09-01T00:00:00Z", expiresAt: "2025-09-03T00:00:00Z", maxAgeSeconds: 7 * 24 * 3600 },
    attempts: { maxAttempts: 3, windowSeconds: 3600 },
    rollback: { required: true, method: "restart-prev", runbookRef: "restart-checkout@1.0.0", tested: true },
    postchecks: [{ id: "healthy-after", check: "healthcheck", expect: "green", timeoutSeconds: 120, onFailure: "rollback" }],
    approval: {
      flow: "standard",
      preApproved: true,
      preApprovalRef: "APR-PLACEHOLDER",
      requiredApprovals: 2,
      eligibleGroups: ["platform-approvers"],
    },
  };
  return deepMerge(runbook, overrides);
}

function deepMerge(base, overrides) {
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) return overrides ?? base;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(overrides)) out[k] = deepMerge(base?.[k], v);
  return out;
}

function signed(overrides = {}) {
  return signRunbook(baseRunbook(overrides), { keyId: "runbook-key-1", secret: KEYRING["runbook-key-1"], signedAt: "2025-09-01T00:00:00Z" });
}

function approvalService() {
  return createApprovalService({ trainingRegistry: () => TRAINING, clock: () => NOW });
}

function approvalPayload({ id = `apr-${randomUUID()}`, digest, targets = ["service/checkout"], verb = "runbook.approve", emergency = false, tenantId = "acme", expiresInSeconds = 24 * 3600 } = {}) {
  return {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "ApprovalRequest",
    id,
    tenantId,
    createdAt: new Date(NOW).toISOString(),
    agent: { ref: "change-service", spiffeId: "spiffe://platform.example.org/services/change-service", manifestVersion: "1.0.0" },
    trigger: { sourceEventId: randomUUID(), sourceType: "runbook-approval", observedAt: new Date(NOW).toISOString(), untrustedInput: false },
    change: {
      verb,
      autonomyClass: "A3",
      environment: "staging",
      targets,
      diff: { sha256: "a".repeat(64) },
      parameters: { reason: "forhåndsgodkendelse af runbook" },
      runbook: { sha256: digest },
      ...(emergency ? { emergency: true } : {}),
    },
    evidence: { policyEvaluation: { pdp: "opa.platform.example.org", bundleVersion: "2025.09.01.1", decision: "allow-with-approval" }, tests: { status: "pass", passed: 1, failed: 0 }, dryRun: { status: "clean", exitCode: 0 }, scans: [] },
    blastRadius: { tenants: 1, users: 0, services: ["checkout"], estimatedDowntimeSeconds: 0, reversible: true, personalDataAffected: false, dataCategories: ["operational"] },
    rollback: { method: "restart-prev", tested: true },
    agentAssessment: { rationale: "Forhåndsgodkendelse af en signeret runbook.", doNothingConsequence: "Ingen.", confidence: 0.9, uncertainties: [], notChecked: [], claims: [] },
    decision: { state: "pending", expiresAt: new Date(NOW + expiresInSeconds * 1000).toISOString() },
  };
}

function approveFully(service, payload) {
  const req = service.create(structuredClone(payload));
  service.decide(req.id, { principal: { kind: "human", id: "oidc|approver.one", tenantId: "acme", groups: ["platform-approvers"] }, verdict: "approve" });
  service.decide(req.id, { principal: { kind: "human", id: "oidc|approver.two", tenantId: "acme", groups: ["platform-approvers"] }, verdict: "approve" });
  return req;
}

function makeChangeService({ approval, calendarOverrides = {}, postchecks = {}, rollbackExecutor = null, requireMaintenanceWindow = false } = {}) {
  const calendar = createChangeCalendar({ clock: () => NOW, ...calendarOverrides });
  const service = createChangeService({
    approvalService: approval,
    runbookKeyring: KEYRING,
    calendar,
    preconditions: { healthcheck: () => "green" },
    postchecks: { healthcheck: () => "green", ...postchecks },
    rollbackExecutor,
    clock: () => NOW,
    requireMaintenanceWindow,
  });
  return { service, calendar };
}

/* -------------------------------------------------------------------------- */
/* Signatur og semantik                                                       */
/* -------------------------------------------------------------------------- */
test("kun en signeret runbook kan registreres", () => {
  const { service } = makeChangeService();
  const good = service.registerRunbook(signed());
  assert.equal(good.ok, true, JSON.stringify(good.errors));
  assert.equal(service.registerRunbook(signed({ metadata: { version: "9.9.9" } }), { activate: false }).ok, true); // signeret korrekt
  const tampered = signed();
  tampered.scope.targets = ["service/other"];
  const result = service.registerRunbook(tampered);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /signatur/.test(e.message)));
});

test("en runbook med utestet rollback eller åbent parameterskema afvises", () => {
  const problems = runbookProblems(signed({ rollback: { tested: false }, parameters: { schema: { type: "object", additionalProperties: true } } }), { now: NOW, keyring: KEYRING });
  assert.ok(problems.some((p) => /rollback/.test(p.path)));
  assert.ok(problems.some((p) => /additionalProperties/.test(p.path)));
});

/* -------------------------------------------------------------------------- */
/* Accept 1: ingen pre-approval ⇒ godkendelse pr. mutation                    */
/* -------------------------------------------------------------------------- */
test("accept 1: standard-runbook uden pre-approval kræver godkendelse pr. mutation", () => {
  const { service } = makeChangeService();
  assert.equal(service.registerRunbook(signed()).ok, true);
  const resolved = service.resolve({ runbookRef: "restart-checkout@1.0.0", verb: "restart", target: "service/checkout", environment: "staging", tenantId: "acme", parameters: { maxDurationSeconds: 60, reason: "test" } });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.requiresApproval, true);
  assert.equal(resolved.flow, "standard");
});

test("accept 1b: en normal-runbook kræver altid godkendelse pr. mutation", () => {
  const { service } = makeChangeService();
  const runbook = signed({ approval: { flow: "normal", preApproved: false, preApprovalRef: null } });
  assert.equal(service.registerRunbook(runbook).ok, true);
  const resolved = service.resolve({ runbookRef: "restart-checkout@1.0.0", verb: "restart", target: "service/checkout", environment: "staging", tenantId: "acme", parameters: { maxDurationSeconds: 60, reason: "test" } });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.requiresApproval, true);
  assert.equal(resolved.flow, "normal");
});

/* -------------------------------------------------------------------------- */
/* Accept 2: ny version eller større scope kræver ny godkendelse              */
/* -------------------------------------------------------------------------- */
test("accept 2: ny runbookversion kræver en ny pre-approval", () => {
  const approval = approvalService();
  const v1 = signed();
  const v2 = signed({ metadata: { version: "1.1.0" }, scope: { targets: ["service/checkout", "service/payments"] } });
  const reqV1 = approveFully(approval, approvalPayload({ digest: runbookDigest(v1), targets: ["service/checkout"] }));
  const { service } = makeChangeService({ approval });
  service.registerRunbook(v1);
  service.registerRunbook(v2);
  const pre = service.approveRunbook({ runbookRef: "restart-checkout@1.0.0", approvalId: reqV1.id });
  assert.equal(pre.digest, runbookDigest(v1));

  const okV1 = service.resolve({ runbookRef: "restart-checkout@1.0.0", verb: "restart", target: "service/checkout", environment: "staging", parameters: { maxDurationSeconds: 60, reason: "ok" } });
  assert.equal(okV1.requiresApproval, false, "v1 er forhåndsgodkendt");

  // v2 har et andet scope og en anden digest: pre-approvalen dækker den ikke.
  const v2Resolve = service.resolve({ runbookRef: "restart-checkout@1.1.0", verb: "restart", target: "service/payments", environment: "staging", parameters: { maxDurationSeconds: 60, reason: "ok" } });
  assert.equal(v2Resolve.ok, true);
  assert.equal(v2Resolve.requiresApproval, true, "en ny version/scope må ikke genbruge v1's godkendelse");
});

test("accept 2b: pre-approval afvises hvis bindingen peger på en anden digest", () => {
  const approval = approvalService();
  const runbook = signed();
  const wrong = approveFully(approval, approvalPayload({ digest: "f".repeat(64) }));
  const { service } = makeChangeService({ approval });
  service.registerRunbook(runbook);
  assert.throws(() => service.approveRunbook({ runbookRef: "restart-checkout@1.0.0", approvalId: wrong.id }), /anden runbookversion/);
});

/* -------------------------------------------------------------------------- */
/* Accept 3: timeout/no-objection/ikke-svar er aldrig approval                */
/* -------------------------------------------------------------------------- */
test("accept 3: en pending eller udløbet godkendelse kan ikke blive pre-approval", () => {
  const approval = approvalService();
  const runbook = signed();
  const pending = approval.create(structuredClone(approvalPayload({ digest: runbookDigest(runbook), expiresInSeconds: -10 })));
  const { service } = makeChangeService({ approval });
  service.registerRunbook(runbook);
  // Udløbet, aldrig godkendt.
  assert.throws(() => service.approveRunbook({ runbookRef: "restart-checkout@1.0.0", approvalId: pending.id }), /ikke en gyldig|godkendelse|pending|expired/);
  const expired = approval.get(pending.id);
  assert.notEqual(expired.decision.state, "approved");
});

test("accept 3b: en enkelt godkendelse er ikke nok når politikken kræver to", () => {
  const approval = approvalService();
  const runbook = signed();
  const req = approval.create(structuredClone(approvalPayload({ digest: runbookDigest(runbook) })));
  approval.decide(req.id, { principal: { kind: "human", id: "oidc|one", tenantId: "acme", groups: ["platform-approvers"] }, verdict: "approve" });
  const { service } = makeChangeService({ approval });
  service.registerRunbook(runbook);
  assert.throws(() => service.approveRunbook({ runbookRef: "restart-checkout@1.0.0", approvalId: req.id }), /ikke en gyldig|godkendelse|pending/);
});

/* -------------------------------------------------------------------------- */
/* Parametre, scope og forudsætninger                                         */
/* -------------------------------------------------------------------------- */
test("parametre uden for runbookens skema afvises", () => {
  const { service } = makeChangeService();
  service.registerRunbook(signed());
  const out = service.resolve({ runbookRef: "restart-checkout@1.0.0", verb: "restart", target: "service/checkout", environment: "staging", parameters: { maxDurationSeconds: 600, reason: "for lang" } });
  assert.equal(out.ok, false);
  assert.ok(out.reasons.some((r) => /maxDurationSeconds/.test(r)));
  const unknown = service.resolve({ runbookRef: "restart-checkout@1.0.0", verb: "restart", target: "service/checkout", environment: "staging", parameters: { maxDurationSeconds: 60, reason: "ok", shell: "rm -rf /" } });
  assert.equal(unknown.ok, false);
  assert.ok(unknown.reasons.some((r) => /shell/.test(r)));
});

test("en handling uden for runbookens scope afvises", () => {
  const { service } = makeChangeService();
  service.registerRunbook(signed());
  const out = service.resolve({ runbookRef: "restart-checkout@1.0.0", verb: "restart", target: "service/payments", environment: "staging", parameters: { maxDurationSeconds: 60, reason: "ok" } });
  assert.equal(out.ok, false);
  assert.ok(out.reasons.some((r) => /scope/.test(r)));
});

test("en uopfyldt forudsætning stopper runbooken", () => {
  const approval = approvalService();
  const calendar = createChangeCalendar({ clock: () => NOW });
  const service = createChangeService({ approvalService: approval, runbookKeyring: KEYRING, calendar, preconditions: { healthcheck: () => "red" }, postchecks: {}, clock: () => NOW });
  service.registerRunbook(signed());
  const out = service.resolve({ runbookRef: "restart-checkout@1.0.0", verb: "restart", target: "service/checkout", environment: "staging", parameters: { maxDurationSeconds: 60, reason: "ok" } });
  assert.equal(out.ok, false);
  assert.ok(out.reasons.some((r) => /forudsætning/.test(r)));
});

/* -------------------------------------------------------------------------- */
/* Accept 5: samtidige changes og låse                                        */
/* -------------------------------------------------------------------------- */
test("accept 5: to samtidige changes på samme ressource koordineres af en lås", () => {
  const approval = approvalService();
  const runbook = signed();
  const req = approveFully(approval, approvalPayload({ digest: runbookDigest(runbook) }));
  const { service } = makeChangeService({ approval });
  service.registerRunbook(runbook);
  service.approveRunbook({ runbookRef: "restart-checkout@1.0.0", approvalId: req.id });

  const first = service.resolve({ runbookRef: "restart-checkout@1.0.0", verb: "restart", target: "service/checkout", environment: "staging", parameters: { maxDurationSeconds: 60, reason: "a" } });
  const second = service.resolve({ runbookRef: "restart-checkout@1.0.0", verb: "restart", target: "service/checkout", environment: "staging", parameters: { maxDurationSeconds: 60, reason: "b" } });
  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  assert.ok(second.reasons.some((r) => /låst|konflikt/.test(r)));

  // Når den første afsluttes, frigives låsen og den næste kan gennemføres.
  service.finalize({ changeId: first.changeId, outcome: "succeeded" });
  const third = service.resolve({ runbookRef: "restart-checkout@1.0.0", verb: "restart", target: "service/checkout", environment: "staging", parameters: { maxDurationSeconds: 60, reason: "c" } });
  assert.equal(third.ok, true);
});

test("accept 5b: en filbaseret lås giver gensidig udelukkelse mellem processer", () => {
  const dir = mkdtempSync(join(tmpdir(), "dkc045-lock-"));
  const lock = createFileLockStore({ dir });
  const at = NOW;
  assert.equal(lock.create("target:service/checkout", { changeId: "chg-1", expiresAt: at + 1000 }), true);
  assert.equal(lock.create("target:service/checkout", { changeId: "chg-2", expiresAt: at + 1000 }), false);
  assert.equal(existsSync(join(dir, `${Buffer.from("target:service/checkout").toString("hex")}.lock`)), true);
  lock.remove("target:service/checkout");
  assert.equal(lock.create("target:service/checkout", { changeId: "chg-2", expiresAt: at + 1000 }), true);
});

/* -------------------------------------------------------------------------- */
/* Vedligeholdelsesvindue og konflikter                                       */
/* -------------------------------------------------------------------------- */
test("en change uden for vedligeholdelsesvinduet afvises når det kræves", () => {
  const { service } = makeChangeService({ requireMaintenanceWindow: true });
  service.registerRunbook(signed());
  const out = service.resolve({ runbookRef: "restart-checkout@1.0.0", verb: "restart", target: "service/checkout", environment: "staging", parameters: { maxDurationSeconds: 60, reason: "ok" } });
  assert.equal(out.ok, false);
  assert.ok(out.reasons.some((r) => /vedligeholdelsesvindue/.test(r)));
});

test("en change inde i et vedligeholdelsesvindue tillades", () => {
  const window = { id: "mw-1", environment: "staging", targets: ["service/checkout"], start: "2025-09-01T22:00:00Z", end: "2025-09-02T04:00:00Z" };
  const { service } = makeChangeService({ requireMaintenanceWindow: true, calendarOverrides: { windows: [window] } });
  service.registerRunbook(signed());
  const out = service.resolve({ runbookRef: "restart-checkout@1.0.0", verb: "restart", target: "service/checkout", environment: "staging", parameters: { maxDurationSeconds: 60, reason: "ok" } });
  assert.equal(out.ok, true, JSON.stringify(out.reasons));
});

/* -------------------------------------------------------------------------- */
/* Postchecks og rollback                                                     */
/* -------------------------------------------------------------------------- */
test("en fejlende postcheck udløser den testede rollback", () => {
  const approval = approvalService();
  const runbook = signed();
  const req = approveFully(approval, approvalPayload({ digest: runbookDigest(runbook) }));
  let rolledBack = 0;
  const { service } = makeChangeService({ approval, postchecks: { healthcheck: () => "red" }, rollbackExecutor: () => { rolledBack += 1; } });
  service.registerRunbook(runbook);
  service.approveRunbook({ runbookRef: "restart-checkout@1.0.0", approvalId: req.id });
  const resolved = service.resolve({ runbookRef: "restart-checkout@1.0.0", verb: "restart", target: "service/checkout", environment: "staging", parameters: { maxDurationSeconds: 60, reason: "ok" } });
  const final = service.finalize({ changeId: resolved.changeId, outcome: "succeeded" });
  assert.equal(final.rollbackPerformed, true);
  assert.equal(rolledBack, 1);
  assert.equal(final.state, "rolled_back");
});

/* -------------------------------------------------------------------------- */
/* Emergency                                                                  */
/* -------------------------------------------------------------------------- */
test("emergency kræver en særskilt menneskelig autorisation", () => {
  const approval = approvalService();
  const runbook = signed({ approval: { flow: "emergency", preApproved: false, preApprovalRef: null } });
  const { service } = makeChangeService({ approval });
  service.registerRunbook(runbook);
  const without = service.resolve({ runbookRef: "restart-checkout@1.0.0", verb: "restart", target: "service/checkout", environment: "staging", parameters: { maxDurationSeconds: 60, reason: "incident" } });
  assert.equal(without.ok, true);
  assert.equal(without.requiresApproval, true);
  assert.ok(without.record.emergencyProblems.some((r) => /autorisation/.test(r)));
});

test("emergency med en rigtig autorisation kræver stadig ikke at omgå A4", () => {
  const approval = approvalService();
  const digest = runbookDigest(signed({ approval: { flow: "emergency", preApproved: false, preApprovalRef: null } }));
  const req = approveFully(approval, approvalPayload({ digest, verb: "runbook.emergency", emergency: true }));
  const runbook = signed({ approval: { flow: "emergency", preApproved: false, preApprovalRef: null } });
  const { service } = makeChangeService({ approval });
  service.registerRunbook(runbook);
  const out = service.resolve({
    runbookRef: "restart-checkout@1.0.0",
    verb: "restart",
    target: "service/checkout",
    environment: "staging",
    parameters: { maxDurationSeconds: 60, reason: "incident" },
    emergencyAuthorization: { approvalId: req.id },
  });
  assert.equal(out.ok, true);
  assert.equal(out.flow, "emergency");
  // Uden autorisation ville den kræve godkendelse; A4-håndhævelsen ligger i
  // runtimen og kan ikke slås fra her.
});

/* -------------------------------------------------------------------------- */
/* Forsøgsgrænse                                                              */
/* -------------------------------------------------------------------------- */
test("forsøgsgrænsen håndhæves for en standard-runbook", () => {
  const approval = approvalService();
  const runbook = signed({ attempts: { maxAttempts: 1, windowSeconds: 3600 } });
  const req = approveFully(approval, approvalPayload({ digest: runbookDigest(runbook) }));
  const { service } = makeChangeService({ approval });
  service.registerRunbook(runbook);
  service.approveRunbook({ runbookRef: "restart-checkout@1.0.0", approvalId: req.id });
  // Simulér at forsøget er brugt: pre-approvalens tæller er på maks.
  const pre = service.getPreApproval(runbookDigest(runbook));
  pre.attempts = 1;
  const out = service.resolve({ runbookRef: "restart-checkout@1.0.0", verb: "restart", target: "service/checkout", environment: "staging", parameters: { maxDurationSeconds: 60, reason: "ok" } });
  assert.equal(out.ok, true);
  assert.equal(out.requiresApproval, true, "forsøgsgrænsen er nået → ny godkendelse kræves");
});
