/**
 * DKC-008 — agent-runtimens jobtilstand er holdbar.
 *
 * Kører den rigtige runtime med en SQLite-jobstore og beviser at taskens
 * tilstand gemmes undervejs og overlever en genstart. Dette er integrationen
 * mellem persistenslaget og `runtime/src/runtime.mjs`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../src/db.mjs";
import { createMigrator } from "../src/migrations.mjs";
import { createSqliteJobStore } from "../src/adapters/jobs.mjs";
import { createAgentRuntime } from "../../runtime/src/runtime.mjs";
import { createMemoryAuditLog } from "../../runtime/src/clients.mjs";
import { validDecision } from "../../runtime/test/pdp-fixtures.mjs";

const manifest = JSON.parse(readFileSync(new URL("../../modules/dummy-ok/agents/backup-agent.json", import.meta.url), "utf8"));
const NOW = Date.parse("2025-09-02T00:00:00Z");
const CONTENT = Buffer.from("tests passed\n");
const SHA = createHash("sha256").update(CONTENT).digest("hex");
const EVIDENCE_INDEX = { "tests-pass": { uri: "memory://tests", sha256: SHA, status: "pass" } };

function makeTask() {
  return {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "AgentTask",
    taskId: "task-durable-1",
    tenantId: "acme",
    agentRef: manifest.metadata.name,
    objective: "bevis holdbar jobtilstand",
    evidenceIndex: EVIDENCE_INDEX,
    actions: [{ verb: "upgrade.dry-run", target: "dummy-ok", environment: "staging", evidence: ["tests-pass"] }],
  };
}

function makeRuntime(db, executors) {
  return createAgentRuntime({
    manifest,
    pdp: { decide: async (input) => validDecision(input, { decision: "allow", requiredEvidence: ["policy-allow"] }) },
    auditLog: createMemoryAuditLog(),
    jobStore: createSqliteJobStore({ db, clock: () => NOW }),
    executors,
    artifactLoader: () => CONTENT,
    clock: () => NOW,
  });
}

test("en fuldført agent-task gemmes som job og overlever genstart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dkc-persist-runtime-"));
  try {
    let db = openDatabase({ path: join(dir, "runtime.db") });
    createMigrator({ db }).apply();
    const result = await makeRuntime(db, { "upgrade.dry-run": async () => ({ summary: "dry-run ok" }) }).runTask(makeTask());
    assert.equal(result.status, "completed");
    assert.equal(createSqliteJobStore({ db }).get("acme", "task-durable-1").status, "completed");
    db.close();

    db = openDatabase({ path: join(dir, "runtime.db") });
    const job = createSqliteJobStore({ db }).get("acme", "task-durable-1");
    assert.equal(job.status, "completed");
    assert.equal(job.result.actionsRun, 1);
    assert.equal(job.result.results[0].verb, "upgrade.dry-run");
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("en afbrudt task bevarer den committet udførte handling", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dkc-persist-runtime-crash-"));
  try {
    let db = openDatabase({ path: join(dir, "runtime.db") });
    createMigrator({ db }).apply();
    const task = makeTask();
    task.actions.push({ verb: "observe.read", target: "dummy-ok", environment: "staging", evidence: [] });
    const runtime = makeRuntime(db, {
      "upgrade.dry-run": async () => ({ summary: "first ok" }),
      "observe.read": async () => {
        throw new Error("worker døde");
      },
    });
    const result = await runtime.runTask(task);
    assert.equal(result.status, "escalated");
    db.close();

    db = openDatabase({ path: join(dir, "runtime.db") });
    const job = createSqliteJobStore({ db }).get("acme", "task-durable-1");
    assert.equal(job.status, "escalated");
    assert.equal(job.result.results.length, 1, "den committet udførte handling skal være gemt");
    assert.equal(job.result.results[0].verb, "upgrade.dry-run");
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
