/**
 * DKC-021 — holdbart slette- og holdregister (SQLite).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../src/db.mjs";
import { createMigrator } from "../src/migrations.mjs";
import { createSqliteRetentionStore } from "../src/adapters/retention.mjs";
import { buildHold, subjectDigestOf } from "../../retention/src/holds.mjs";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "dkc-021-store-"));
  const db = openDatabase({ path: join(dir, "retention.db") });
  createMigrator({ db }).apply();
  const store = createSqliteRetentionStore({ db });
  return {
    db,
    store,
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

const APPROVER = { subject: "oidc|lars.lov", name: "Lars Lov", role: "legal-counsel" };
const DIGEST = subjectDigestOf("kunde@example.org");

function hold(overrides = {}) {
  return buildHold({
    tenantId: "acme",
    subjectDigest: DIGEST,
    dataClasses: ["personal"],
    reason: "verserende retssag kræver bevaring",
    placedBy: { subject: "oidc|pia", name: "Pia Privat", role: "privacy-officer" },
    approvedBy: APPROVER,
    ...overrides,
  });
}

test("et hold gemmes, findes og frigives holdbart", () => {
  const f = fixture();
  try {
    const placed = f.store.placeHold("acme", hold());
    assert.equal(f.store.activeHoldsFor("acme", { subjectDigest: DIGEST, dataClasses: ["personal"] }).length, 1);

    const released = f.store.releaseHold("acme", placed.holdId, { releasedBy: { subject: "oidc|pia", name: "Pia Privat", role: "privacy-officer" }, releaseReason: "retssagen er afsluttet" });
    assert.equal(released.status, "released");
    assert.equal(f.store.activeHoldsFor("acme", { subjectDigest: DIGEST }).length, 0);
    assert.equal(f.store.listHolds("acme", { includeReleased: true }).length, 1);
  } finally {
    f.cleanup();
  }
});

test("hold og kvitteringer er tenant-bundne", () => {
  const f = fixture();
  try {
    const placed = f.store.placeHold("acme", hold());
    assert.equal(f.store.getHold("globex", placed.holdId), null);
    assert.equal(f.store.activeHoldsFor("globex", { subjectDigest: DIGEST }).length, 0);
    assert.throws(() => f.store.releaseHold("globex", placed.holdId, { releasedBy: APPROVER, releaseReason: "x".repeat(12) }), /ukendt hold/);
  } finally {
    f.cleanup();
  }
});

test("en kvittering gemmes og læses med digest", () => {
  const f = fixture();
  try {
    const receipt = {
      apiVersion: "contracts.platform/v1alpha1",
      kind: "DeletionReceipt",
      receiptId: "del:acme:1",
      tenantId: "acme",
      subjectDigest: DIGEST,
      requestedBy: "oidc|pia",
      requestedAt: "2025-09-24T09:00:00Z",
      completedAt: "2025-09-24T09:00:01Z",
      status: "partial",
      hold: { blocked: false, holdIds: [] },
      results: [{ surface: "s", kind: "primary", status: "partial", recordsAffected: 1, remainingCopies: [] }],
      summary: { surfaces: 1, full: 0, partial: 1, unsupported: 0, blocked: 0, recordsAffected: 1, remainingCopies: 0 },
      audit: { intentId: "i", outcomeId: "o", subjectDigest: DIGEST, containsRawPersonalData: false },
    };
    f.store.saveReceipt("acme", receipt);
    const loaded = f.store.getReceipt("acme", "del:acme:1");
    assert.equal(loaded.subjectDigest, DIGEST);
    assert.equal(f.store.getReceipt("globex", "del:acme:1"), null);
  } finally {
    f.cleanup();
  }
});

test("en restore-gate gemmes og opdateres holdbart", () => {
  const f = fixture();
  try {
    const gate = {
      gateId: "gate:acme:1",
      tenantId: "acme",
      restorePointIso: "2025-09-24T09:00:00Z",
      status: "quarantined",
      pinnedLedgerHead: "a".repeat(64),
      appliedLedgerHead: null,
      appliedEntries: 0,
      recordsErased: 0,
      openedAt: "2025-09-24T09:00:01Z",
      appliedAt: null,
      releasedAt: null,
      releasedBy: null,
    };
    f.store.saveRestoreGate("acme", gate);
    assert.equal(f.store.getRestoreGate("acme", "gate:acme:1").status, "quarantined");
    f.store.saveRestoreGate("acme", { ...gate, status: "released", releasedAt: "2025-09-24T09:10:00Z", releasedBy: "oidc|operator" });
    assert.equal(f.store.getRestoreGate("acme", "gate:acme:1").status, "released");
    assert.equal(f.store.getRestoreGate("globex", "gate:acme:1"), null);
  } finally {
    f.cleanup();
  }
});
