import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateStoragePlan } from "../src/storage.mjs";
import { repoRoot } from "../src/schemas.mjs";

const example = () => JSON.parse(readFileSync(join(repoRoot, "contracts", "examples", "storage-plan.example.json"), "utf8"));
const clone = () => structuredClone(example());

test("det committede lagerplan-eksempel validerer med skema og semantik", () => {
  const result = validateStoragePlan(example());
  assert.equal(result.ok, true, result.errors.map((e) => `${e.path} ${e.message}`).join("; "));
});

test("eksemplet er identisk med den kanoniske plan", () => {
  const plan = JSON.parse(readFileSync(join(repoRoot, "storage", "storage-plan.json"), "utf8"));
  assert.deepEqual(example(), plan);
});

test("semantikken afviser et ikke-vedligeholdt eller udokumenteret CSI-lager", () => {
  const unmaintained = clone();
  unmaintained.provider.csi.maintained = false;
  assert.ok(validateStoragePlan(unmaintained).errors.some((e) => e.path === "/provider/csi/maintained"));
  const undocumented = clone();
  undocumented.provider.csi.documented = false;
  assert.equal(validateStoragePlan(undocumented).ok, false);
});

test("semantikken afviser en quorum der ikke er flertal", () => {
  const broken = clone();
  broken.topology.quorum = 1;
  assert.ok(validateStoragePlan(broken).errors.some((e) => e.path === "/topology/quorum"));
});

test("semantikken afviser usikre writes og nødvendig tilstand på ephemeral disk", () => {
  const unsafe = clone();
  unsafe.topology.unsafeWritesOnQuorumLoss = true;
  assert.equal(validateStoragePlan(unsafe).ok, false);
  const ephemeral = clone();
  ephemeral.topology.ephemeralDiskRequiredState = true;
  assert.equal(validateStoragePlan(ephemeral).ok, false);
});

test("semantikken afviser nøgler i lageret og manglende scrub-repair", () => {
  const keyInStore = clone();
  keyInStore.keys.storeContainsKey = true;
  assert.equal(validateStoragePlan(keyInStore).ok, false);
  const noRepair = clone();
  noRepair.scrub.repair = false;
  assert.equal(validateStoragePlan(noRepair).ok, false);
});

test("semantikken afviser en autoritativ klasse uden kryptering", () => {
  const broken = clone();
  broken.dataClasses.find((c) => c.id === "authoritative").encryption = "none";
  assert.ok(validateStoragePlan(broken).errors.some((e) => e.path === "/dataClasses/authoritative/encryption"));
});
