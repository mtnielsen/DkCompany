import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, AT } from "./helpers.mjs";
import { dedupKeyFor, planImport, mergeBusinessRecords } from "../src/dedup.mjs";
import { mapSourceObject } from "../src/mapping.mjs";
import { importBatch } from "../src/import.mjs";

test("dedup-nøglen er deterministisk og tenantafgrænset", () => {
  const { all, sourceById, objectsFor } = fixture();
  const source = sourceById("crm-acme");
  const object = objectsFor(source)[0];
  const a = dedupKeyFor({ tenantId: "acme", appId: "crm", entityType: "Contact", object, dedupKeys: source.dedupKeys });
  const b = dedupKeyFor({ tenantId: "acme", appId: "crm", entityType: "Contact", object, dedupKeys: source.dedupKeys });
  const c = dedupKeyFor({ tenantId: "globex", appId: "crm", entityType: "Contact", object, dedupKeys: source.dedupKeys });
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^[a-f0-9]{64}$/);
});

test("en dubleret forretningsidentitet bliver en konflikt, ikke en fletning", () => {
  const { store, sourceById, objectsFor, coverage } = fixture();
  const source = sourceById("crm-acme");
  const objects = objectsFor(source);
  const result = importBatch({ store, source, objects, coverage, at: AT });
  assert.equal(result.counts.conflicts, 1);
  assert.equal(result.counts.created, 1);
  assert.equal(store.listRecords({ tenantId: "acme", appId: "crm" }).length, 1);
  assert.ok(result.conflicts[0].existingReference);
});

test("planImport klassificerer replay, create og update", () => {
  const { store, sourceById, objectsFor, coverage } = fixture();
  const source = sourceById("files-acme");
  const object = objectsFor(source)[0];
  const create = planImport({ store, source, object });
  assert.equal(create.action, "create");
  importBatch({ store, source, objects: [object], coverage, at: AT });
  const update = planImport({ store, source, object });
  assert.equal(update.action, "update");
  const replay = planImport({ store, source, object, idempotencyKey: `${source.id}:${object.entityType}:${object.sourceObjectId}` });
  assert.equal(replay.action, "replay");
});

test("storage-dedup må aldrig flette forretningsposter", () => {
  assert.throws(() => mergeBusinessRecords(), (error) => error.code === "business-record-never-merge");
});

test("mapping bevarer ejerskab, ACL og facetter", () => {
  const { sourceById, objectsFor } = fixture();
  const source = sourceById("files-acme");
  const record = mapSourceObject({ source, object: objectsFor(source)[0], at: AT });
  assert.equal(record.owner.subject, "oidc|ada.acme");
  assert.deepEqual(record.acl.readGroups, ["group:sales"]);
  assert.equal(record.mappedFacets.ownership, true);
  assert.equal(record.reference.startsWith("mig:acme:files:File:"), true);
});
