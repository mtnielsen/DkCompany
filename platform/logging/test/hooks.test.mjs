import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createAgentRuntime } from "../../runtime/src/runtime.mjs";
import { createLogLedger } from "../src/ledger.mjs";
import { createRuntimeLogObserver, createAuditLogObserver } from "../src/hooks.mjs";
import { makeAuditLog, POLICY, makeCorrelation } from "./support/fixture.mjs";
import { evidenceFixture } from "../../runtime/test/evidence-fixtures.mjs";
import { validDecision } from "../../runtime/test/pdp-fixtures.mjs";

const manifest = JSON.parse(readFileSync(new URL("../../modules/dummy-ok/agents/backup-agent.json", import.meta.url), "utf8"));
const EVIDENCE = evidenceFixture(["tests-pass", "dry-run-clean", "rollback-tested", "restore-verified", "scan-clean"]);

test("runtimen kalder observatøren og lægger korrelerede logposter", async () => {
  const audit = makeAuditLog();
  const ledger = createLogLedger({ audit });
  const observer = createRuntimeLogObserver({ ledger, manifest, policy: POLICY });
  const runtime = createAgentRuntime({
    manifest,
    pdp: { decide: async (input) => validDecision(input, { requiredEvidence: ["policy-allow"] }) },
    auditLog: audit,
    executors: { "upgrade.dry-run": async () => ({ summary: "clean", tokens: 5, costEur: 0.001 }) },
    logObserver: observer,
  });
  const task = {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "AgentTask",
    taskId: randomUUID(),
    tenantId: "acme",
    agentRef: manifest.metadata.name,
    objective: "test",
    evidenceIndex: EVIDENCE.index,
    actions: [{ verb: "upgrade.dry-run", target: "dummy-ok", environment: "staging", evidence: ["tests-pass"] }],
  };
  const result = await runtime.runTask(task);
  assert.equal(result.status, "completed");

  const records = await ledger.read({ tenantId: "acme" });
  assert.ok(records.length >= 4, `forventede mindst 4 logposter, fik ${records.length}`);
  // Alle poster deler samme korrelation.
  const correlationIds = new Set(records.map((r) => r.correlation.correlationId));
  assert.equal(correlationIds.size, 1);
  // Provenance er adskilt: system-beslutninger og et verificeret outcome.
  assert.ok(records.some((r) => r.provenance === "system" && r.observation.value.decision));
  const verified = records.find((r) => r.provenance === "verified");
  assert.ok(verified);
  assert.equal(verified.verification.result, "pass");
});

test("audit-service-observatøren lægger en korreleret systempost", async () => {
  const audit = makeAuditLog();
  const ledger = createLogLedger({ audit });
  const observer = createAuditLogObserver({ ledger, policy: POLICY });
  const correlation = makeCorrelation();
  await observer({ phase: "policy.denied", correlation, tenantId: "acme", verb: "upgrade", target: "res://acme/service/audit-service", reason: "policy deny", auditEventId: "evt-1" });
  const records = await ledger.read({ tenantId: "acme" });
  assert.equal(records.length, 1);
  assert.equal(records[0].provenance, "system");
  assert.equal(records[0].observation.source, "observer:policy.denied");
  assert.equal(records[0].correlation.correlationId, correlation.correlationId);
});

test("en observer-fejl påvirker ikke runtime-resultatet", async () => {
  const audit = makeAuditLog();
  const runtime = createAgentRuntime({
    manifest,
    pdp: { decide: async (input) => validDecision(input, { requiredEvidence: ["policy-allow"] }) },
    auditLog: audit,
    executors: { "upgrade.dry-run": async () => ({ summary: "clean" }) },
    logObserver: async () => { throw new Error("loggen er nede"); },
  });
  const task = {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "AgentTask",
    taskId: randomUUID(),
    tenantId: "acme",
    agentRef: manifest.metadata.name,
    objective: "test",
    evidenceIndex: EVIDENCE.index,
    actions: [{ verb: "upgrade.dry-run", target: "dummy-ok", environment: "staging", evidence: ["tests-pass"] }],
  };
  const result = await runtime.runTask(task);
  assert.equal(result.status, "completed");
});
