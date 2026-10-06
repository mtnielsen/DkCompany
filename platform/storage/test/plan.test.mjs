import { test } from "node:test";
import assert from "node:assert/strict";
import { loadStoragePlan, storagePlanProblems, storageServiceClassProblems, storageHAProblems, capacityStatus, failureDomainSpread } from "../src/plan.mjs";
import { loadServiceClasses } from "../../continuity/src/classes.mjs";
import { loadHAPlan } from "../../infrastructure/src/ha.mjs";
import { repoRoot } from "../../conformance/src/schemas.mjs";

const plan = loadStoragePlan(repoRoot);
const clone = () => structuredClone(plan);

test("den kanoniske plan er semantisk gyldig", () => {
  assert.deepEqual(storagePlanProblems(plan), []);
});

test("afviser et ikke-vedligeholdt CSI-lager", () => {
  const broken = clone();
  broken.provider.csi.maintained = false;
  assert.ok(storagePlanProblems(broken).some((e) => e.path === "/provider/csi/maintained"));
});

test("afviser færre end tre fejldomæner", () => {
  const broken = clone();
  broken.failureDomains = ["fsn1-dc14"];
  assert.ok(storagePlanProblems(broken).some((e) => e.path === "/failureDomains"));
});

test("afviser usikre writes ved quorumtab", () => {
  const broken = clone();
  broken.topology.unsafeWritesOnQuorumLoss = true;
  assert.ok(storagePlanProblems(broken).some((e) => e.path === "/topology/unsafeWritesOnQuorumLoss"));
});

test("afviser en quorum der ikke er flertal af replikafaktoren", () => {
  const broken = clone();
  broken.topology.quorum = 1;
  assert.ok(storagePlanProblems(broken).some((e) => e.path === "/topology/quorum"));
});

test("afviser autoritative data placeret på ephemeral disk eller uden kryptering", () => {
  const ephemeral = clone();
  ephemeral.dataClasses.find((c) => c.id === "authoritative").ephemeral = true;
  assert.ok(storagePlanProblems(ephemeral).some((e) => e.path === "/dataClasses/authoritative/ephemeral"));
  const unencrypted = clone();
  unencrypted.dataClasses.find((c) => c.id === "authoritative").encryption = "none";
  assert.ok(storagePlanProblems(unencrypted).some((e) => e.path === "/dataClasses/authoritative/encryption"));
});

test("afviser en cache der ikke er genopbyggelig", () => {
  const broken = clone();
  broken.dataClasses.find((c) => c.cache === true).rebuildable = false;
  assert.ok(storagePlanProblems(broken).some((e) => e.path.endsWith("/rebuildable")));
});

test("afviser manglende checksum/scrub og nøgler i lageret", () => {
  const noScrub = clone();
  noScrub.scrub.detectsSilentCorruption = false;
  assert.ok(storagePlanProblems(noScrub).some((e) => e.path === "/scrub/detectsSilentCorruption"));
  const keyInStore = clone();
  keyInStore.keys.storeContainsKey = true;
  assert.ok(storagePlanProblems(keyInStore).some((e) => e.path === "/keys/storeContainsKey"));
});

test("afviser manglende min-free-space og lokale nøgler", () => {
  const noFree = clone();
  noFree.topology.minFreeSpaceBytes = 0;
  assert.ok(storagePlanProblems(noFree).some((e) => e.path === "/topology/minFreeSpaceBytes"));
  const notScoped = clone();
  notScoped.keys.tenantScoped = false;
  assert.ok(storagePlanProblems(notScoped).some((e) => e.path === "/keys/tenantScoped"));
});

test("kapacitetsalarmer udløses under tærsklerne", () => {
  const status = capacityStatus(plan, { "storage-1": plan.capacity.perHostCapacityBytes * 0.90, "storage-2": 0, "storage-3": 0 });
  assert.equal(status.hosts["storage-1"].level, "alarm");
  assert.equal(status.alarms.length, 1);
});

test("fejldomænespredning er tre for den kanoniske plan", () => {
  assert.equal(failureDomainSpread(plan).size, 3);
});

test("krydsvalidering mod serviceklasser og HA-plan er konsistent", () => {
  assert.deepEqual(storageServiceClassProblems(plan, loadServiceClasses()), []);
  assert.deepEqual(storageHAProblems(plan, loadHAPlan(repoRoot)), []);
});
