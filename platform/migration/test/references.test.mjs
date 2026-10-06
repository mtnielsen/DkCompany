import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReference, parseReference, assertReferenceTenant, referenceDigest, MigrationReferenceError } from "../src/references.mjs";

test("bygger en stabil, tenantafgrænset reference", () => {
  const reference = buildReference({ tenantId: "acme", appId: "files", entityType: "File", sourceObjectId: "nc-1001" });
  assert.equal(reference, "mig:acme:files:File:nc-1001");
  assert.deepEqual(parseReference(reference), { tenantId: "acme", appId: "files", entityType: "File", sourceObjectId: "nc-1001" });
});

test("afviser en ukendt app eller entitetstype", () => {
  assert.throws(() => buildReference({ tenantId: "acme", appId: "unknown", entityType: "File", sourceObjectId: "1" }), MigrationReferenceError);
  assert.throws(() => buildReference({ tenantId: "acme", appId: "files", entityType: "Ticket", sourceObjectId: "1" }), MigrationReferenceError);
});

test("afviser en tværtenant-reference (fail-closed)", () => {
  const reference = buildReference({ tenantId: "globex", appId: "crm", entityType: "Contact", sourceObjectId: "1" });
  assert.throws(() => assertReferenceTenant(reference, "acme"), (error) => error.code === "cross_tenant_reference");
  assert.deepEqual(assertReferenceTenant(reference, "globex").tenantId, "globex");
});

test("digesten lækker ikke kilde-id'et", () => {
  const digest = referenceDigest("mig:acme:files:File:nc-1001");
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.ok(!digest.includes("nc-1001"));
});
