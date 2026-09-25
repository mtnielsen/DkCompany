/**
 * DKC-051 — test af fejl- og katastrofematrixen.
 *
 * Tester matrixens semantik, kørerens determinisme og de enkelte prober mod de
 * rigtige moduler. En målt fejløvelse på en levende klynge er og forbliver
 * NOT RUN.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../../conformance/src/schemas.mjs";
import { validateFailureMatrix } from "../../conformance/src/chaos.mjs";
import { loadFailureMatrix, failureMatrixProblems } from "../src/matrix.mjs";
import { PROBES } from "../src/probes.mjs";
import { runChaos } from "../src/runner.mjs";

const matrix = loadFailureMatrix(repoRoot);

test("den faktiske fejlmatrix har ingen semantiske problemer", () => {
  assert.deepEqual(failureMatrixProblems(matrix), []);
});

test("skema + semantik accepterer matrixen og eksemplet", () => {
  assert.equal(validateFailureMatrix(matrix).ok, true, JSON.stringify(validateFailureMatrix(matrix).errors));
  const example = JSON.parse(readFileSync(join(repoRoot, "contracts/examples/failure-matrix.example.json"), "utf8"));
  assert.equal(validateFailureMatrix(example).ok, true, JSON.stringify(validateFailureMatrix(example).errors));
});

test("semantikken afviser brudte invarianter, manglende scopes og ukendte prober", () => {
  assert.ok(failureMatrixProblems({ ...matrix, invariants: { ...matrix.invariants, noSplitBrain: false } }).length > 0);
  const scopes = matrix.scenarios.filter((s) => s.probe !== "ha-host-loss");
  assert.ok(failureMatrixProblems({ ...matrix, scenarios: scopes }).length > 0);
  const broken = matrix.scenarios.map((s) => (s.id === "ha-host-loss" ? { ...s, failureScope: "ukendt" } : s));
  assert.ok(failureMatrixProblems({ ...matrix, scenarios: broken }).length > 0);
  assert.ok(failureMatrixProblems({ ...matrix, measurement: { ...matrix.measurement, measured: true } }).length > 0);
});

test("køreren består alle 13 scenarier og gaten", async () => {
  const report = await runChaos(repoRoot);
  assert.equal(report.measured, false);
  assert.equal(report.scenarios.length, 13);
  assert.equal(report.gate.status, "pass", JSON.stringify(report.gate.reasons));
  assert.deepEqual(report.deviations, []);
  for (const invariant of Object.keys(matrix.invariants)) assert.equal(report.invariants[invariant], true, invariant);
});

test("køreren er deterministisk og kan gentages fra ren installation", async () => {
  const a = await runChaos(repoRoot);
  const b = await runChaos(repoRoot);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test("hosttab giver ingen split-brain eller tabte kvitterede writes", async () => {
  const result = await PROBES["ha-host-loss"](repoRoot);
  assert.equal(result.ok, true, JSON.stringify(result.checks));
  assert.equal(result.splitBrain, false);
  assert.equal(result.lostAcknowledgedWrites, 0);
});

test("databasefailover og partition taber ingen kvitterede writes", async () => {
  const failover = await PROBES["database-failover"](repoRoot);
  const partition = await PROBES["database-partition"](repoRoot);
  assert.equal(failover.ok, true, JSON.stringify(failover.checks));
  assert.equal(partition.ok, true, JSON.stringify(partition.checks));
  assert.equal(failover.splitBrain, false);
  assert.equal(partition.splitBrain, false);
  assert.equal(failover.lostAcknowledgedWrites, 0);
  assert.equal(partition.lostAcknowledgedWrites, 0);
});

test("diskfuld afvises kontrolleret og bevarer kvitterede data", async () => {
  const result = await PROBES["storage-disk-full"](repoRoot);
  assert.equal(result.ok, true, JSON.stringify(result.checks));
  assert.equal(result.checks.newWriteRejected, true);
  assert.equal(result.checks.acknowledgedIntact, true);
});

test("korruption opdages og repareres", async () => {
  const result = await PROBES["storage-corruption"](repoRoot);
  assert.equal(result.ok, true, JSON.stringify(result.checks));
  assert.equal(result.checks.silentCorruptionDetected, true);
  assert.equal(result.checks.repairRestoresReplica, true);
});

test("kø-replay giver ingen dobbelt sideeffekt eller tab", async () => {
  const result = await PROBES["queue-replay"](repoRoot);
  assert.equal(result.ok, true, JSON.stringify(result.checks));
  assert.equal(result.checks.handledExactlyOnce, true);
  assert.equal(result.checks.replayedWithoutSideEffect, true);
});

test("dedup-prune frigiver kun udløbne, urefererede blokke", async () => {
  const result = await PROBES["dedup-prune"](repoRoot);
  assert.equal(result.ok, true, JSON.stringify(result.checks));
  assert.equal(result.checks.leaseRequired, true);
  assert.equal(result.checks.protectedSurvives, true);
  assert.equal(result.checks.reclaimedUniqueChunks, true);
});

test("immutable-bypass afvises og logges", async () => {
  const result = await PROBES["immutable-bypass"](repoRoot);
  assert.equal(result.ok, true, JSON.stringify(result.checks));
  assert.ok(result.bypassesDenied > 0);
  assert.ok(result.bypassesLogged >= result.bypassesDenied);
  assert.equal(result.checks.complianceNonBypassable, true);
});

test("KMS-utilgængelighed stopper mutationer fail-closed", async () => {
  const result = await PROBES["kms-unavailability"](repoRoot);
  assert.equal(result.ok, true, JSON.stringify(result.checks));
  assert.equal(result.checks.writeBlockedFailClosed, true);
  assert.equal(result.checks.acknowledgedIntact, true);
});

test("healingstorm stoppes af fælles budget og menneskelig eskalation", async () => {
  const result = await PROBES["healing-storm"](repoRoot);
  assert.equal(result.ok, true, JSON.stringify(result.checks));
  assert.equal(result.budgetBounded, true);
  assert.equal(result.escalatedToHuman, true);
  assert.equal(result.checks.furtherRepairRefused, true);
});

test("site-restore genopretter i et isoleret miljø og består gaten", async () => {
  const result = await PROBES["site-restore"](repoRoot);
  assert.equal(result.ok, true, JSON.stringify(result.checks));
  assert.equal(result.checks.primaryClusterUnavailable, true);
  assert.equal(result.checks.gatePass, true);
});

test("kontroltjenestetab bruger kun sikker fallback med menneskelig autorisation", async () => {
  const result = await PROBES["control-plane-loss"](repoRoot);
  assert.equal(result.ok, true, JSON.stringify(result.checks));
  assert.equal(result.checks.requiresHumanAuthorization, true);
  assert.equal(result.checks.noMutatingFallback, true);
});
