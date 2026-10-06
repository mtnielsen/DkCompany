/**
 * DKC-021 — legal holds: begrundelse, separat godkender og blokering.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildHold, legalHoldProblems, createMemoryRetentionStore, subjectDigestOf } from "../src/holds.mjs";
import { loadPolicy } from "../src/registry.mjs";
import { makeService, fullSurface, APPROVER, PRINCIPAL } from "./support/fixture.mjs";

const DIGEST = "a".repeat(64);

function validHold(overrides = {}) {
  return buildHold({
    tenantId: "acme",
    subjectDigest: DIGEST,
    dataClasses: ["personal"],
    reason: "verserende retssag kræver bevaring",
    placedBy: { subject: "oidc|pia", name: "Pia Privat", role: "privacy-officer" },
    approvedBy: APPROVER,
    ...overrides,
  });
}

test("et gyldigt hold kræver begrundelse og en separat godkender", () => {
  const hold = validHold();
  assert.equal(legalHoldProblems(hold).length, 0);
  assert.equal(hold.status, "active");
});

test("et hold uden begrundelse afvises", () => {
  const problems = legalHoldProblems({ ...validHold(), reason: "kort" });
  assert.ok(problems.some((p) => p.path === "/reason"));
});

test("et hold hvor den der lægger det også godkender afvises", () => {
  const person = { subject: "oidc|pia", name: "Pia Privat", role: "privacy-officer" };
  const problems = legalHoldProblems({ ...validHold(), placedBy: person, approvedBy: person });
  assert.ok(problems.some((p) => p.path === "/approvedBy"));
});

test("subjectDigestOf gemmer aldrig den rå nøgle", () => {
  const digest = subjectDigestOf("kunde@example.org");
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.notEqual(digest, "kunde@example.org");
});

test("et aktivt hold blokerer sletning og sletter intet", () => {
  const policy = loadPolicy();
  const { service } = makeService({ policy, surfaces: [fullSurface("primary-object-store", "primary")] });
  service.placeHold({ principal: PRINCIPAL, tenantId: "acme", subjectKey: "kunde@example.org", reason: "verserende retssag kræver bevaring", approvedBy: APPROVER });
  const receipt = service.requestDeletion({ principal: PRINCIPAL, tenantId: "acme", subjectKey: "kunde@example.org" });
  assert.equal(receipt.status, "blocked-by-hold");
  assert.equal(receipt.summary.recordsAffected, 0);
  assert.equal(receipt.hold.blocked, true);
  assert.equal(receipt.results[0].status, "blocked-by-hold");
});

test("et frigivet hold tillader sletning igen", () => {
  const policy = loadPolicy();
  const { service } = makeService({ policy, surfaces: [fullSurface("primary-object-store", "primary")] });
  const hold = service.placeHold({ principal: PRINCIPAL, tenantId: "acme", subjectKey: "kunde@example.org", reason: "verserende retssag kræver bevaring", approvedBy: APPROVER });
  service.releaseHold({ principal: PRINCIPAL, tenantId: "acme", holdId: hold.holdId, releaseReason: "retssagen er afsluttet" });
  const receipt = service.requestDeletion({ principal: PRINCIPAL, tenantId: "acme", subjectKey: "kunde@example.org" });
  assert.equal(receipt.status, "full");
  assert.equal(receipt.summary.recordsAffected, 1);
});

test("registeret er tenant-bundet og isolerer holds", () => {
  const store = createMemoryRetentionStore();
  store.placeHold("acme", validHold());
  assert.equal(store.listHolds("acme").length, 1);
  assert.equal(store.listHolds("globex").length, 0);
  assert.equal(store.activeHoldsFor("globex", { subjectDigest: DIGEST }).length, 0);
});
