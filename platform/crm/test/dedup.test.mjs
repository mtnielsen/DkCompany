import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileCrmStore } from "../src/store.mjs";
import { dedupKeyFor, planImport, mergeBusinessRecords } from "../src/dedup.mjs";

const DEDUP_KEYS = { Contact: ["emailAddress"] };

function withStore(fn) {
  const dir = mkdtempSync(join(tmpdir(), "dkc030-dedup-"));
  const store = FileCrmStore.open(dir);
  try {
    return fn(store);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("en dedup-nøgle er deterministisk og tenantafgrænset", () => {
  const a = dedupKeyFor({ tenantId: "acme", entityType: "Contact", record: { emailAddress: "a@b.dk" }, dedupKeys: DEDUP_KEYS });
  const b = dedupKeyFor({ tenantId: "acme", entityType: "Contact", record: { emailAddress: "A@B.DK" }, dedupKeys: DEDUP_KEYS });
  const c = dedupKeyFor({ tenantId: "globex", entityType: "Contact", record: { emailAddress: "a@b.dk" }, dedupKeys: DEDUP_KEYS });
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test("en manglende identitetsfelt afvises", () => {
  assert.throws(() => dedupKeyFor({ tenantId: "acme", entityType: "Contact", record: {}, dedupKeys: DEDUP_KEYS }), (err) => err.code === "missing_identity_field");
});

test("planImport opdaterer på samme reference og varsler konflikt på en anden", () => {
  withStore((store) => {
    const record = {
      id: "crm:acme:Contact:2001",
      reference: "crm:acme:Contact:2001",
      tenantId: "acme",
      entityType: "Contact",
      upstreamId: "2001",
      name: "A",
      classification: "personal",
      owner: { subject: "oidc|ada.acme", tenantId: "acme" },
      roles: ["sales"],
      dedupKey: dedupKeyFor({ tenantId: "acme", entityType: "Contact", record: { emailAddress: "a@b.dk" }, dedupKeys: DEDUP_KEYS }),
      version: 1,
      acl: { readGroups: [], readSubjects: [], denyGroups: [], denySubjects: [] },
      data: { emailAddress: "a@b.dk" },
      copies: [],
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      deletedAt: null,
    };
    store.upsertRecord(record);
    const same = planImport({ store, reference: "crm:acme:Contact:2001", tenantId: "acme", entityType: "Contact", record: { emailAddress: "a@b.dk" }, dedupKeys: DEDUP_KEYS });
    assert.equal(same.action, "update");
    const conflict = planImport({ store, reference: "crm:acme:Contact:9999", tenantId: "acme", entityType: "Contact", record: { emailAddress: "a@b.dk" }, dedupKeys: DEDUP_KEYS });
    assert.equal(conflict.action, "conflict");
    assert.equal(conflict.existing.reference, "crm:acme:Contact:2001");
  });
});

test("storage-dedup må aldrig flette forretningsposter", () => {
  assert.throws(() => mergeBusinessRecords(), (err) => err.code === "business-record-never-merge");
});
