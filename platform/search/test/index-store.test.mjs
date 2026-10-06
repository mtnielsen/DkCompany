import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileKnowledgeIndex } from "../src/index-store.mjs";
import { aclDigest } from "../src/bookstack.mjs";

function doc(overrides = {}) {
  return {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "KnowledgeDocument",
    id: "src:doc-1",
    sourceId: "src",
    tenantId: "acme",
    externalId: "doc-1",
    title: "Titel",
    classification: "internal",
    acl: { readGroups: ["acme"], readSubjects: [], denyGroups: [], denySubjects: [], ownerSubject: null },
    contentSha256: "a".repeat(64),
    updatedAt: "2026-01-01T00:00:00Z",
    deletedAt: null,
    content: "indhold",
    bookstack: { book: "b", chapter: null, slug: "s", url: "https://example.org/s" },
    ...overrides,
  };
}

test("indekset overlever en genstart (faktisk fillager)", () => {
  const dir = mkdtempSync(join(tmpdir(), "dkc028-store-"));
  try {
    const first = FileKnowledgeIndex.open(dir);
    first.upsert(doc());
    const second = FileKnowledgeIndex.open(dir);
    assert.equal(second.size(), 1);
    assert.equal(second.get("src:doc-1").title, "Titel");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("en ACL-ændring hæver epoken", () => {
  const dir = mkdtempSync(join(tmpdir(), "dkc028-store-"));
  try {
    const index = FileKnowledgeIndex.open(dir);
    index.upsert(doc());
    const before = index.epoch();
    index.upsert(doc({ acl: { readGroups: ["hr"], readSubjects: [], denyGroups: [], denySubjects: [], ownerSubject: null } }));
    assert.ok(index.epoch() > before);
    assert.notEqual(aclDigest(index.get("src:doc-1")), aclDigest(doc()));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("en sletning er en tombstone der ikke genopstår", () => {
  const dir = mkdtempSync(join(tmpdir(), "dkc028-store-"));
  try {
    const index = FileKnowledgeIndex.open(dir);
    index.upsert(doc());
    assert.equal(index.remove("src:doc-1", { at: "2026-03-01T00:00:00Z" }), true);
    assert.equal(index.isDeleted("src:doc-1"), true);
    assert.equal(index.list().length, 0);
    assert.equal(index.get("src:doc-1").deletedAt, "2026-03-01T00:00:00Z");
    const reloaded = FileKnowledgeIndex.open(dir);
    assert.equal(reloaded.list().length, 0);
    assert.equal(reloaded.isDeleted("src:doc-1"), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
