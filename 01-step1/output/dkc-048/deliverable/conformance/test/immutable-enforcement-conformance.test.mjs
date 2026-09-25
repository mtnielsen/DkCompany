import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateImmutableEnforcement } from "../src/immutable-enforcement.mjs";
import { repoRoot } from "../src/schemas.mjs";

const example = () => JSON.parse(readFileSync(join(repoRoot, "contracts", "examples", "immutable-enforcement.example.json"), "utf8"));
const clone = () => structuredClone(example());

test("det committede immutable-håndhævelses-eksempel validerer med skema og semantik", () => {
  const result = validateImmutableEnforcement(example());
  assert.equal(result.ok, true, result.errors.map((e) => `${e.path} ${e.message}`).join("; "));
});

test("eksemplet er identisk med den kanoniske politik", () => {
  const policy = JSON.parse(readFileSync(join(repoRoot, "data-protection", "enforcement", "immutable-policy.json"), "utf8"));
  assert.deepEqual(example(), policy);
});

test("semantikken afviser en AI-rolle uden de nødvendige forbud", () => {
  const broken = clone();
  const ai = broken.roles.find((r) => r.ai === true);
  ai.forbiddenOperations = ["read"];
  assert.equal(validateImmutableEnforcement(broken).ok, false);
});

test("semantikken afviser at COMPLIANCE kan omgås eller at governance ikke kræver et menneske", () => {
  const bypass = clone();
  bypass.storageProduct.verification.complianceNonBypassable = false;
  assert.ok(validateImmutableEnforcement(bypass).errors.some((e) => e.path.includes("complianceNonBypassable")));
  const governance = clone();
  governance.storageProduct.verification.governanceBypassRequiresHuman = false;
  assert.equal(validateImmutableEnforcement(governance).ok, false);
});

test("semantikken afviser en audit-ingest der kan slette eller opdatere", () => {
  const broken = clone();
  const ingest = broken.roles.find((r) => r.id === broken.auditIngest.role);
  ingest.allowedOperations = ["read", "append", "delete", "update"];
  assert.equal(validateImmutableEnforcement(broken).ok, false);
});

test("semantikken afviser en beskyttet ressource der ikke er sletningsbeskyttet", () => {
  const broken = clone();
  broken.protectedResources[0].deletionProtected = false;
  assert.ok(validateImmutableEnforcement(broken).errors.some((e) => e.path.includes("deletionProtected")));
});

test("semantikken afviser manglende to-personers kontrol", () => {
  const broken = clone();
  broken.twoPersonControl.recoveryAccess.required = false;
  assert.equal(validateImmutableEnforcement(broken).ok, false);
});
