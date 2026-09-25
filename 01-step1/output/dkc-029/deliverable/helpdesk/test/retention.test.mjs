import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setupHelpdesk, ADA } from "./helpers.mjs";
import { exportSubject, deleteSubject } from "../src/retention.mjs";
import { buildHold } from "../../retention/src/holds.mjs";
import { FileHelpdeskStore } from "../src/store.mjs";

const AT = "2026-03-01T00:00:00Z";

test("eksport samler sager, mails, bilag og indeks for et subjekt", async () => {
  const ctx = await setupHelpdesk();
  try {
    const exported = exportSubject({ store: ctx.store, tenantId: "acme", subjectKey: ADA.id, now: AT });
    assert.ok(exported.ticketCount >= 2);
    assert.ok(exported.messageCount >= 2);
    assert.ok(exported.attachmentCount >= 2);
    assert.ok(exported.indexEntryCount >= 2);
  } finally {
    await ctx.close();
  }
});

test("et legal hold blokerer sletning", async () => {
  const ctx = await setupHelpdesk();
  try {
    const exported = exportSubject({ store: ctx.store, tenantId: "acme", subjectKey: ADA.id, now: AT });
    const hold = buildHold({
      tenantId: "acme",
      subjectDigest: exported.subjectDigest,
      dataClasses: ["personal"],
      reason: "verserende sag",
      placedBy: { subject: "oidc|mia.manager", name: "Mia Manager", role: "Support Manager" },
      approvedBy: { subject: "oidc|leo.legal", name: "Leo Legal", role: "Legal Counsel" },
    });
    const receipt = deleteSubject({ store: ctx.store, tenantId: "acme", subjectKey: ADA.id, reason: "anmodning", holds: [hold], now: AT });
    assert.equal(receipt.status, "blocked");
    assert.ok(ctx.store.listTickets({ tenantId: "acme", includeDeleted: false }).some((t) => t.requester?.subject === ADA.id));
  } finally {
    await ctx.close();
  }
});

test("sletning fjerner mails, bilag og indeks og efterlader en tombstone", async () => {
  const ctx = await setupHelpdesk();
  try {
    const receipt = deleteSubject({ store: ctx.store, tenantId: "acme", subjectKey: ADA.id, reason: "anmodning", holds: [], now: AT });
    assert.equal(receipt.status, "full");
    for (const surface of ["mail", "attachments", "index"]) assert.equal(receipt.surfaces[surface].status, "full");
    const active = ctx.store.listTickets({ tenantId: "acme", includeDeleted: false }).filter((t) => t.requester?.subject === ADA.id);
    assert.equal(active.length, 0);
    const tombstoned = ctx.store.listTickets({ tenantId: "acme", includeDeleted: true }).filter((t) => t.requester?.subject === ADA.id);
    assert.ok(tombstoned.length >= 2);
  } finally {
    await ctx.close();
  }
});

test("backup og gendannelse bevarer sager og historik", async () => {
  const ctx = await setupHelpdesk();
  const backupDir = mkdtempSync(join(tmpdir(), "dkc029-test-backup-"));
  const restoredDir = mkdtempSync(join(tmpdir(), "dkc029-test-restore-"));
  try {
    ctx.store.snapshot(backupDir);
    const restored = FileHelpdeskStore.restore(backupDir, restoredDir);
    assert.equal(restored.listTickets().length, ctx.store.listTickets().length);
    assert.equal(restored.historyDigest(), ctx.store.historyDigest());
  } finally {
    rmSync(backupDir, { recursive: true, force: true });
    rmSync(restoredDir, { recursive: true, force: true });
    await ctx.close();
  }
});
