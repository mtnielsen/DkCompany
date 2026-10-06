import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setupCrm, ADA, BEN, GUS } from "./helpers.mjs";
import { deleteRecord, deleteCustomer } from "../src/retention.mjs";
import { buildHold, subjectDigestOf } from "../../retention/src/holds.mjs";
import { FileCrmStore } from "../src/store.mjs";
import { crmDeletionReceiptProblems } from "../src/model.mjs";

const AT = "2026-03-01T00:00:00Z";

function holdFor(account) {
  return buildHold({
    tenantId: "acme",
    subjectDigest: subjectDigestOf(account.owner.subject),
    dataClasses: [account.classification],
    reason: "verserende aftale",
    placedBy: { subject: "oidc|mia.manager", name: "Mia Manager", role: "Sales Manager" },
    approvedBy: { subject: "oidc|leo.legal", name: "Leo Legal", role: "Legal Counsel" },
  });
}

test("et legal hold blokerer sletning", async () => {
  const ctx = await setupCrm();
  try {
    const acme = ctx.all.sources.sources.find((s) => s.id === "espocrm-acme");
    const account = ctx.store.getRecord("crm:acme:Account:1001");
    const receipt = deleteRecord({ store: ctx.store, reference: account.id, principal: ADA, source: acme, holds: [holdFor(account)], reason: "kundeanmodning", now: AT });
    assert.equal(receipt.status, "blocked");
    assert.ok(receipt.legalHoldId);
    assert.equal(crmDeletionReceiptProblems(receipt).length, 0);
    assert.ok(ctx.store.getRecord(account.id).deletedAt == null);
  } finally {
    await ctx.close();
  }
});

test("en tværtenant-sletning afvises", async () => {
  const ctx = await setupCrm();
  try {
    const globex = ctx.all.sources.sources.find((s) => s.id === "espocrm-globex");
    assert.throws(
      () => deleteRecord({ store: ctx.store, reference: "crm:acme:Account:1001", principal: GUS, source: globex, holds: [], reason: "x", now: AT }),
      (err) => err.code === "cross_tenant_reference"
    );
  } finally {
    await ctx.close();
  }
});

test("en kunde uden WORM-kopi slettes fuldt på tværs af flader", async () => {
  const ctx = await setupCrm();
  try {
    const acme = ctx.all.sources.sources.find((s) => s.id === "espocrm-acme");
    const receipt = deleteCustomer({ store: ctx.store, tenantId: "acme", accountReference: "crm:acme:Account:1002", principal: BEN, source: acme, holds: [], reason: "kundeanmodning", now: AT });
    assert.equal(receipt.status, "full");
    assert.equal(crmDeletionReceiptProblems(receipt).length, 0);
    assert.equal(receipt.surfaces.primary.status, "full");
    assert.ok(ctx.store.listRecords({ tenantId: "acme", includeDeleted: false }).every((r) => r.data?.accountId !== "1002" || r.entityType === "Account"));
  } finally {
    await ctx.close();
  }
});

test("en WORM-låst backupkopi opgives ærligt som resterende kopi", async () => {
  const ctx = await setupCrm();
  try {
    const acme = ctx.all.sources.sources.find((s) => s.id === "espocrm-acme");
    const account = ctx.store.getRecord("crm:acme:Account:1001");
    ctx.store.putCopyBlob({ reference: account.id, surface: "search", content: { name: account.name }, at: AT });
    ctx.store.putCopyBlob({ reference: account.id, surface: "backup", content: { name: account.name }, at: AT });
    const receipt = deleteCustomer({ store: ctx.store, tenantId: "acme", accountReference: account.id, principal: ADA, source: acme, holds: [], reason: "kundeanmodning", now: AT });
    assert.equal(receipt.status, "partial");
    assert.equal(receipt.remainingCopies.length, 1);
    assert.equal(receipt.remainingCopies[0].kind, "backup");
    assert.ok(!ctx.store.listCopies(account.id).some((c) => c.surface === "search"));
    assert.equal(crmDeletionReceiptProblems(receipt).length, 0);
  } finally {
    await ctx.close();
  }
});

test("backup og gendannelse bevarer poster og aktiviteter", async () => {
  const ctx = await setupCrm();
  const backupDir = mkdtempSync(join(tmpdir(), "dkc030-test-backup-"));
  const restoredDir = mkdtempSync(join(tmpdir(), "dkc030-test-restore-"));
  try {
    ctx.store.snapshot(backupDir);
    const restored = FileCrmStore.restore(backupDir, restoredDir);
    assert.equal(restored.listRecords().length, ctx.store.listRecords().length);
    assert.equal(restored.activityDigest(), ctx.store.activityDigest());
  } finally {
    rmSync(backupDir, { recursive: true, force: true });
    rmSync(restoredDir, { recursive: true, force: true });
    await ctx.close();
  }
});
