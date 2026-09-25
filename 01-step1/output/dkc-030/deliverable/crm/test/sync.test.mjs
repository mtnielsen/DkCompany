import { test } from "node:test";
import assert from "node:assert/strict";
import { setupCrm, ADA } from "./helpers.mjs";
import { importRecord, exportRecord, exportTenant } from "../src/sync.mjs";

const AT = "2026-03-01T00:00:00Z";

test("en kontakt kan importeres og eksporteres med stabil reference", async () => {
  const ctx = await setupCrm();
  try {
    const acme = ctx.all.sources.sources.find((s) => s.id === "espocrm-acme");
    const created = await importRecord({ store: ctx.store, source: acme, client: ctx.clients[acme.id], entityType: "Contact", payload: { name: "Test Testesen", emailAddress: "test@acme-nord.example", accountId: "1001", classification: "personal" }, idempotencyKey: "k1", at: AT });
    assert.match(created.record.reference, /^crm:acme:Contact:/);
    const exported = exportRecord({ store: ctx.store, reference: created.record.reference, principal: ADA, source: acme });
    assert.equal(exported.record.reference, created.record.reference);
    assert.ok(exported.activities.length >= 1);
  } finally {
    await ctx.close();
  }
});

test("en opdatering bevarer referencen og forøger versionen", async () => {
  const ctx = await setupCrm();
  try {
    const acme = ctx.all.sources.sources.find((s) => s.id === "espocrm-acme");
    const created = await importRecord({ store: ctx.store, source: acme, client: ctx.clients[acme.id], entityType: "Contact", payload: { name: "Navn Et", emailAddress: "u@acme-nord.example", accountId: "1001", classification: "personal" }, idempotencyKey: "u1", at: AT });
    const updated = await importRecord({ store: ctx.store, source: acme, client: ctx.clients[acme.id], entityType: "Contact", payload: { name: "Navn To", emailAddress: "u@acme-nord.example", accountId: "1001", classification: "personal" }, idempotencyKey: "u2", at: AT });
    assert.equal(updated.action, "update");
    assert.equal(updated.record.reference, created.record.reference);
    assert.ok(updated.record.version > created.record.version);
  } finally {
    await ctx.close();
  }
});

test("et retry med samme idempotency-nøgle skaber ingen dublet", async () => {
  const ctx = await setupCrm();
  try {
    const acme = ctx.all.sources.sources.find((s) => s.id === "espocrm-acme");
    const payload = { name: "Retry Kunde", emailAddress: "retry@acme-nord.example", accountId: "1001", classification: "personal" };
    const first = await importRecord({ store: ctx.store, source: acme, client: ctx.clients[acme.id], entityType: "Contact", payload, idempotencyKey: "r1", at: AT });
    const before = ctx.store.listRecords({ tenantId: "acme", entityType: "Contact" }).length;
    const second = await importRecord({ store: ctx.store, source: acme, client: ctx.clients[acme.id], entityType: "Contact", payload, idempotencyKey: "r1", at: AT });
    assert.equal(second.idempotent, true);
    assert.equal(second.record.reference, first.record.reference);
    assert.equal(ctx.store.listRecords({ tenantId: "acme", entityType: "Contact" }).length, before);
  } finally {
    await ctx.close();
  }
});

test("eksport kræver læseadgang", async () => {
  const ctx = await setupCrm();
  try {
    const acme = ctx.all.sources.sources.find((s) => s.id === "espocrm-acme");
    const created = await importRecord({ store: ctx.store, source: acme, client: ctx.clients[acme.id], entityType: "Contact", payload: { name: "Hemmelig", emailAddress: "hemmelig@acme-nord.example", accountId: "1001", classification: "confidential" }, idempotencyKey: "s1", at: AT });
    const globex = ctx.all.sources.sources.find((s) => s.id === "espocrm-globex");
    assert.throws(() => exportRecord({ store: ctx.store, reference: created.record.reference, principal: { kind: "human", id: "oidc|gus.globex", tenantId: "globex", roles: ["sales"], clearance: "confidential" }, source: globex }), (err) => err.code === "access_denied");
  } finally {
    await ctx.close();
  }
});

test("en tenant-eksport bevarer stabile referencer", async () => {
  const ctx = await setupCrm();
  try {
    const acme = ctx.all.sources.sources.find((s) => s.id === "espocrm-acme");
    const exported = exportTenant({ store: ctx.store, tenantId: "acme", principal: ADA, source: acme });
    assert.ok(exported.recordCount >= 1);
    assert.ok(exported.records.every((r) => r.reference.startsWith("crm:acme:")));
  } finally {
    await ctx.close();
  }
});
