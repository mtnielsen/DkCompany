import { test } from "node:test";
import assert from "node:assert/strict";
import { setupCrm, ADA, BEN, GUS, SUPPORT } from "./helpers.mjs";
import { decideRecordAccess, filterAuthorizedRecords } from "../src/permissions.mjs";

test("et salgsteam kan ikke læse en anden kundes CRM", async () => {
  const ctx = await setupCrm();
  try {
    const records = ctx.store.listRecords();
    const sourceResolver = (r) => ctx.all.sources.sources.find((s) => s.id === r.sourceId);
    const ada = filterAuthorizedRecords({ principal: ADA, records, sourceResolver });
    const gus = filterAuthorizedRecords({ principal: GUS, records, sourceResolver });
    assert.ok(ada.authorized.length > 0);
    assert.ok(ada.authorized.every((r) => r.tenantId === "acme"));
    assert.ok(gus.authorized.every((r) => r.tenantId === "globex"));
    assert.ok(gus.authorized.length > 0);
  } finally {
    await ctx.close();
  }
});

test("support-rollen må ikke læse et salgsforløb", async () => {
  const ctx = await setupCrm();
  try {
    const acme = ctx.all.sources.sources.find((s) => s.id === "espocrm-acme");
    const opportunity = ctx.store.listRecords({ tenantId: "acme", entityType: "Opportunity" })[0];
    assert.equal(decideRecordAccess({ principal: SUPPORT, record: opportunity, source: acme }).allowed, false);
    assert.equal(decideRecordAccess({ principal: SUPPORT, record: opportunity, source: acme }).reason, "role");
  } finally {
    await ctx.close();
  }
});

test("en principal uden den rette klarering nægtes et fortroligt salgsforløb", async () => {
  const ctx = await setupCrm();
  try {
    const acme = ctx.all.sources.sources.find((s) => s.id === "espocrm-acme");
    const opportunity = ctx.store.listRecords({ tenantId: "acme", entityType: "Opportunity" })[0];
    assert.equal(decideRecordAccess({ principal: BEN, record: opportunity, source: acme }).allowed, false);
    assert.equal(decideRecordAccess({ principal: ADA, record: opportunity, source: acme }).allowed, true);
  } finally {
    await ctx.close();
  }
});

test("en slettet post nægtes", async () => {
  const ctx = await setupCrm();
  try {
    const acme = ctx.all.sources.sources.find((s) => s.id === "espocrm-acme");
    const account = ctx.store.getRecord("crm:acme:Account:1001");
    ctx.store.tombstoneRecord(account.id);
    assert.equal(decideRecordAccess({ principal: ADA, record: ctx.store.getRecord(account.id), source: acme }).reason, "deleted");
  } finally {
    await ctx.close();
  }
});
