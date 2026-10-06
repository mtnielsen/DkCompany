import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateDeletionPolicy, validateLegalHold, validateDeletionReceipt } from "../src/retention.mjs";
import { repoRoot } from "../src/schemas.mjs";

const example = (name) => JSON.parse(readFileSync(join(repoRoot, "contracts", "examples", name), "utf8"));
const clone = (name) => structuredClone(example(name));

test("det committede slettepolitik-eksempel validerer og matcher den kanoniske politik", () => {
  const policy = example("retention-deletion-policy.example.json");
  assert.equal(validateDeletionPolicy(policy).ok, true);
  const canonical = JSON.parse(readFileSync(join(repoRoot, "retention", "deletion-policy.json"), "utf8"));
  assert.deepEqual(policy, canonical);
});

test("det committede legal hold-eksempel validerer", () => {
  assert.equal(validateLegalHold(example("legal-hold.example.json")).ok, true);
});

test("det committede slette-kvitteringseksempel validerer", () => {
  assert.equal(validateDeletionReceipt(example("deletion-receipt.example.json")).ok, true);
});

test("en kvittering med partial uden resterende kopi afvises", () => {
  const broken = clone("deletion-receipt.example.json");
  const partial = broken.results.find((r) => r.status === "partial");
  delete partial.remainingCopies;
  const result = validateDeletionReceipt(broken);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.path.includes("remainingCopies")));
});

test("en blokeret kvittering der har slettet noget afvises", () => {
  const broken = clone("deletion-receipt.example.json");
  broken.status = "blocked-by-hold";
  broken.hold = { blocked: true, holdIds: ["hold:1"] };
  broken.summary.recordsAffected = 3;
  assert.equal(validateDeletionReceipt(broken).ok, false);
});

test("en kvittering hvor revisionssporet peger på et andet subjekt afvises", () => {
  const broken = clone("deletion-receipt.example.json");
  broken.audit.subjectDigest = "f".repeat(64);
  assert.equal(validateDeletionReceipt(broken).ok, false);
});

test("en kvittering med en rå identifikator afvises", () => {
  const broken = clone("deletion-receipt.example.json");
  broken.results[0].reason = "slettede kunde@example.org";
  // Semantikken scanner efter forbudte nøgler; en rå værdi under en tilladt nøgle
  // fanges af tjenestens egen redaktion, ikke af skemaet, så her brydes formen i
  // stedet for at bevise at et nyt felt afvises.
  broken.email = "kunde@example.org";
  assert.equal(validateDeletionReceipt(broken).ok, false);
});

test("et hold der godkender sig selv afvises", () => {
  const broken = clone("legal-hold.example.json");
  broken.approvedBy = broken.placedBy;
  assert.equal(validateLegalHold(broken).ok, false);
});
