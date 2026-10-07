/**
 * DKC-032 — enhedstest af skyggetilstand og begrænset autonomi.
 *
 * Dækker de fem acceptkriterier direkte i koden:
 *   1. skyggetilstand udfører nul muterende handlinger,
 *   2. replay af historiske hændelser giver målbare resultater,
 *   3. model-/promptskifte kræver gentaget evaluering,
 *   4. nødstop og governance-nedbrud stopper handlinger,
 *   5. udvidelse af autonomi er en versionsstyret ejerbeslutning med evidens.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createKillSwitch } from "../../credentials/src/kill-switch.mjs";
import { digestOf } from "../../runtime/src/digest.mjs";
import { createAutonomyRegister, createShadowRunner, modelFingerprint } from "../src/shadow.mjs";

const promptDigest = digestOf({ prompt: "test@1" });
const fingerprint = modelFingerprint({ modelRef: "model-a", promptDigest });

function makeRun(id, signal, anomalyScore, { proposedVerb = null, realIncident = true, correctAction = "scale", humanDecision = null } = {}) {
  return {
    id,
    at: "2025-09-01T00:00:00Z",
    kind: "alert",
    severity: "warning",
    target: "service/svc-1",
    tenantId: "tenant-1",
    modelObservation: { signal, anomalyScore, proposedVerb, parameters: {} },
    groundTruth: { realIncident, correctAction },
    humanDecision: humanDecision ?? { verdict: "none", by: null, at: null, rationale: null },
    estimatedTokens: 1000,
  };
}

function passingRun(overrides = {}) {
  return { runId: "r", fingerprint, at: "2025-09-01T00:00:00Z", events: 48, falseAlarmRate: 0, errorRate: 0, escalationRate: 0, costEur: 0.1, reviewerFindings: 0, passed: true, reasons: [], ...overrides };
}

function makeGrant(overrides = {}) {
  return {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "AutonomyGrant",
    metadata: { name: "test", version: "1.1.0", description: "testbevilling til enhedstest", labels: {} },
    owner: { subject: "oidc|anna.andersen", name: "Anna Andersen", role: "Platform Owner" },
    level: "limited-autonomy",
    scope: { environment: "staging", tenants: ["*"], runbooks: ["stateless-restart@1.0.0", "bounded-scale@1.0.0"], verbs: ["restart", "scale"], reversibilityRequired: true, humanApprovalForMutations: true, maxBlastRadius: "single-service" },
    evaluation: { fingerprint, modelRef: "model-a", promptDigest, gatewayRef: null, datasetRef: "shadow/replay-dataset.json", minReplayEvents: 1, minEvaluationRuns: 3, thresholds: { maxFalseAlarmRate: 0.1, maxErrorRate: 0.1, maxEscalationRate: 0.5, maxCostEur: 1, maxReviewerFindings: 5 }, runs: [passingRun(), passingRun(), passingRun()], passed: true },
    governance: { requiresKillSwitch: true, requiresGovernance: true, killSwitchRef: "x", auditRef: "y" },
    approvedAt: "2025-09-01T00:00:00Z",
    expiresAt: "2999-01-01T00:00:00Z",
    changeRef: "change-1",
    supersedes: null,
    history: [{ version: "1.1.0", level: "limited-autonomy", at: "2025-09-01T00:00:00Z", by: "oidc|anna.andersen", changeRef: "change-1" }],
    ...overrides,
  };
}

const dataset = {
  events: [
    makeRun("e1", "cpu-saturation", 0.9, { proposedVerb: "scale", correctAction: "scale" }),
    makeRun("e2", "memory-pressure", 0.88, { proposedVerb: "restart", correctAction: "restart" }),
    makeRun("e3", "schema-drift", 0.95, { proposedVerb: "migrate", correctAction: "migrate" }),
    makeRun("e4", "config-drift", 0.9, { proposedVerb: "config.apply", correctAction: "config.apply" }),
    makeRun("e5", "config-drift", 0.8, { proposedVerb: "config.apply", realIncident: false, correctAction: "diagnose" }),
    makeRun("e6", "ambiguous", 0.9, { proposedVerb: "diagnose", correctAction: "diagnose" }),
  ],
};

/* 1. Skyggetilstand udfører nul muterende handlinger. */
test("skyggetilstand udfører nul muterende handlinger, selv når forslaget er muterende", async () => {
  const register = createAutonomyRegister(makeGrant());
  let executorCalls = 0;
  const runner = createShadowRunner({ register, executor: async () => { executorCalls += 1; } });
  const run = await runner.run({ dataset, mode: "shadow", environment: "replay", generatedAt: "2025-09-01T00:00:00Z" });
  assert.equal(run.mutationCount, 0);
  assert.equal(executorCalls, 0);
  assert.equal(run.decisions.every((d) => d.execution.executed === false), true);
  assert.equal(run.safety.zeroMutationInvariant, true);
  assert.equal(run.verdict, "pass");
});

/* 2. Replay giver målbare resultater. */
test("replay af historiske hændelser giver målbare resultater", async () => {
  const register = createAutonomyRegister(makeGrant());
  const runner = createShadowRunner({ register });
  const run = await runner.run({ dataset, mode: "shadow", environment: "replay", generatedAt: "2025-09-01T00:00:00Z" });
  assert.equal(run.eventsReplayed, 6);
  assert.equal(run.metrics.falseAlarms, 1);
  assert.equal(run.metrics.errors, 0);
  assert.ok(run.metrics.costEur > 0);
  assert.ok(run.metrics.escalationRate > 0);
  assert.equal(typeof run.metrics.reviewerFindings, "number");
});

/* 3. Model-/promptskifte kræver gentaget evaluering. */
test("et nyt model-/promptfingeraftryk kræver gentaget evaluering", () => {
  const register = createAutonomyRegister(makeGrant());
  const changed = modelFingerprint({ modelRef: "model-b", promptDigest });
  const denied = register.assertAllowed({ fingerprint: changed, level: "limited-autonomy", environment: "staging", runbookRef: "stateless-restart@1.0.0", verb: "restart" });
  assert.equal(denied.ok, false);
  assert.ok(denied.reasons.some((r) => r.includes("fingeraftryk")));

  const oneRun = register.evaluate({ fingerprint: changed, results: [passingRun({ fingerprint: changed })] });
  assert.equal(oneRun.ok, false);
  assert.ok(oneRun.reasons.some((r) => r.includes("mindst 3")));

  const threeRuns = register.evaluate({ fingerprint: changed, results: [passingRun({ fingerprint: changed }), passingRun({ fingerprint: changed, runId: "r2" }), passingRun({ fingerprint: changed, runId: "r3" })] });
  assert.equal(threeRuns.ok, true);
});

/* 4a. Nødstop stopper handlinger. */
test("et aktivt nødstop stopper begrænset autonomi uden at udføre noget", async () => {
  const register = createAutonomyRegister(makeGrant());
  const killSwitch = createKillSwitch();
  killSwitch.activate({ scope: "global", principal: { kind: "human", id: "oidc|sec", roles: ["platform-admin"] } });
  let executorCalls = 0;
  const runner = createShadowRunner({ register, killSwitch, governance: { available: true }, executor: async () => { executorCalls += 1; } });
  const run = await runner.run({ dataset, mode: "limited-autonomy", environment: "staging", generatedAt: "2025-09-01T00:00:00Z" });
  assert.equal(run.halted, true);
  assert.equal(run.mutationCount, 0);
  assert.equal(executorCalls, 0);
  assert.equal(run.safety.killSwitchClear, false);
});

/* 4b. Governance-nedbrud stopper handlinger. */
test("et governance-nedbrud stopper begrænset autonomi uden at udføre noget", async () => {
  const register = createAutonomyRegister(makeGrant());
  let executorCalls = 0;
  const runner = createShadowRunner({ register, governance: { available: false }, executor: async () => { executorCalls += 1; } });
  const run = await runner.run({ dataset, mode: "limited-autonomy", environment: "staging", generatedAt: "2025-09-01T00:00:00Z" });
  assert.equal(run.halted, true);
  assert.equal(run.mutationCount, 0);
  assert.equal(executorCalls, 0);
  assert.equal(run.safety.governanceAvailable, false);
});

/* Begrænset autonomi udfører kun godkendte, reversible runbooks i staging. */
test("begrænset autonomi udfører kun forhåndsgodkendte, reversible runbooks", async () => {
  const register = createAutonomyRegister(makeGrant());
  const executions = [];
  const runner = createShadowRunner({ register, governance: { available: true }, executor: async ({ proposal }) => { executions.push(proposal.verb); return { ok: true }; } });
  const run = await runner.run({ dataset, mode: "limited-autonomy", environment: "staging", generatedAt: "2025-09-01T00:00:00Z" });
  assert.equal(executions.includes("migrate"), false, "irreversibel handling må ikke udføres");
  assert.equal(executions.includes("config.apply"), false, "runbook uden for bevillingen må ikke udføres");
  assert.deepEqual(executions.sort(), ["restart", "scale"]);
  assert.equal(run.halted, false);
  assert.equal(run.safety.approvedRunbooksOnly, true);
});

test("begrænset autonomi afvises når miljøet ikke er staging", async () => {
  const register = createAutonomyRegister(makeGrant());
  let executorCalls = 0;
  const runner = createShadowRunner({ register, executor: async () => { executorCalls += 1; } });
  const run = await runner.run({ dataset, mode: "limited-autonomy", environment: "replay", generatedAt: "2025-09-01T00:00:00Z" });
  assert.equal(executorCalls, 0);
  assert.equal(run.mutationCount, 0);
});

/* 5. Udvidelse af autonomi er en versionsstyret ejerbeslutning med evidens. */
test("udvidelse af autonomi kræver navngivet ejer, change-reference og gentaget evidens", () => {
  const register = createAutonomyRegister(makeGrant({ level: "shadow", scope: { ...makeGrant().scope, environment: "replay" }, history: [{ version: "1.0.0", level: "shadow", at: "2025-09-01T00:00:00Z", by: "oidc|anna.andersen", changeRef: "change-0" }], metadata: { name: "test", version: "1.0.0", description: "testbevilling til enhedstest", labels: {} } }));
  const noEvidence = register.expand({ toLevel: "limited-autonomy", owner: { subject: "oidc|anna.andersen", name: "Anna Andersen", role: "Platform Owner" }, evaluationRuns: [], changeRef: "change-1" });
  assert.equal(noEvidence.ok, false);

  const expanded = register.expand({
    toLevel: "limited-autonomy",
    owner: { subject: "oidc|anna.andersen", name: "Anna Andersen", role: "Platform Owner" },
    evaluationRuns: [passingRun(), passingRun(), passingRun()],
    changeRef: "change-1",
    approvedAt: "2025-09-15T00:00:00Z",
    expiresAt: "2999-01-01T00:00:00Z",
  });
  assert.equal(expanded.ok, true, JSON.stringify(expanded.problems));
  assert.equal(expanded.grant.metadata.version, "1.1.0");
  assert.equal(expanded.grant.level, "limited-autonomy");
  assert.equal(expanded.grant.supersedes, "1.0.0");
  assert.equal(expanded.grant.history.length, 2);

  const noHuman = register.expand({ toLevel: "limited-autonomy", owner: { subject: "agent|bot", name: "Bot", role: "agent" }, evaluationRuns: [passingRun(), passingRun(), passingRun()], changeRef: "change-1" });
  assert.equal(noHuman.ok, false);
});

test("en udløbet bevilling afviser handlinger", () => {
  const register = createAutonomyRegister(makeGrant({ expiresAt: "2000-01-01T00:00:00Z" }));
  const result = register.assertAllowed({ fingerprint, level: "limited-autonomy", environment: "staging", runbookRef: "stateless-restart@1.0.0", verb: "restart" });
  assert.equal(result.ok, false);
  assert.ok(result.reasons.some((r) => r.includes("udløbet")));
});
