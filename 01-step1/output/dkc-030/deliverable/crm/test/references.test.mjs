import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReference, parseReference, assertReferenceTenant, CrmReferenceError } from "../src/references.mjs";

test("en stabil reference er tenantafgrænset og parses tilbage", () => {
  const reference = buildReference({ tenantId: "acme", entityType: "Contact", upstreamId: "2001" });
  assert.equal(reference, "crm:acme:Contact:2001");
  assert.deepEqual(parseReference(reference), { tenantId: "acme", entityType: "Contact", upstreamId: "2001" });
});

test("en reference fra en anden tenant afvises", () => {
  assert.throws(() => assertReferenceTenant("crm:globex:Contact:9", "acme"), (err) => err instanceof CrmReferenceError && err.code === "cross_tenant_reference");
});

test("en ukendt entitetstype afvises", () => {
  assert.throws(() => buildReference({ tenantId: "acme", entityType: "Invoice", upstreamId: "1" }), (err) => err.code === "unknown_entity");
});

test("en reference er stabil uanset hvor mange gange den bygges", () => {
  const a = buildReference({ tenantId: "acme", entityType: "Account", upstreamId: "1001" });
  const b = buildReference({ tenantId: "acme", entityType: "Account", upstreamId: "1001" });
  assert.equal(a, b);
});
