import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateHACluster } from "../src/ha.mjs";
import { repoRoot } from "../src/schemas.mjs";

const example = () => JSON.parse(readFileSync(join(repoRoot, "contracts", "examples", "ha-cluster.example.json"), "utf8"));
const clone = () => structuredClone(example());

test("det committede HA-eksempel validerer med skema og semantik", () => {
  const result = validateHACluster(example());
  assert.equal(result.ok, true, result.errors.map((e) => `${e.path} ${e.message}`).join("; "));
});

test("eksemplet er identisk med den kanoniske plan", () => {
  const plan = JSON.parse(readFileSync(join(repoRoot, "infrastructure", "ha-plan.json"), "utf8"));
  assert.deepEqual(example(), plan);
});

test("skemaet afviser usikre writes ved quorumtab", () => {
  const broken = clone();
  broken.controlPlane.datastore.unsafeWritesOnQuorumLoss = true;
  assert.equal(validateHACluster(broken).ok, false);
});

test("semantikken afviser for få fejldomæner", () => {
  const broken = clone();
  broken.failureDomains = ["fsn1-dc14", "fsn1-dc15"];
  const result = validateHACluster(broken);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.path === "/failureDomains"));
  const collapsed = clone();
  collapsed.controlPlane.members = collapsed.controlPlane.members.map((m) => ({ ...m, failureDomain: "fsn1-dc14" }));
  assert.ok(validateHACluster(collapsed).errors.some((e) => /tre fejldomæner/.test(e.message)));
});

test("semantikken afviser en ikke-redundant DNS-post", () => {
  const broken = clone();
  broken.dns.records[0].targets = ["203.0.113.41"];
  assert.equal(validateHACluster(broken).ok, false);
});

test("semantikken afviser en åben netværkspolitik", () => {
  const broken = clone();
  broken.network.defaultDeny = false;
  assert.equal(validateHACluster(broken).ok, false);
});

test("semantikken afviser en stateless workload uden disruption budget", () => {
  const broken = clone();
  delete broken.workloads[0].disruptionBudget;
  assert.equal(validateHACluster(broken).ok, false);
});

test("semantikken afviser en stateful workload uden ekstern recovery-lokation", () => {
  const broken = clone();
  const dbIndex = broken.workloads.findIndex((w) => w.stateless === false);
  broken.workloads[dbIndex].statefulPlan.recoveryLocation = broken.failureDomains[0];
  assert.equal(validateHACluster(broken).ok, false);
});
