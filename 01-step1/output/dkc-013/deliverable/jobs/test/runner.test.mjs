/**
 * DKC-013 — accepttests for genoptagelig og idempotent eksekvering.
 *
 * Beviser:
 *   - genstart midt i et job giver et sporbart slutresultat (forsøgssporet),
 *   - samme job leveret flere gange udfører ikke en irreversibel ændring flere gange,
 *   - en retry får en ny policykontrol og en ny, gyldig godkendelse.
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

const baseManifest = JSON.parse(readFileSync(new URL("../../modules/dummy-ok/agents/backup-agent.json", import.meta.url), "utf8"));

function manifestWith(extra = []) {
  const manifest = structuredClone(baseManifest);
  manifest.capabilities.push(...extra);
  return manifest;
}

function taskFor(verb, { taskId = "task-1", tenantId = "acme" } = {}) {
  return {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "AgentTask",
    taskId,
    tenantId,
    agentRef: baseManifest.metadata.name,
    objective: `dkc-013 ${verb}`,
    actions: [{ verb, target: "dummy-ok", environment: "staging", evidence: ["policy-allow"] }],
  };
}

function fixture({ manifest = baseManifest, executors = {}, pdp = null, approvalVerifier = null, journal: suppliedJournal = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "dkc-jobs-runner-"));
  let now = Date.now();
  let db = openDatabase({ path: join(dir, "runtime.db") });
  migrateDatabase(db);
  const audit = createSqliteAuditLog({ db });
  const journal = suppliedJournal ?? createSqliteActionJournal({ db, audit });
  const events = [];
  const decide = pdp ?? (async (input) => validDecision(input, { requiredEvidence: ["policy-allow"] }));
  const runtime = createAgentRuntime({
    manifest,
    pdp: { decide },
    auditLog: createMemoryAuditLog(),
    actionJournal: journal,
    executors,
    ...(approvalVerifier ? { approvalVerifier } : {}),
  });
  const queue = createJobQueue({ db, clock: () => now });
  return {
    dir,
    runtime,
    journal,
    queue,
    events,
    advance(ms) { now += ms; return now; },
    reopen() {
      db.close();
      db = openDatabase({ path: join(dir, "runtime.db") });
      const audit2 = createSqliteAuditLog({ db });
      const journal2 = createSqliteActionJournal({ db, audit: audit2 });
      const runtime2 = createAgentRuntime({
        manifest,
        pdp: { decide },
        auditLog: createMemoryAuditLog(),
        actionJournal: journal2,
        executors,
        ...(approvalVerifier ? { approvalVerifier } : {}),
      });
      return { db, journal: journal2, runtime: runtime2, queue: createJobQueue({ db, clock: () => now }) };
    },
    cleanup() {
      try { db.close(); } catch { /* ignore */ }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("genstart midt i et job giver et sporbart slutresultat", async () => {
  const calls = [];
  const executors = {
    restart: async () => {
      calls.push("restart");
      if (calls.length === 1) throw new Error("connect ECONNRESET");
      return { summary: "restarted" };
    },
  };
  const f = fixture({ manifest: manifestWith([{ verb: "restart", target: "dummy-ok", autonomyClass: "A0", requiredEvidence: ["policy-allow"] }]), executors });
  try {
    f.queue.submit("acme", { id: "job-restart", kind: "task", idempotencyKey: "job-restart", payload: { task: taskFor("restart") } });
    const runner = createJobRunner({ queue: f.queue, runtime: f.runtime });
    const first = await runner.runOnce({ tenantId: "acme" });
    assert.equal(first.status, "retry-scheduled", `første forsøg skulle udsættes: ${JSON.stringify(first.decision)}`);

    // Simulér procesgenstart: luk og åbn databasen igen, og lad tiden gå så
    // retry-jobbet er forfaldent.
    f.advance(120_000);
    const reopened = f.reopen();
    const runner2 = createJobRunner({ queue: reopened.queue, runtime: reopened.runtime });
    const second = await runner2.runOnce({ tenantId: "acme" });
    assert.equal(second.status, "completed", JSON.stringify(second));

    const job = reopened.queue.get("acme", "job-restart");
    assert.equal(job.status, "completed");
    assert.equal(job.attempts, 2, "jobbet skulle have to forsøg");
    const attempts = reopened.queue.attempts("acme", "job-restart");
    assert.equal(attempts.length, 2, "forsøgssporet skulle have to rækker");
    assert.equal(attempts[0].state, "failed");
    assert.equal(attempts[1].state, "succeeded");
    assert.deepEqual(calls, ["restart", "restart"], "executoren skulle kaldes pr. forsøg");
  } finally {
    f.cleanup();
  }
});

test("samme job leveret flere gange udfører ikke en irreversibel ændring flere gange", async () => {
  const calls = [];
  const executors = { restore: async () => { calls.push("restore"); return { summary: "restored" }; } };
  const f = fixture({ manifest: manifestWith([{ verb: "restore", target: "dummy-ok", autonomyClass: "A0", requiredEvidence: ["policy-allow"] }]), executors });
  try {
    const submit = () =>
      f.queue.submit("acme", {
        id: "irr-1",
        kind: "task",
        idempotencyKey: "irr-1",
        payload: { task: taskFor("restore", { taskId: "irr-1" }) },
        maxAttempts: 3,
      });
    assert.equal(submit().created, true);
    const runner = createJobRunner({ queue: f.queue, runtime: f.runtime });
    const first = await runner.runOnce({ tenantId: "acme" });
    assert.equal(first.status, "completed");
    assert.deepEqual(calls, ["restore"]);

    // Leveres igen: deduplikeres, leases ikke, udfører intet.
    const again = submit();
    assert.equal(again.deduplicated, true);
    assert.equal(again.job.id, "irr-1");
    const idle = await runner.runOnce({ tenantId: "acme" });
    assert.equal(idle.status, "idle");
    assert.deepEqual(calls, ["restore"], "den irreversible ændring må ikke gentages");
    assert.equal(f.queue.get("acme", "irr-1").status, "completed");
  } finally {
    f.cleanup();
  }
});

test("en retry bruger en ny policykontrol og en ny, gyldig godkendelse", async () => {
  const calls = [];
  const pdpCalls = [];
  const approvals = [];
  const usedExecutions = new Set();
  const executors = {
    restart: async () => {
      calls.push("restart");
      if (calls.length === 1) throw new Error("HTTP 503 service unavailable");
      return { summary: "restarted" };
    },
  };
  const manifest = manifestWith([{ verb: "restart", target: "dummy-ok", autonomyClass: "A3", requiredEvidence: ["policy-allow"] }]);
  const approvalVerifier = {
    authorizeExecution: async ({ approvalId, executionId }) => {
      approvals.push({ approvalId, executionId });
      if (usedExecutions.has(executionId)) return { ok: false, reasons: ["executionId er allerede brugt"] };
      usedExecutions.add(executionId);
      return { ok: true, approvalId, bindingDigest: "x" };
    },
  };
  const f = fixture({
    manifest,
    executors,
    approvalVerifier,
    pdp: async (input) => {
      pdpCalls.push(input);
      return validDecision(input, { decision: "allow-with-approval", requiredApprovals: 1, requiredEvidence: ["policy-allow"] });
    },
  });
  try {
    f.queue.submit("acme", { id: "job-a3", kind: "task", idempotencyKey: "job-a3", payload: { task: taskFor("restart", { taskId: "job-a3" }) } });
    let seq = 0;
    const authorizationProvider = async ({ job, attempt }) => ({ approvalId: `appr-${job.id}-${attempt}`, executionId: `exec-${job.id}-${attempt}-${++seq}` });
    const runner = createJobRunner({ queue: f.queue, runtime: f.runtime, authorizationProvider });

    const first = await runner.runOnce({ tenantId: "acme" });
    assert.equal(first.status, "retry-scheduled", JSON.stringify(first));
    // Gør retry forfaldent og kør igen.
    f.advance(120_000);
    const second = await runner.runOnce({ tenantId: "acme" });
    assert.equal(second.status, "completed", JSON.stringify(second));

    assert.equal(pdpCalls.length, 2, "PDP skulle spørges én gang pr. forsøg");
    assert.equal(approvals.length, 2, "godkendelsen skulle verificeres pr. forsøg");
    assert.notEqual(approvals[0].executionId, approvals[1].executionId, "retry skal bruge et nyt executionId");
    assert.equal(usedExecutions.size, 2, "begge godkendelser skulle være gyldige og unikke");
    assert.deepEqual(calls, ["restart", "restart"]);
    assert.equal(f.queue.get("acme", "job-a3").status, "completed");
  } finally {
    f.cleanup();
  }
});
