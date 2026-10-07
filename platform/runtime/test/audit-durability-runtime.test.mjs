/**
 * DKC-009 — agent-runtimens fail-closed audit-protokol.
 *
 * Beviser at runtimen skriver en holdbar intent-kvittering før nogen ekstern
 * ændring, at et utilgængeligt audit stoppper alt, at et crash mellem intent og
 * outcome giver `unknown` uden genudførelse, og at et allerede afsluttet intent
 * afspilles i stedet for at køre igen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createAgentRuntime } from "../src/runtime.mjs";
import { createMemoryActionJournal, createMemoryAuditLog, AuditUnavailable } from "../src/clients.mjs";
import { createReconciler } from "../src/reconcile.mjs";
import { evidenceFixture } from "./evidence-fixtures.mjs";
import { validDecision } from "./pdp-fixtures.mjs";

const manifest = JSON.parse(readFileSync(new URL("../../modules/dummy-ok/agents/backup-agent.json", import.meta.url), "utf8"));
const EVIDENCE = evidenceFixture(["tests-pass", "dry-run-clean", "rollback-tested", "restore-verified", "scan-clean"]);

const task = (actions, extra = {}) => ({ apiVersion: "contracts.platform/v1alpha1", kind: "AgentTask", taskId: randomUUID(), tenantId: "acme", agentRef: manifest.metadata.name, objective: "test", evidenceIndex: EVIDENCE.index, actions, ...extra });
const action = (verb, extra = {}) => ({ verb, target: extra.target ?? "dummy-ok", environment: "staging", ...extra });
const allowPdp = () => ({ decide: async (input) => validDecision(input, { requiredEvidence: ["policy-allow"] }) });

function executors(record = []) {
  return {
    "observe.read": async () => { record.push("observe.read"); return { summary: "read" }; },
    "upgrade.dry-run": async () => { record.push("upgrade.dry-run"); return { summary: "clean" }; },
  };
}

function makeRuntime({ journal, record = [], auditLog = createMemoryAuditLog() } = {}) {
  return createAgentRuntime({ manifest, pdp: allowPdp(), auditLog, actionJournal: journal, executors: executors(record) });
}

test("intent-kvittering skrives før executor og outcome bagefter", async () => {
  const record = [];
  const journal = createMemoryActionJournal();
  const runtime = makeRuntime({ journal, record });
  const result = await runtime.runTask(task([action("upgrade.dry-run", { idempotencyId: "idem-ok", evidence: ["tests-pass"] })]));
  assert.equal(result.status, "completed");
  assert.deepEqual(record, ["upgrade.dry-run"]);
  const phases = journal.events.map((e) => e.phase);
  assert.deepEqual(phases, ["intent", "outcome"]);
  assert.equal(journal.events[0].intentId, journal.events[1].intentId);
  assert.equal(journal.events[1].outcome, "succeeded");
});

test("utilgængeligt audit før handling giver nul eksterne ændringer", async () => {
  const record = [];
  const journal = createMemoryActionJournal({ fail: true });
  const runtime = makeRuntime({ journal, record });
  const result = await runtime.runTask(task([action("upgrade.dry-run", { idempotencyId: "idem-fail", evidence: ["tests-pass"] })]));
  assert.equal(result.status, "halted");
  assert.match(result.reason, /audit-log utilgængelig/);
  assert.deepEqual(record, [], "executoren må ikke kaldes når audit er utilgængelig");
});

test("crash mellem intent og outcome giver unknown uden genudførelse", async () => {
  const record = [];
  const journal = createMemoryActionJournal();
  // Simulér at processen døde efter intentet blev committet.
  await journal.begin({ tenantId: "acme", idempotencyId: "idem-crash", verb: "upgrade.dry-run", target: "dummy-ok" });
  const runtime = makeRuntime({ journal, record });
  const result = await runtime.runTask(task([action("upgrade.dry-run", { idempotencyId: "idem-crash", evidence: ["tests-pass"] })]));
  assert.equal(result.status, "unknown");
  assert.match(result.reason, /reconciliation/);
  assert.deepEqual(record, [], "et pending intent må ikke føre til en ny eksekvering");
});

test("et afsluttet intent afspilles uden at eksekvere igen", async () => {
  const record = [];
  const journal = createMemoryActionJournal();
  await journal.begin({ tenantId: "acme", idempotencyId: "idem-done", verb: "upgrade.dry-run", target: "dummy-ok" });
  await journal.complete({ tenantId: "acme", idempotencyId: "idem-done", outcome: "succeeded", result: { summary: "allerede kørt" } });
  const runtime = makeRuntime({ journal, record });
  const result = await runtime.runTask(task([action("upgrade.dry-run", { idempotencyId: "idem-done", evidence: ["tests-pass"] })]));
  assert.equal(result.status, "completed");
  assert.deepEqual(record, [], "den eksterne ændring må ikke gentages");
  assert.deepEqual(result.replayedOutcome, { result: { summary: "allerede kørt" }, error: null });
});

test("manglende outcome efter udførelse giver unknown, ikke falsk success", async () => {
  const record = [];
  const journal = createMemoryActionJournal();
  const failing = { ...journal, complete: async () => { throw new AuditUnavailable("audit-log utilgængelig (outcome)"); } };
  const runtime = makeRuntime({ journal: failing, record });
  const result = await runtime.runTask(task([action("upgrade.dry-run", { idempotencyId: "idem-noout", evidence: ["tests-pass"] })]));
  assert.equal(result.status, "unknown");
  assert.match(result.reason, /outcome kunne ikke logges/);
  assert.deepEqual(record, ["upgrade.dry-run"], "handlingen blev udført, men må ikke rapporteres som success");
});

test("reconciliation afgør et pending intent via en resolver", async () => {
  const journal = createMemoryActionJournal();
  await journal.begin({ tenantId: "acme", idempotencyId: "idem-rec", verb: "restore", target: "dummy-ok" });
  const reconciler = createReconciler({ journal, resolvers: { restore: () => ({ outcome: "succeeded", result: { verified: true } }) } });
  const report = await reconciler.reconcileAll({ tenantId: "acme" });
  assert.equal(report.count, 1);
  assert.equal(report.results[0].result.state, "succeeded");
  assert.equal((await journal.lookup({ tenantId: "acme", idempotencyId: "idem-rec" })).state, "succeeded");
});
