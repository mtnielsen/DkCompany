/**
 * DKC-009 — eksternt forankret checkpoint.
 *
 * Beviser at et checkpoint uden for databasen opdager ændring, sletning,
 * trunkering og forfalskning af audit-loggen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../src/db.mjs";
import { migrateDatabase } from "../src/identities.mjs";
import { createSqliteAuditLog } from "../src/adapters/audit.mjs";
import { createCheckpointStore } from "../src/checkpoint.mjs";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "dkc-checkpoint-"));
  const db = openDatabase({ path: join(dir, "audit.db") });
  migrateDatabase(db);
  const audit = createSqliteAuditLog({ db });
  const anchorDir = join(dir, "anchors");
  const checkpoints = createCheckpointStore({ audit, anchorDir, secret: "anchor-secret" });
  return {
    dir,
    db,
    audit,
    anchorDir,
    checkpoints,
    cleanup: () => {
      try {
        db.close();
      } catch {
        /* ignore */
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function seed(audit, n = 3) {
  for (let i = 0; i < n; i++) audit.append({ tenantId: "acme", type: `event.${i}`, payload: { i } });
}

test("en intakt log verificerer mod checkpointet", () => {
  const { audit, checkpoints, cleanup } = fixture();
  try {
    seed(audit, 3);
    checkpoints.anchor({ tenantId: "acme" });
    const result = checkpoints.verify({ tenantId: "acme" });
    assert.equal(result.ok, true);
    assert.deepEqual(result.problems, []);
    assert.equal(result.anchoredCount, 3);
    assert.equal(result.currentCount, 3);
  } finally {
    cleanup();
  }
});

test("en ændret begivenhed opdages mod checkpointet", () => {
  const { db, audit, checkpoints, cleanup } = fixture();
  try {
    seed(audit, 3);
    checkpoints.anchor({ tenantId: "acme" });
    db.prepare("UPDATE audit_events SET payload = ? WHERE tenant_id = 'acme' AND seq = 1").run(JSON.stringify({ i: 999 }));
    const result = checkpoints.verify({ tenantId: "acme" });
    assert.equal(result.ok, false);
    assert.ok(result.problems.some((p) => p.type === "changed"));
  } finally {
    cleanup();
  }
});

test("en slettet begivenhed opdages mod checkpointet", () => {
  const { db, audit, checkpoints, cleanup } = fixture();
  try {
    seed(audit, 3);
    checkpoints.anchor({ tenantId: "acme" });
    const middle = db.get("SELECT seq FROM audit_events WHERE tenant_id = 'acme' ORDER BY seq ASC LIMIT 1 OFFSET 1").seq;
    db.prepare("DELETE FROM audit_events WHERE tenant_id = 'acme' AND seq = ?").run(middle);
    const result = checkpoints.verify({ tenantId: "acme" });
    assert.equal(result.ok, false);
    assert.ok(result.problems.some((p) => p.type === "deleted" || p.type === "truncated"));
  } finally {
    cleanup();
  }
});

test("en trunkeret log opdages mod checkpointet", () => {
  const { db, audit, checkpoints, cleanup } = fixture();
  try {
    seed(audit, 3);
    checkpoints.anchor({ tenantId: "acme" });
    const last = db.get("SELECT seq FROM audit_events WHERE tenant_id = 'acme' ORDER BY seq DESC LIMIT 1").seq;
    db.prepare("DELETE FROM audit_events WHERE tenant_id = 'acme' AND seq = ?").run(last);
    const result = checkpoints.verify({ tenantId: "acme" });
    assert.equal(result.ok, false);
    assert.ok(result.problems.some((p) => p.type === "truncated"));
    assert.equal(result.currentCount, 2);
    assert.equal(result.anchoredCount, 3);
  } finally {
    cleanup();
  }
});

test("et forfalsket checkpoint opdages (HMAC)", () => {
  const { anchorDir, audit, checkpoints, cleanup } = fixture();
  try {
    seed(audit, 2);
    checkpoints.anchor({ tenantId: "acme" });
    const latest = join(anchorDir, "latest-acme.json");
    const anchor = JSON.parse(readFileSync(latest, "utf8"));
    anchor.chainHash = "f".repeat(64);
    writeFileSync(latest, JSON.stringify(anchor));
    const result = checkpoints.verify({ tenantId: "acme" });
    assert.equal(result.ok, false);
    assert.ok(result.problems.some((p) => p.type === "forged"));
  } finally {
    cleanup();
  }
});

test("nye begivenheder efter checkpointet er tilladte", () => {
  const { audit, checkpoints, cleanup } = fixture();
  try {
    seed(audit, 2);
    checkpoints.anchor({ tenantId: "acme" });
    // Nye begivenheder efter checkpointet er tilladte; præfikset er intakt.
    audit.append({ tenantId: "acme", type: "event.new", payload: {} });
    const result = checkpoints.verify({ tenantId: "acme" });
    assert.equal(result.ok, true);
    assert.equal(result.currentCount, 3);
  } finally {
    cleanup();
  }
});
