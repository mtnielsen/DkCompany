import { test } from "node:test";
import assert from "node:assert/strict";
import { setupSearch, EMPLOYEE } from "./helpers.mjs";
import { SearchCache, reconcilePermissions, deleteDocument, measureDeletionDeadline } from "../src/invalidation.mjs";
import { retrievalCacheKey } from "../src/retrieval.mjs";
import { mapPageToDocument } from "../src/bookstack.mjs";

test("cachen invalideres når epoken ændres", async () => {
  const { index, close } = await setupSearch();
  try {
    const cache = new SearchCache();
    const key = retrievalCacheKey({ tenantId: "acme", subject: EMPLOYEE.id, query: "onboarding", epoch: index.epoch() });
    cache.set(key, "svar", { epoch: index.epoch(), at: 0 });
    assert.equal(cache.get(key, { epoch: index.epoch(), now: 0, ttlSeconds: 60 }), "svar");
    index.bump("acl-change", "2026-03-01T00:00:00Z");
    assert.equal(cache.get(key, { epoch: index.epoch(), now: 0, ttlSeconds: 60 }), null);
  } finally {
    await close();
  }
});

test("reconcile opdaterer ændret ACL og fjerner slettede dokumenter", async () => {
  const { index, mock, all, close } = await setupSearch();
  try {
    const source = all.sources.sources.find((s) => s.id === "bookstack-acme");
    // Ændr arkitektur-sidens ACL og slet onboarding.
    mock.setPermissions("acme", "page-architecture", { readGroups: ["hr"], readSubjects: [], denyGroups: [], denySubjects: [] });
    mock.deletePage("acme", "page-onboarding");
    const currentDocs = index.listBySource("bookstack-acme").map((doc) => {
      const page = mock.getPage("acme", doc.externalId);
      return mapPageToDocument(page, { source, permissions: page?.permissions ?? doc.acl });
    });
    const result = reconcilePermissions({ index, sourceDocuments: currentDocs, at: "2026-03-01T00:00:00Z" });
    assert.ok(result.deleted.includes("bookstack-acme:page-onboarding"));
    assert.ok(result.changed.includes("bookstack-acme:page-architecture"));
    assert.equal(index.get("bookstack-acme:page-onboarding").deletedAt !== null, true);
  } finally {
    await close();
  }
});

test("slettefristen måles deterministisk", async () => {
  const { index, close } = await setupSearch();
  try {
    const id = "bookstack-acme:page-security";
    const deleted = deleteDocument({ index, id, at: "2026-03-01T00:00:00Z" });
    const measurement = measureDeletionDeadline({ index, id, deletedAt: deleted.deletedAt, observedAt: "2026-03-01T00:00:00Z", deadlineSeconds: 300 });
    assert.equal(measurement.removedFromIndex, true);
    assert.equal(measurement.withinDeadline, true);
    assert.equal(measurement.measured, false);
  } finally {
    await close();
  }
});
