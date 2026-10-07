import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateDatabaseHA } from "../src/database-ha.mjs";
import { canServeRead } from "../../persistence/src/ha.mjs";
import { repoRoot } from "../src/schemas.mjs";

const example = () => JSON.parse(readFileSync(join(repoRoot, "contracts", "examples", "database-ha.example.json"), "utf8"));
const clone = () => structuredClone(example());

test("det committede database-HA-eksempel validerer med skema og semantik", () => {
  const result = validateDatabaseHA(example());
  assert.equal(result.ok, true, result.errors.map((e) => `${e.path} ${e.message}`).join("; "));
});

test("eksemplet er identisk med den kanoniske plan", () => {
  const plan = JSON.parse(readFileSync(join(repoRoot, "persistence", "ha-plan.json"), "utf8"));
  assert.deepEqual(example(), plan);
});

test("semantikken afviser en ikke-vedligeholdt operator", () => {
  const broken = clone();
  broken.engine.operatorMaintained = false;
  assert.ok(validateDatabaseHA(broken).errors.some((e) => e.path === "/engine/operatorMaintained"));
});

test("semantikken afviser en quorum der ikke er flertal af de stemmeberettigede", () => {
  const broken = clone();
  broken.topology.quorum = 1;
  assert.ok(validateDatabaseHA(broken).errors.some((e) => e.path === "/topology/quorum"));
});

test("semantikken afviser tavs async-overgang og usikker promotion", () => {
  const silent = clone();
  silent.topology.noSilentAsyncFallback = false;
  assert.equal(validateDatabaseHA(silent).ok, false);
  const unsafe = clone();
  unsafe.fencing.allowUnsafePromotion = true;
  assert.equal(validateDatabaseHA(unsafe).ok, false);
});

test("semantikken afviser godkendelser læst fra en replica", () => {
  const broken = clone();
  broken.readConsistency.find((f) => f.flow === "approvals").require = "primary-or-sync-committed";
  assert.ok(validateDatabaseHA(broken).errors.some((e) => e.path === "/readConsistency/approvals"));
});

test("semantikken afviser manglende WAL/PITR og fence-fri failback", () => {
  const noArchive = clone();
  noArchive.wal.archiveEnabled = false;
  assert.equal(validateDatabaseHA(noArchive).ok, false);
  const noRejoinFence = clone();
  noRejoinFence.rejoin.requiresFence = false;
  assert.equal(validateDatabaseHA(noRejoinFence).ok, false);
});

test("read-consistency afviser forældede replikaer for godkendelser", () => {
  const plan = example();
  assert.equal(canServeRead(plan, "approvals", "primary").ok, true);
  assert.equal(canServeRead(plan, "approvals", "sync-replica").ok, false);
  assert.equal(canServeRead(plan, "approvals", "async-replica").ok, false);
});
