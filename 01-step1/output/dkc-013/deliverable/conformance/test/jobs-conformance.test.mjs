/**
 * DKC-013 — accepttests for genoptagelig og idempotent eksekvering.
 *
 * Scenariebaseret konformans på tværs af runtime, handlingsklassifikation,
 * holdbar jobkø og worker:
 *   1. genstart midt i backup/upgrade/eksport giver sporbart slutresultat,
 *   2. samme job leveret flere gange udfører ikke irreversible ændringer flere gange,
 *   3. retry bruger ny policykontrol og gyldig godkendelse,
 *   4. et irreversibelt unknown outcome eskaleres frem for blind retry.
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
import { createJobQueue, createJobRunner } from "../../jobs/src/index.mjs";

const baseManifest = JSON.parse(readFileSync(new URL("../../modules/dummy-ok/agents/backup-agent.json", import.meta.url), "utf8"));

function manifestWith(extra) {
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

function fixture({ manifest, executors, pdp = null, approvalVerifier = null }) {
  const dir = mkdtempSync(join(tmpdir(), "dkc-jobs-conformance-"));
  let now = Date.now();
  let db = openDatabase({ path: join(dir, "runtime.db") });
  migrateDatabase(db);
  const decide = pdp ?? (async (input) => validDecision(input, { requiredEvidence: ["policy-allow"] }));
  const build = () => {
    const audit = createSqliteAuditLog({ db });
    const journal = createSqliteActionJournal({ db, audit });
    const runtime = createAgentRuntime({
      manifest,
      pdp: { decide },
      auditLog: createMemoryAuditLog(),
      actionJournal: journal,
      executors,
      ...(approvalVerifier ? { approvalVerifier } : {}),
    });
    return { journal, runtime, queue: createJobQueue({ db, clock: () => now }) };
  };
  return {
    ...build(),
    advance(ms) { now += ms; },
    restart() {
      db.close();
      db = openDatabase({ path: join(dir, "runtime.db") });
      return build();
    },
    cleanup() {
      try { db.close(); } catch { /* ignore */ }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("1. genstart midt i et job giver et sporbart slutresultat", async () => {
  const calls = [];
  const executors = { restart: async () => { calls.push("restart"); if (calls.length === 1) throw new Error("connect ECONNRESET"); return { summary: "ok" }; } };
  const f = fixture({ manifest: manifestWith([{ verb: "restart", target: "dummy-ok", autonomyClass: "A0", requiredEvidence: ["policy-allow"] }]), executors });
  try {
    f.queue.submit("acme", { id: "j1", kind: "task", idempotencyKey: "j1", payload: { task: taskFor("restart", "j1") } });
    const runner = createJobRunner({ queue: f.queue, runtime: f.runtime });
    assert.equal((await runner.runOnce({ tenantId: "acme" })).status, "retry-scheduled");

    f.advance(120_000);
    const restarted = f.restart();
    const runner2 = createJobRunner({ queue: restarted.queue, runtime: restarted.runtime });
    assert.equal((await runner2.runOnce({ tenantId: "acme" })).status, "completed");

    const job = restarted.queue.get("acme", "j1");
    assert.equal(job.status, "completed");
    assert.equal(job.attempts, 2);
    const attempts = restarted.queue.attempts("acme", "j1");
    assert.deepEqual(attempts.map((a) => a.state), ["failed", "succeeded"]);
  } finally {
    f.cleanup();
  }
});

test("2. samme job leveret flere gange udfører ikke irreversible ændringer flere gange", async () => {
  const calls = [];
  const executors = { restore: async () => { calls.push("restore"); return { summary: "restored" }; } };
  const f = fixture({ manifest: manifestWith([{ verb: "restore", target: "dummy-ok", autonomyClass: "A0", requiredEvidence: ["policy-allow"] }]), executors });
  try {
    const submit = () => f.queue.submit("acme", { id: "j2", kind: "task", idempotencyKey: "j2", payload: { task: taskFor("restore", "j2") } });
    submit();
    const runner = createJobRunner({ queue: f.queue, runtime: f.runtime });
    assert.equal((await runner.runOnce({ tenantId: "acme" })).status, "completed");
    assert.equal(submit().deduplicated, true);
    assert.equal((await runner.runOnce({ tenantId: "acme" })).status, "idle");
    assert.deepEqual(calls, ["restore"]);
  } finally {
    f.cleanup();
  }
});

test("3. retry bruger ny policykontrol og gyldig godkendelse", async () => {
  const pdpCalls = [];
  const approvals = [];
  const usedExecutions = new Set();
  const calls = [];
  const executors = { restart: async () => { calls.push("restart"); if (calls.length === 1) throw new Error("HTTP 503 service unavailable"); return { summary: "ok" }; } };
  const approvalVerifier = {
    authorizeExecution: async ({ approvalId, executionId }) => {
      approvals.push({ approvalId, executionId });
      if (usedExecutions.has(executionId)) return { ok: false, reasons: ["executionId allerede brugt"] };
      usedExecutions.add(executionId);
      return { ok: true, approvalId, bindingDigest: "x" };
    },
  };
  const f = fixture({
    manifest: manifestWith([{ verb: "restart", target: "dummy-ok", autonomyClass: "A3", requiredEvidence: ["policy-allow"] }]),
    executors,
    approvalVerifier,
    pdp: async (input) => { pdpCalls.push(input); return validDecision(input, { decision: "allow-with-approval", requiredApprovals: 1, requiredEvidence: ["policy-allow"] }); },
  });
  try {
    f.queue.submit("acme", { id: "j3", kind: "task", idempotencyKey: "j3", payload: { task: taskFor("restart", "j3") } });
    let seq = 0;
    const authorizationProvider = async ({ job, attempt }) => ({ approvalId: `appr-${job.id}-${attempt}`, executionId: `exec-${job.id}-${attempt}-${++seq}` });
    const runner = createJobRunner({ queue: f.queue, runtime: f.runtime, authorizationProvider });
    assert.equal((await runner.runOnce({ tenantId: "acme" })).status, "retry-scheduled");
    f.advance(120_000);
    assert.equal((await runner.runOnce({ tenantId: "acme" })).status, "completed");
    assert.equal(pdpCalls.length, 2, "PDP skal spørges pr. forsøg");
    assert.equal(approvals.length, 2, "godkendelsen skal verificeres pr. forsøg");
    assert.notEqual(approvals[0].executionId, approvals[1].executionId);
    assert.equal(usedExecutions.size, 2);
  } finally {
    f.cleanup();
  }
});

test("4. et irreversibelt unknown outcome eskaleres frem for blind retry", async () => {
  const calls = [];
  const executors = { restore: async () => { calls.push("restore"); return { summary: "restored" }; } };
  // Journal hvor outcome-skrivningen fejler, så runtimen rapporterer `unknown`.
  const dir = mkdtempSync(join(tmpdir(), "dkc-jobs-conformance-unknown-"));
  const db = openDatabase({ path: join(dir, "runtime.db") });
  try {
    migrateDatabase(db);
    const audit = createSqliteAuditLog({ db });
    const real = createSqliteActionJournal({ db, audit });
    const journal = { ...real, complete: async () => { throw new Error("audit outcome utilgængelig"); } };
    const manifest = manifestWith([{ verb: "restore", target: "dummy-ok", autonomyClass: "A0", requiredEvidence: ["policy-allow"] }]);
    const runtime = createAgentRuntime({
      manifest,
      pdp: { decide: async (input) => validDecision(input, { requiredEvidence: ["policy-allow"] }) },
      auditLog: createMemoryAuditLog(),
      actionJournal: journal,
      executors,
    });
    const queue = createJobQueue({ db });
    queue.submit("acme", { id: "j4", kind: "task", idempotencyKey: "j4", payload: { task: taskFor("restore", "j4") } });
    const runner = createJobRunner({ queue, runtime });
    const result = await runner.runOnce({ tenantId: "acme" });
    assert.equal(result.status, "dead-letter", JSON.stringify(result));
    assert.equal(calls.length, 1, "den irreversible ændring må ikke gentages");
    assert.match(queue.get("acme", "j4").dead_letter_reason, /irreversibel/i);
  } finally {
    try { db.close(); } catch { /* ignore */ }
    rmSync(dir, { recursive: true, force: true });
  }
});
