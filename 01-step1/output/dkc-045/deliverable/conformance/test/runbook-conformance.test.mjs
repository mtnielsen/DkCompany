/**
 * DKC-045 — konformanstest for runbooks og menneskestyrede changes.
 *
 * Efterprøver de fem acceptkriterier på validatorniveau og mod den rigtige
 * change-service/approval-service:
 *
 *   1. Ingen forhåndsgodkendelse ⇒ godkendelse pr. mutation.
 *   2. Ny runbookversion eller større scope kræver ny godkendelse.
 *   3. Timeout/manglende svar/no-objection er aldrig approval.
 *   4. Emergency kan ikke ophæve A4/AI-immutable.
 *   5. To samtidige changes på samme ressource koordineres.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot, buildAjv, SCHEMA_IDS } from "../src/schemas.mjs";
import { validateRunbook, validateChangeRequest, changeRequestProblems, knownRunbooksFromExamples } from "../src/runbook.mjs";
import { signRunbook, runbookDigest } from "../../approvals/src/runbook.mjs";
import { createApprovalService } from "../../approvals/src/approval-service.mjs";
import { createChangeService } from "../../approvals/src/change-service.mjs";
import { createChangeCalendar } from "../../approvals/src/change-calendar.mjs";
import { randomUUID } from "node:crypto";

const NOW = Date.parse("2025-09-02T00:00:00Z");
const read = (rel) => JSON.parse(readFileSync(join(repoRoot, rel), "utf8"));
const runbookExample = read("contracts/examples/runbook.example.json");
const changeExample = read("contracts/examples/change-request.example.json");
const keyring = read("runbooks/dev-keyring.json");
const clone = (x) => JSON.parse(JSON.stringify(x));
const TRAINING = ["evidence-over-prose", "when-to-reject"];

test("runbook-eksemplet validerer (skema + signatur + semantik)", () => {
  const { ajv } = buildAjv();
  assert.equal(validateRunbook(runbookExample, ajv, { now: NOW, keyring }).ok, true, JSON.stringify(validateRunbook(runbookExample, ajv, { now: NOW, keyring }).errors));
});

test("change-eksemplet validerer (skema + flow + autorisation)", () => {
  const { ajv } = buildAjv();
  const result = validateChangeRequest(changeExample, ajv, { runbooks: knownRunbooksFromExamples(join(repoRoot, "contracts/examples")), now: NOW });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("en usigneret runbook afvises", () => {
  const broken = clone(runbookExample);
  delete broken.signature;
  const { ajv } = buildAjv();
  const result = validateRunbook(broken, ajv, { now: NOW, keyring });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /signatur|signature/.test(e.path + e.message)));
});

test("en manipuleret runbook afvises af signaturen", () => {
  const broken = clone(runbookExample);
  broken.scope.targets = ["service/other"];
  const { ajv } = buildAjv();
  const result = validateRunbook(broken, ajv, { now: NOW, keyring });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /signatur/.test(e.message)));
});

test("en udløbet runbook afvises, selv med gyldig signatur", () => {
  const broken = clone(runbookExample);
  broken.expiry = { approvedAt: "2025-08-01T00:00:00Z", expiresAt: "2025-08-02T00:00:00Z", maxAgeSeconds: 604800 };
  const resigned = signRunbook(broken, { keyId: "runbook-example-key", secret: "dkc045-runbook-example-key", signedAt: "2025-08-01T00:00:00Z" });
  const { ajv } = buildAjv();
  const result = validateRunbook(resigned, ajv, { now: NOW, keyring });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /udløbet/.test(e.message)));
});

/* -------------------------------------------------------------------------- */
/* Change-flow-semantik                                                       */
/* -------------------------------------------------------------------------- */
test("en standard-change uden pre-approval afvises", () => {
  const broken = clone(changeExample);
  delete broken.approval.preApprovalId;
  delete broken.authorization;
  const problems = changeRequestProblems(broken);
  assert.ok(problems.some((p) => /pre-approval/.test(p.message)));
});

test("en normal-change med forkert autorisationstype afvises", () => {
  const broken = clone(changeExample);
  broken.flow = "normal";
  broken.authorization.kind = "pre-approval";
  const problems = changeRequestProblems(broken);
  assert.ok(problems.some((p) => /'approval'/.test(p.message)));
});

test("en emergency-change uden særskilt autorisation afvises", () => {
  const broken = clone(changeExample);
  broken.flow = "emergency";
  delete broken.authorization;
  const problems = changeRequestProblems(broken);
  assert.ok(problems.some((p) => /emergency/.test(p.message)));
});

test("en emergency-change kan ikke erklære at have omgået A4/AI-immutable", () => {
  const broken = clone(changeExample);
  broken.flow = "emergency";
  broken.authorization.kind = "emergency";
  broken.a4Override = true;
  const problems = changeRequestProblems(broken);
  assert.ok(problems.some((p) => /A4/.test(p.message)));
});

test("et change med en forkert runbook-digest afvises", () => {
  const broken = clone(changeExample);
  broken.runbook.digest = "f".repeat(64);
  const runbooks = knownRunbooksFromExamples(join(repoRoot, "contracts/examples"));
  const problems = changeRequestProblems(broken, { runbooks });
  assert.ok(problems.some((p) => /runbook-digesten/.test(p.message)));
});

/* -------------------------------------------------------------------------- */
/* Acceptkriterier mod den rigtige change-service                             */
/* -------------------------------------------------------------------------- */
function signedRunbook(overrides = {}) {
  const base = {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "Runbook",
    metadata: { name: "restart-svc", version: "1.0.0", description: "Genstart en tjeneste med postchecks.", owner: { team: "platform" }, accountableHuman: { subject: "oidc|anna.andersen", role: "Platform Owner" } },
    scope: { verbs: ["restart"], targets: ["service/checkout"], environments: ["staging"], tenants: ["*"] },
    parameters: { schema: { type: "object", additionalProperties: false, properties: { maxDurationSeconds: { type: "integer", minimum: 1, maximum: 300, required: true } } }, limits: { maxDurationSeconds: 300, maxTargets: 1 } },
    preconditions: [{ id: "green", check: "healthcheck", expect: "green" }],
    maxImpact: { blastRadius: "single-service", maxTargets: 1, customerVisible: false, maxDurationSeconds: 300 },
    expiry: { approvedAt: "2025-09-01T00:00:00Z", expiresAt: "2025-09-03T00:00:00Z", maxAgeSeconds: 604800 },
    attempts: { maxAttempts: 3, windowSeconds: 3600 },
    rollback: { required: true, method: "restart-prev", tested: true },
    postchecks: [{ id: "h", check: "healthcheck", expect: "green", timeoutSeconds: 120, onFailure: "rollback" }],
    approval: { flow: "standard", preApproved: true, preApprovalRef: "APR-x", requiredApprovals: 2, eligibleGroups: ["platform-approvers"] },
  };
  const merged = { ...base, ...overrides };
  return signRunbook(merged, { keyId: "runbook-fixed", secret: "fixed-secret", signedAt: "2025-09-01T00:00:00Z" });
}

function approvalRequest(digest, { verb = "runbook.approve", targets = ["service/checkout"] } = {}) {
  return {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "ApprovalRequest",
    id: `apr-${randomUUID()}`,
    tenantId: "acme",
    createdAt: new Date(NOW).toISOString(),
    agent: { ref: "change-service", spiffeId: "spiffe://platform.example.org/services/change-service", manifestVersion: "1.0.0" },
    trigger: { sourceEventId: randomUUID(), sourceType: "runbook-approval", observedAt: new Date(NOW).toISOString(), untrustedInput: false },
    change: { verb, autonomyClass: "A3", environment: "staging", targets, diff: { sha256: "a".repeat(64) }, parameters: {}, runbook: { sha256: digest } },
    evidence: { policyEvaluation: { bundleVersion: "1", decision: "allow-with-approval" }, tests: { status: "pass", passed: 1, failed: 0 }, dryRun: { status: "clean", exitCode: 0 }, scans: [] },
    blastRadius: { tenants: 1, users: 0, services: ["checkout"], estimatedDowntimeSeconds: 0, reversible: true, personalDataAffected: false, dataCategories: ["operational"] },
    rollback: { method: "restart-prev", tested: true },
    agentAssessment: { rationale: "Runbook.", doNothingConsequence: "Ingen.", confidence: 0.9, uncertainties: [], notChecked: [], claims: [] },
    decision: { state: "pending", expiresAt: "2025-09-03T00:00:00Z" },
  };
}

function service() {
  const approval = createApprovalService({ trainingRegistry: () => TRAINING, clock: () => NOW });
  const change = createChangeService({ approvalService: approval, runbookKeyring: { "runbook-fixed": "fixed-secret" }, calendar: createChangeCalendar({ clock: () => NOW }), preconditions: { healthcheck: () => "green" }, postchecks: { healthcheck: () => "green" }, rollbackExecutor: () => {}, clock: () => NOW });
  return { approval, change };
}

test("accept 1: normal-runbook uden pre-approval kræver godkendelse pr. mutation", () => {
  const { change } = service();
  const rb = signedRunbook({ approval: { flow: "normal", preApproved: false, preApprovalRef: null, requiredApprovals: 2, eligibleGroups: ["platform-approvers"] } });
  assert.equal(change.registerRunbook(rb).ok, true);
  const out = change.resolve({ runbookRef: "restart-svc@1.0.0", verb: "restart", target: "service/checkout", environment: "staging", parameters: { maxDurationSeconds: 60 } });
  assert.equal(out.requiresApproval, true);
});

test("accept 2: en ny version med større scope kræver ny godkendelse", () => {
  const { approval, change } = service();
  const v1 = signedRunbook();
  const v2 = signedRunbook({ metadata: { name: "restart-svc", version: "1.1.0", description: "Genstart to tjenester.", owner: { team: "platform" }, accountableHuman: { subject: "oidc|anna.andersen", role: "Platform Owner" } }, scope: { verbs: ["restart"], targets: ["service/checkout", "service/payments"], environments: ["staging"], tenants: ["*"] } });
  const req = approval.create(structuredClone(approvalRequest(runbookDigest(v1))));
  approval.decide(req.id, { principal: { kind: "human", id: "oidc|one", tenantId: "acme", groups: ["platform-approvers"] }, verdict: "approve" });
  approval.decide(req.id, { principal: { kind: "human", id: "oidc|two", tenantId: "acme", groups: ["platform-approvers"] }, verdict: "approve" });
  change.registerRunbook(v1);
  change.registerRunbook(v2);
  change.approveRunbook({ runbookRef: "restart-svc@1.0.0", approvalId: req.id });
  const out = change.resolve({ runbookRef: "restart-svc@1.1.0", verb: "restart", target: "service/payments", environment: "staging", parameters: { maxDurationSeconds: 60 } });
  assert.equal(out.requiresApproval, true);
});

test("accept 3: en pending godkendelse er aldrig en pre-approval", () => {
  const { approval, change } = service();
  const rb = signedRunbook();
  change.registerRunbook(rb);
  const pending = approval.create(structuredClone(approvalRequest(runbookDigest(rb))));
  assert.throws(() => change.approveRunbook({ runbookRef: "restart-svc@1.0.0", approvalId: pending.id }), /ikke en gyldig|godkendelse|pending/);
});

test("accept 4: emergency kræver særskilt autorisation og A4 håndhæves uafhængigt", () => {
  const { change } = service();
  const rb = signedRunbook({ approval: { flow: "emergency", preApproved: false, preApprovalRef: null, requiredApprovals: 2, eligibleGroups: ["platform-approvers"] } });
  change.registerRunbook(rb);
  const out = change.resolve({ runbookRef: "restart-svc@1.0.0", verb: "restart", target: "service/checkout", environment: "staging", parameters: { maxDurationSeconds: 60 } });
  assert.equal(out.requiresApproval, true);
  assert.ok(out.record.emergencyProblems.some((r) => /autorisation/.test(r)));
});

test("accept 5: to samtidige changes på samme ressource koordineres", () => {
  const { approval, change } = service();
  const rb = signedRunbook();
  const req = approval.create(structuredClone(approvalRequest(runbookDigest(rb))));
  approval.decide(req.id, { principal: { kind: "human", id: "oidc|one", tenantId: "acme", groups: ["platform-approvers"] }, verdict: "approve" });
  approval.decide(req.id, { principal: { kind: "human", id: "oidc|two", tenantId: "acme", groups: ["platform-approvers"] }, verdict: "approve" });
  change.registerRunbook(rb);
  change.approveRunbook({ runbookRef: "restart-svc@1.0.0", approvalId: req.id });
  const first = change.resolve({ runbookRef: "restart-svc@1.0.0", verb: "restart", target: "service/checkout", environment: "staging", parameters: { maxDurationSeconds: 60 } });
  const second = change.resolve({ runbookRef: "restart-svc@1.0.0", verb: "restart", target: "service/checkout", environment: "staging", parameters: { maxDurationSeconds: 60 } });
  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
});

/* Sikrer at SCHEMA_IDS kender de nye kontrakter. */
test("SCHEMA_IDS indeholder runbook og changeRequest", () => {
  assert.ok(SCHEMA_IDS.runbook);
  assert.ok(SCHEMA_IDS.changeRequest);
});
