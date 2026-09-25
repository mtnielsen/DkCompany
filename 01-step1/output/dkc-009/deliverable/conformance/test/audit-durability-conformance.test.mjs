/**
 * DKC-009 — konformanstest for holdbar audit og fail-closed handlinger.
 *
 * Spejler de fire acceptkriterier i conformance-suiten, så `make test` dækker
 * dem sammen med persistenslagets og audit-servicens tests:
 *
 *   1. audit utilgængelig før handling giver nul eksterne ændringer,
 *   2. crash mellem intent og outcome giver unknown og ingen genudførelse,
 *   3. ændring, sletning og trunkering kan påvises mod et checkpoint,
 *   4. audit overlever genstart, og hemmeligheder optræder ikke i loggen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { openDatabase } from "../../persistence/src/db.mjs";
import { migrateDatabase } from "../../persistence/src/identities.mjs";
import { createSqliteAuditLog } from "../../persistence/src/adapters/audit.mjs";
import { createSqliteActionJournal } from "../../persistence/src/adapters/audit-journal.mjs";
import { createCheckpointStore } from "../../persistence/src/checkpoint.mjs";
import { createAgentRuntime } from "../../runtime/src/runtime.mjs";
import { createMemoryActionJournal, createMemoryAuditLog } from "../../runtime/src/clients.mjs";
import { evidenceFixture } from "../../runtime/test/evidence-fixtures.mjs";
import { validDecision } from "../../runtime/test/pdp-fixtures.mjs";

const manifest = JSON.parse(readFileSync(new URL("../../modules/dummy-ok/agents/backup-agent.json", import.meta.url), "utf8"));
const EVIDENCE = evidenceFixture(["tests-pass", "dry-run-clean", "rollback-tested", "restore-verified", "scan-clean"]);
const allowPdp = () => ({ decide: async (input) => validDecision(input, { requiredEvidence: ["policy-allow"] }) });
const makeTask = (actions) => ({ apiVersion: "contracts.platform/v1alpha1", kind: "AgentTask", taskId: randomUUID(), tenantId: "acme", agentRef: manifest.metadata.name, objective: "conformance", evidenceIndex: EVIDENCE.index, actions });
const makeAction = (extra = {}) => ({ verb: "upgrade.dry-run", target: "dummy-ok", environment: "staging", evidence: ["tests-pass"], ...extra });

test("audit utilgængelig før handling giver nul eksterne ændringer", async () => {
  const record = [];
  const runtime = createAgentRuntime({
    manifest,
    pdp: allowPdp(),
    auditLog: createMemoryAuditLog(),
    actionJournal: createMemoryActionJournal({ fail: true }),
    executors: { "upgrade.dry-run": async () => { record.push("run"); return { summary: "x" }; } },
  });
  const result = await runtime.runTask(makeTask([makeAction({ idempotencyId: "conf-1" })]));
  assert.equal(result.status, "halted");
  assert.deepEqual(record, [], "ingen ekstern ændring når audit er utilgængelig");
});

test("crash mellem intent og outcome giver unknown og ingen ukritisk genudførelse", async () => {
  const record = [];
  const journal = createMemoryActionJournal();
  await journal.begin({ tenantId: "acme", idempotencyId: "conf-crash", verb: "upgrade.dry-run", target: "dummy-ok" });
  const runtime = createAgentRuntime({
    manifest,
    pdp: allowPdp(),
    auditLog: createMemoryAuditLog(),
    actionJournal: journal,
    executors: { "upgrade.dry-run": async () => { record.push("run"); return { summary: "x" }; } },
  });
  const result = await runtime.runTask(makeTask([makeAction({ idempotencyId: "conf-crash" })]));
  assert.equal(result.status, "unknown");
  assert.deepEqual(record, [], "et pending intent må ikke genudføres");
});

test("ændring, sletning og trunkering kan påvises mod checkpoint", () => {
  for (const scenario of ["changed", "deleted", "truncated"]) {
    const dir = mkdtempSync(join(tmpdir(), "dkc-conf-checkpoint-"));
    try {
      const db = openDatabase({ path: join(dir, "audit.db") });
      migrateDatabase(db);
      const audit = createSqliteAuditLog({ db });
      const checkpoints = createCheckpointStore({ audit, anchorDir: join(dir, "anchors"), secret: "k" });
      for (let i = 0; i < 3; i++) audit.append({ tenantId: "acme", type: `e${i}`, payload: { i } });
      checkpoints.anchor({ tenantId: "acme" });
      if (scenario === "changed") db.prepare("UPDATE audit_events SET payload = '{\"i\":9}' WHERE tenant_id='acme' AND seq = (SELECT MIN(seq) FROM audit_events WHERE tenant_id='acme')").run();
      if (scenario === "deleted") db.prepare("DELETE FROM audit_events WHERE tenant_id='acme' AND seq = (SELECT seq FROM audit_events WHERE tenant_id='acme' ORDER BY seq LIMIT 1 OFFSET 1)").run();
      if (scenario === "truncated") db.prepare("DELETE FROM audit_events WHERE tenant_id='acme' AND seq = (SELECT MAX(seq) FROM audit_events WHERE tenant_id='acme')").run();
      const result = checkpoints.verify({ tenantId: "acme" });
      assert.equal(result.ok, false, `${scenario} skulle opdages`);
      assert.ok(result.problems.length > 0);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("audit overlever genstart, og hemmeligheder optræder ikke i loggen", () => {
  const dir = mkdtempSync(join(tmpdir(), "dkc-conf-restart-"));
  try {
    const path = join(dir, "audit.db");
    let db = openDatabase({ path });
    migrateDatabase(db);
    let audit = createSqliteAuditLog({ db });
    let journal = createSqliteActionJournal({ db, audit });
    journal.begin({ tenantId: "acme", idempotencyId: "conf-r", verb: "config.apply", target: "svc", request: { password: "hunter2" } });
    db.close();

    db = openDatabase({ path });
    audit = createSqliteAuditLog({ db });
    journal = createSqliteActionJournal({ db, audit });
    assert.equal(journal.lookup({ tenantId: "acme", idempotencyId: "conf-r" }).state, "pending");
    assert.equal(audit.verifyChain("acme").ok, true);
    db.raw.exec("PRAGMA wal_checkpoint(FULL)");
    const bytes = readFileSync(path);
    assert.ok(!bytes.includes(Buffer.from("hunter2")), "hemmeligheden må ikke ligge i databasefilen");
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
