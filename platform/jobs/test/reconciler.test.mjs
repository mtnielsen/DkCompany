/**
 * DKC-013 — reconciliation og kompensation.
 *
 * Beviser:
 *   - et irreversibelt `unknown` outcome eskaleres til dead-letter i stedet for
 *     at blive gentaget blindt,
 *   - et intakt `pending` intent fra et tidligere forsøg reconcileres før et nyt
 *     forsøg, så en irreversibel ændring ikke udføres to gange,
 *   - en reversibel handling med et ukendt outcome kompenseres hvor muligt.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../persistence/src/db.mjs";
import { migrateDatabase } from "../../persistence/src/identities.mjs";
import { createSqliteAuditLog } from "../../persistence/src/adapters/audit.mjs";
import { createSqliteActionJournal } from "../../persistence/src/adapters/audit-journal.mjs";
import { createAgentRuntime } from "../../runtime/src/runtime.mjs";
import { createMemoryAuditLog } from "../../runtime/src/clients.mjs";
import { validDecision } from "../../runtime/test/pdp-fixtures.mjs";
import { createJobQueue } from "../src/queue.mjs";
import { createJobRunner } from "../src/runner.mjs";
import { createJobReconciler } from "../src/reconciler.mjs";

const baseManifest = JSON.parse(readFileSync(new URL("../../modules/dummy-ok/agents/backup-agent.json", import.meta.url), "utf8"));

function manifestWith(extra = []) {
  const manifest = structuredClone(baseManifest);
  manifest.capabilities.push(...extra);
  return manifest;
}

function taskFor(verb, taskId) {
  return {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "AgentTask",
    taskId,
    tenantId: "acme",
    agentRef: baseManifest.metadata.name,
    objective: `dkc-013 ${verb}`,
    actions: [{ verb, target: "dummy-ok", environment: "staging", evidence: ["policy-allow"] }],
  };
}

function setup({ manifest, executors, journalFactory }) {
  const dir = mkdtempSync(join(tmpdir(), "dkc-jobs-recon-"));
  let now = Date.now();
  const db = openDatabase({ path: join(dir, "runtime.db") });
  migrateDatabase(db);
  const audit = createSqliteAuditLog({ db });
  const journal = journalFactory ? journalFactory({ db, audit }) : createSqliteActionJournal({ db, audit });
  const runtime = createAgentRuntime({
    manifest,
    pdp: { decide: async (input) => validDecision(input, { requiredEvidence: ["policy-allow"] }) },
    auditLog: createMemoryAuditLog(),
    actionJournal: journal,
    executors,
  });
  const queue = createJobQueue({ db, clock: () => now });
  return { dir, db, journal, runtime, queue, advance: (ms) => { now += ms; return now; }, cleanup: () => { try { db.close(); } catch { /* ignore */ } rmSync(dir, { recursive: true, force: true }); } };
}

test("et irreversibelt unknown outcome eskaleres frem for blind retry", async () => {
  const calls = [];
  const executors = { restore: async () => { calls.push("restore"); return { summary: "restored" }; } };
  const manifest = manifestWith([{ verb: "restore", target: "dummy-ok", autonomyClass: "A0", requiredEvidence: ["policy-allow"] }]);
  const f = setup({
    manifest,
    executors,
    // Outcome-skrivningen fejler, så runtimen rapporterer `unknown`.
    journalFactory: ({ db, audit }) => {
      const real = createSqliteActionJournal({ db, audit });
      return { ...real, complete: async () => { throw new Error("audit outcome utilgængelig"); } };
    },
  });
  try {
    f.queue.submit("acme", { id: "irr-unknown", kind: "task", idempotencyKey: "irr-unknown", payload: { task: taskFor("restore", "irr-unknown") } });
    const runner = createJobRunner({ queue: f.queue, runtime: f.runtime });
    const result = await runner.runOnce({ tenantId: "acme" });
    assert.equal(result.status, "dead-letter", JSON.stringify(result));
    assert.equal(calls.length, 1, "executoren må ikke kaldes igen");
    const job = f.queue.get("acme", "irr-unknown");
    assert.equal(job.status, "dead-letter");
    assert.match(job.dead_letter_reason, /irreversibel/i);
    assert.equal(f.queue.deadLetters("acme").length, 1);
  } finally {
    f.cleanup();
  }
});

test("et intakt pending intent fra et tidligere forsøg reconcileres før et nyt", async () => {
  const calls = [];
  const executors = { restore: async () => { calls.push("restore"); return { summary: "restored" }; } };
  const manifest = manifestWith([{ verb: "restore", target: "dummy-ok", autonomyClass: "A0", requiredEvidence: ["policy-allow"] }]);
  const f = setup({ manifest, executors });
  try {
    f.queue.submit("acme", { id: "irr-crash", kind: "task", idempotencyKey: "irr-crash", payload: { task: taskFor("restore", "irr-crash") }, maxAttempts: 3 });
    // Simulér at en worker leasde jobbet, skrev intentet og derefter døde.
    const leased = f.queue.lease("acme", "worker-a");
    assert.equal(leased.id, "irr-crash");
    await f.journal.begin({ tenantId: "acme", idempotencyId: "irr-crash:a1:0", verb: "restore", target: "dummy-ok" });

    // Genstart: lease udløber, jobbet genåbnes, en ny worker leaser.
    f.advance(120_000);
    const reopened = f.queue.recoverStaleLeases({ olderThanMs: 60_000 });
    assert.equal(reopened.length, 1);

    const runner = createJobRunner({ queue: f.queue, runtime: f.runtime, reconciler: createJobReconciler({ journal: f.journal, queue: f.queue }) });
    const result = await runner.runOnce({ tenantId: "acme" });
    assert.equal(result.status, "dead-letter", JSON.stringify(result));
    assert.deepEqual(calls, [], "en irreversibel ændring må ikke genudføres efter et pending intent");
    assert.match(f.queue.get("acme", "irr-crash").dead_letter_reason, /irreversibelt unknown/i);
  } finally {
    f.cleanup();
  }
});

test("en reversibel handling med ukendt outcome kompenseres hvor muligt", async () => {
  const executors = {
    "config.apply": async () => ({ summary: "configured" }),
    rollback: async () => ({ summary: "rolled back" }),
  };
  const manifest = manifestWith([
    { verb: "config.apply", target: "dummy-ok", autonomyClass: "A0", requiredEvidence: ["policy-allow"] },
    { verb: "rollback", target: "dummy-ok", autonomyClass: "A0", requiredEvidence: ["policy-allow"] },
  ]);
  const f = setup({ manifest, executors });
  try {
    f.queue.submit("acme", { id: "rev-unknown", kind: "task", idempotencyKey: "rev-unknown", payload: { task: taskFor("config.apply", "rev-unknown") }, maxAttempts: 3 });
    const leased = f.queue.lease("acme", "worker-a");
    assert.equal(leased.id, "rev-unknown");
    await f.journal.begin({ tenantId: "acme", idempotencyId: "rev-unknown:a1:0", verb: "config.apply", target: "dummy-ok" });
    f.advance(120_000);
    f.queue.recoverStaleLeases({ olderThanMs: 60_000 });

    const reconciler = createJobReconciler({ journal: f.journal, queue: f.queue });
    const runner = createJobRunner({ queue: f.queue, runtime: f.runtime, reconciler });
    const result = await runner.runOnce({ tenantId: "acme" });
    assert.equal(result.status, "compensated", JSON.stringify(result));
    const job = f.queue.get("acme", "rev-unknown");
    assert.equal(job.status, "completed");
    assert.equal(job.result.compensated, "rollback");
    const compensation = f.queue.getByIdempotencyKey("acme", "compensation:rev-unknown");
    assert.ok(compensation, "en kompensationshandling skulle være indsat");
    assert.equal(compensation.payload.task.actions[0].verb, "rollback");
    assert.equal(compensation.classification, "reversible-write");
  } finally {
    f.cleanup();
  }
});
