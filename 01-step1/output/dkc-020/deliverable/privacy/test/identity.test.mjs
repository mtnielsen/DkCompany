import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeIdentifier, subjectMatch, filterSubjectRecords, IdentityMatchError } from "../src/identity.mjs";

const acmeEmail = [normalizeIdentifier({ type: "email", value: "Kunde@Example.org" })];

test("e-mail normaliseres til små bogstaver og tomme værdier afvises", () => {
  assert.equal(normalizeIdentifier({ type: "email", value: "  Kunde@Example.ORG " }).normalised, "kunde@example.org");
  assert.throws(() => normalizeIdentifier({ type: "email", value: "   " }), IdentityMatchError);
  assert.throws(() => normalizeIdentifier({ type: "ukendt", value: "x" }), IdentityMatchError);
});

test("en fremmed tenant matcher aldrig, selv med identisk e-mailtekst", () => {
  assert.equal(subjectMatch({ tenantId: "acme", identifiers: acmeEmail, record: { tenantId: "globex", identifiers: [{ type: "email", value: "kunde@example.org" }] } }), false);
  assert.equal(subjectMatch({ tenantId: "acme", identifiers: acmeEmail, record: { tenantId: "acme", identifiers: [{ type: "email", value: "kunde@example.org" }] } }), true);
});

test("en post med en eksplicit anden ejer filtreres fra", () => {
  const { records, dropped } = filterSubjectRecords({
    tenantId: "acme",
    identifiers: acmeEmail,
    records: [
      { subjectId: "u1", tenantId: "acme", identifiers: [{ type: "email", value: "kunde@example.org" }] },
      { subjectId: "u2", tenantId: "acme", identifiers: [{ type: "email", value: "anden@example.org" }] },
      { subjectId: "u3", tenantId: "acme" }, // eksplicit anden ejer uden identifikator
    ],
  });
  assert.equal(records.length, 1);
  assert.equal(dropped, 2);
});
