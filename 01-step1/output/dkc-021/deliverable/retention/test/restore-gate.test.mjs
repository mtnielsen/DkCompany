/**
 * DKC-021 — releasegate: slettebeslutninger genanvendes før frigivelse.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSuppressionLedger } from "../../backup/src/suppression.mjs";
import { createMemoryRetentionStore, buildHold } from "../src/holds.mjs";
import { createQuarantineWorkspace, createRestoreReleaseGate, RestoreGateError } from "../src/restore-gate.mjs";

const OLD = "1".repeat(64);
const NEW = "2".repeat(64);
const APPROVER = { subject: "oidc|lars.lov", name: "Lars Lov", role: "legal-counsel" };

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "dkc-021-gate-"));
  const ledger = createSuppressionLedger({ path: join(dir, "suppression.ndjson") });
  const store = createMemoryRetentionStore();
  const workspace = createQuarantineWorkspace();
  const gate = createRestoreReleaseGate({ store });
  return { dir, ledger, store, workspace, gate, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("en gendannelse kan ikke frigives før slettebeslutninger er genanvendt", () => {
  const f = fixture();
  try {
    const restorePoint = new Date("2025-09-24T09:00:00Z").toISOString();
    f.ledger.append({ tenantId: "acme", digest: OLD, subjectKey: OLD, erasedAt: "2025-09-24T08:00:00Z" });
    f.ledger.append({ tenantId: "acme", digest: NEW, subjectKey: NEW, erasedAt: "2025-09-24T10:00:00Z" });
    f.workspace.add("acme", OLD, "old.json", { old: true });
    f.workspace.add("acme", NEW, "new.json", { new: true });

    const opened = f.gate.openGate({ tenantId: "acme", restorePointIso: restorePoint, ledger: f.ledger });
    assert.equal(opened.status, "quarantined");
    assert.throws(() => f.gate.release({ tenantId: "acme", gateId: opened.gateId, ledger: f.ledger, workspace: f.workspace }), (err) => err instanceof RestoreGateError && err.code === "decisions_pending");

    const applied = f.gate.applyDecisions({ tenantId: "acme", gateId: opened.gateId, ledger: f.ledger, workspace: f.workspace });
    assert.equal(applied.status, "decisions-applied");
    // Kun sletningen efter restorepunktet genanvendes.
    assert.equal(applied.recordsErased, 1);
    assert.equal(f.workspace.list("acme").length, 1);
    assert.equal(f.workspace.list("acme")[0].subjectDigest, OLD);

    const released = f.gate.release({ tenantId: "acme", gateId: opened.gateId, ledger: f.ledger, workspace: f.workspace, releasedBy: "oidc|operator" });
    assert.equal(released.status, "released");
  } finally {
    f.cleanup();
  }
});

test("en ny sletning efter anvendelsen tvinger en ny behandling", () => {
  const f = fixture();
  try {
    const opened = f.gate.openGate({ tenantId: "acme", restorePointIso: "2025-09-24T09:00:00Z", ledger: f.ledger });
    f.gate.applyDecisions({ tenantId: "acme", gateId: opened.gateId, ledger: f.ledger, workspace: f.workspace });
    f.ledger.append({ tenantId: "acme", digest: NEW, subjectKey: NEW, erasedAt: "2025-09-24T11:00:00Z" });
    assert.throws(() => f.gate.release({ tenantId: "acme", gateId: opened.gateId, ledger: f.ledger, workspace: f.workspace }), (err) => err.code === "ledger_advanced");
  } finally {
    f.cleanup();
  }
});

test("et aktivt hold blokerer frigivelse af et subjekt i karantænen", () => {
  const f = fixture();
  try {
    const opened = f.gate.openGate({ tenantId: "acme", restorePointIso: "2025-09-24T09:00:00Z", ledger: f.ledger });
    f.workspace.add("acme", NEW, "new.json", { new: true });
    f.gate.applyDecisions({ tenantId: "acme", gateId: opened.gateId, ledger: f.ledger, workspace: f.workspace });
    const hold = buildHold({
      tenantId: "acme",
      subjectDigest: NEW,
      dataClasses: ["personal"],
      reason: "verserende retssag kræver bevaring",
      placedBy: { subject: "oidc|pia", name: "Pia Privat", role: "privacy-officer" },
      approvedBy: APPROVER,
    });
    assert.throws(() => f.gate.release({ tenantId: "acme", gateId: opened.gateId, ledger: f.ledger, workspace: f.workspace, holds: [hold] }), (err) => err.code === "hold_blocks_release");
  } finally {
    f.cleanup();
  }
});

test("en brudt suppressionsjournal afvises ved anvendelse", () => {
  const f = fixture();
  try {
    const opened = f.gate.openGate({ tenantId: "acme", restorePointIso: "2025-09-24T09:00:00Z", ledger: f.ledger });
    f.ledger.append({ tenantId: "acme", digest: NEW, subjectKey: NEW, erasedAt: "2025-09-24T10:00:00Z" });
    const broken = { verify: () => ({ ok: false, problems: [] }), head: () => "x", isDescendantOf: () => true, entriesAfter: () => [] };
    assert.throws(() => f.gate.applyDecisions({ tenantId: "acme", gateId: opened.gateId, ledger: broken, workspace: f.workspace }), (err) => err.code === "ledger_broken");
  } finally {
    f.cleanup();
  }
});
