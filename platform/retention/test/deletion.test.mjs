/**
 * DKC-021 — sletteforløbet: dækning, ærlig partial og redaktion.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPolicy } from "../src/registry.mjs";
import { createMemoryAuditTrail } from "../src/audit.mjs";
import { AuthorizationError } from "../../identity/src/errors.mjs";
import { makeService, fullSurface, partialSurface, unsupportedSurface, PRINCIPAL } from "./support/fixture.mjs";

function surfaces() {
  return [
    fullSurface("primary-object-store", "primary"),
    fullSurface("rebuildable-index", "index"),
    fullSurface("ephemeral-cache", "cache"),
    partialSurface("derived-ai-store", "derived-ai", "leverandøren kan ikke slette afledte kopier"),
    partialSurface("protected-backup", "backup", "historisk backup er WORM-låst"),
    unsupportedSurface("upstream-model-provider", "upstream", "leverandøren udstiller ingen slette-API"),
  ];
}

test("en sletning dækker alle flader og rapporterer partial ærligt", () => {
  const { service } = makeService({ policy: loadPolicy(), surfaces: surfaces() });
  const receipt = service.requestDeletion({ principal: PRINCIPAL, tenantId: "acme", subjectKey: "kunde@example.org" });
  assert.equal(receipt.status, "partial");
  assert.equal(receipt.summary.surfaces, 6);
  assert.equal(receipt.summary.full, 3);
  assert.equal(receipt.summary.partial, 2);
  assert.equal(receipt.summary.unsupported, 1);
  assert.ok(receipt.summary.remainingCopies >= 3);
  for (const result of receipt.results.filter((r) => r.status === "partial" || r.status === "unsupported")) {
    assert.ok(result.reason, `manglende begrundelse for ${result.surface}`);
  }
});

test("en manglende upstreammulighed giver partial med præcis årsag og udløb", () => {
  const { service } = makeService({ policy: loadPolicy(), surfaces: [unsupportedSurface("upstream-model-provider", "upstream", "leverandøren udstiller ingen slette-API")] });
  const receipt = service.requestDeletion({ principal: PRINCIPAL, tenantId: "acme", subjectKey: "kunde@example.org" });
  assert.equal(receipt.status, "unsupported");
  const copy = receipt.results[0].remainingCopies[0];
  assert.equal(copy.reason, "leverandøren udstiller ingen slette-API");
  assert.ok(!Number.isNaN(Date.parse(copy.expiresAt)));
});

test("revisionsintentet skrives før mutationen og indeholder kun digest", () => {
  const order = [];
  const audit = {
    begin(intent) {
      order.push("intent");
      return { intentId: "intent-1", ...intent };
    },
    complete(intentId, outcome) {
      order.push("outcome");
      return { outcomeId: "outcome-1", intentId, ...outcome };
    },
  };
  const primary = fullSurface("primary-object-store", "primary");
  const originalErase = primary.erase;
  primary.erase = (...args) => {
    order.push("erase");
    return originalErase(...args);
  };
  const { service } = makeService({ policy: loadPolicy(), surfaces: [primary], audit });
  const receipt = service.requestDeletion({ principal: PRINCIPAL, tenantId: "acme", subjectKey: "kunde@example.org" });
  assert.deepEqual(order, ["intent", "erase", "outcome"]);
  assert.equal(receipt.audit.intentId, "intent-1");
  assert.equal(receipt.audit.outcomeId, "outcome-1");
  assert.equal(receipt.audit.containsRawPersonalData, false);
});

test("revisionssporet og kvitteringen indeholder ikke den rå identifikator", () => {
  const audit = createMemoryAuditTrail();
  const { service } = makeService({ policy: loadPolicy(), surfaces: surfaces(), audit });
  const receipt = service.requestDeletion({ principal: PRINCIPAL, tenantId: "acme", subjectKey: "kunde@example.org" });
  const serialized = JSON.stringify({ receipt, intents: audit.intents(), outcomes: audit.outcomes() });
  assert.ok(!serialized.includes("kunde@example.org"));
  assert.ok(serialized.includes(receipt.subjectDigest));
});

test("en AI-principal må hverken slette eller lægge hold", () => {
  const { service } = makeService({ policy: loadPolicy(), surfaces: surfaces() });
  const agent = { id: "agent|slet", name: "Sletteagent", tenantId: "acme", roles: ["privacy-officer"], kind: "agent" };
  assert.throws(() => service.requestDeletion({ principal: agent, tenantId: "acme", subjectKey: "kunde@example.org" }), (err) => err instanceof AuthorizationError && err.code === "ai_denied");
});

test("en principal uden sletterolle afvises (default-deny)", () => {
  const { service } = makeService({ policy: loadPolicy(), surfaces: surfaces() });
  const nobody = { id: "oidc|nogen", name: "Nogen", tenantId: "acme", roles: ["viewer"], kind: "human" };
  assert.throws(() => service.requestDeletion({ principal: nobody, tenantId: "acme", subjectKey: "kunde@example.org" }), (err) => err.code === "deletion_forbidden");
});

test("en fremmed tenant afvises", () => {
  const { service } = makeService({ policy: loadPolicy(), surfaces: surfaces() });
  assert.throws(() => service.requestDeletion({ principal: PRINCIPAL, tenantId: "globex", subjectKey: "kunde@example.org" }), (err) => err.code === "tenant_forbidden");
});
