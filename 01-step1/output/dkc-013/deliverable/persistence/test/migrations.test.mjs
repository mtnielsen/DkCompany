/**
 * DKC-008 — versionsstyrede migrationer og opgradering.
 *
 * Beviser at et eksisterende v1-schema kan opgraderes til v2 uden datatab, og
 * at en ændret allerede-anvendt migration opdages.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../src/db.mjs";
import { createMigrator, discoverMigrations, MigrationError } from "../src/migrations.mjs";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "dkc-persist-migrations-"));
  const db = openDatabase({ path: join(dir, "upgrade.db") });
  return { db, dir, cleanup: () => { try { db.close(); } catch { /* ignore */ } rmSync(dir, { recursive: true, force: true }); } };
}

test("migrationer anvendes i rækkefølge og registreres med checksum", () => {
  const { db, cleanup } = fixture();
  try {
    const migrator = createMigrator({ db });
    const first = migrator.apply();
    assert.deepEqual(first.applied, [1, 2, 3, 4, 5]);
    // Anden kørsel er idempotent.
    assert.deepEqual(migrator.apply().applied, []);
    const status = migrator.status();
    assert.equal(status.current, 5);
    assert.equal(status.pending.length, 0);
    assert.equal(status.problems.length, 0);
    assert.ok(status.applied.includes(1) && status.applied.includes(2) && status.applied.includes(3) && status.applied.includes(4) && status.applied.includes(5));
    assert.ok(discoverMigrations().length >= 2);
  } finally {
    cleanup();
  }
});

test("en ændret anvendt migration opdages (fail-closed)", () => {
  const { db, cleanup } = fixture();
  try {
    const migrator = createMigrator({ db });
    migrator.apply();
    db.prepare("UPDATE schema_migrations SET checksum = 'deadbeef' WHERE version = 1").run();
    assert.equal(migrator.verifyChecksums().length, 1);
    assert.throws(() => migrator.apply(), (err) => err instanceof MigrationError && /schema-historik/.test(err.message));
  } finally {
    cleanup();
  }
});

test("opgradering fra v1 til v2 bevarer rækker og tilføjer nye kolonner", () => {
  const { db, cleanup } = fixture();
  try {
    // 1) Kør kun version 1 og skriv data ind, som v1-skemaet tillader.
    const v1 = createMigrator({ db });
    const partial = v1.apply({ toVersion: 1 });
    assert.deepEqual(partial.applied, [1]);
    db.prepare("INSERT INTO jobs(tenant_id, id, kind, payload, status, enqueued_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      "acme", "j1", "backup", JSON.stringify({ x: 1 }), "queued", "2025-01-01T00:00:00Z", "2025-01-01T00:00:00Z"
    );
    db.prepare("INSERT INTO approval_requests(tenant_id, id, state, data, updated_at) VALUES (?, ?, ?, ?, ?)").run(
      "acme", "r1", "approved", JSON.stringify({ id: "r1", tenantId: "acme", decision: { state: "approved" } }), "2025-01-01T00:00:00Z"
    );
    db.prepare("INSERT INTO budgets(tenant_id, budget_key, tokens, cost_eur, calls, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(
      "acme", "agent", 42, 1.5, 3, "2025-01-01T00:00:00Z"
    );
    db.prepare("INSERT INTO audit_events(id, tenant_id, at, type, payload, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      "e1", "acme", "2025-01-01T00:00:00Z", "created", "{}", "0".repeat(64), "h"
    );

    // 2) Opgrader til v2, v3, v4 og v5.
    const upgraded = createMigrator({ db });
    assert.deepEqual(upgraded.apply().applied, [2, 3, 4, 5]);
    assert.equal(upgraded.status().current, 5);

    // 3) Data er intakt, og de nye kolonner findes med sikre defaults.
    const job = db.get("SELECT * FROM jobs WHERE id = 'j1'");
    assert.equal(job.priority, 100);
    assert.equal(job.status, "queued");
    assert.equal(job.payload, JSON.stringify({ x: 1 }));
    const budget = db.get("SELECT * FROM budgets WHERE budget_key = 'agent'");
    assert.equal(budget.tokens, 42);
    assert.equal(budget.ceiling_tokens, null);
    const approval = db.get("SELECT * FROM approval_requests WHERE id = 'r1'");
    assert.equal(approval.state, "approved");
    assert.equal(approval.consumed_at, null);
    const event = db.get("SELECT * FROM audit_events WHERE id = 'e1'");
    assert.equal(event.trace_id, null);
    assert.equal(event.idempotency_id, null);
    assert.equal(event.phase, null);
    // v3-tabellerne findes efter opgraderingen.
    assert.ok(db.get("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'audit_intents'"));
    assert.ok(db.get("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'audit_personal'"));
    // v4-tabellerne findes efter opgraderingen.
    assert.ok(db.get("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'credential_issuances'"));
    assert.ok(db.get("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'revocations'"));
    assert.ok(db.get("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'kill_switches'"));
    // v5-kolonner og -tabeller findes efter opgraderingen.
    assert.equal(job.max_attempts, 3);
    assert.equal(job.lease_token, 0);
    assert.equal(job.idempotency_key, null);
    assert.ok(db.get("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'job_attempts'"));
    assert.ok(db.get("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'job_dead_letters'"));
  } finally {
    cleanup();
  }
});

test("dry-run anvender intet", () => {
  const { db, cleanup } = fixture();
  try {
    const migrator = createMigrator({ db });
    const plan = migrator.apply({ dryRun: true });
    assert.deepEqual(plan.applied, []);
    assert.deepEqual(plan.pending.map((m) => m.version), [1, 2, 3, 4, 5]);
    assert.equal(migrator.status().current, 0);
  } finally {
    cleanup();
  }
});
