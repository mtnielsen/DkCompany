/**
 * DKC-039 — database-HA med fencing og konsistent failover.
 *
 * Testene efterprøver den faktiske replikeringsprotokol over SQLite-lagret
 * (sync-quorum, commitkvitteringer, fencing, partition, rejoin) og planens
 * beslutningssemantik. En målt failover på en rigtig motor er ikke en del af
 * denne kørsel.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../src/db.mjs";
import { createMigrator } from "../src/migrations.mjs";
import { createReplicaCluster, digestOf } from "../src/replication.mjs";
import {
  loadDatabaseHAPlan,
  databaseHAPlanProblems,
  canServeRead,
  databaseHAServiceClassProblems,
  quorumFor,
} from "../src/ha.mjs";
import { runDatabaseFailoverDrill } from "../src/ha-drill.mjs";

const plan = loadDatabaseHAPlan(join(import.meta.dirname, "..", ".."));
const clone = () => structuredClone(plan);

function clusterFixture({ minSyncReplicasForWrites = plan.topology.minSyncReplicasForWrites } = {}) {
  const instances = plan.topology.instances.map((i) => ({ id: i.id, failureDomain: i.failureDomain, role: i.role, db: openDatabase() }));
  const cluster = createReplicaCluster({ instances, quorum: plan.topology.quorum, minSyncReplicasForWrites });
  return { cluster, instances };
}

/* -------------------------------------------------------------------------- */
/* Semantik                                                                   */
/* -------------------------------------------------------------------------- */

test("den kanoniske plan validerer semantisk", () => {
  assert.deepEqual(databaseHAPlanProblems(plan), []);
});

test("semantikken afviser en ikke-vedligeholdt operator", () => {
  const broken = clone();
  broken.engine.operatorMaintained = false;
  assert.ok(databaseHAPlanProblems(broken).some((e) => e.path === "/engine/operatorMaintained"));
});

test("semantikken afviser færre end tre fejldomæner og en dårlig quorum", () => {
  const fewDomains = clone();
  fewDomains.failureDomains = ["eu-west-1a", "eu-west-1b"];
  assert.ok(databaseHAPlanProblems(fewDomains).some((e) => e.path === "/failureDomains"));
  const badQuorum = clone();
  badQuorum.topology.quorum = 1;
  assert.ok(databaseHAPlanProblems(badQuorum).some((e) => e.path === "/topology/quorum"));
  assert.equal(quorumFor(3), 2);
});

test("semantikken afviser tavs async-overgang og async som commitkvittering", () => {
  const silent = clone();
  silent.topology.noSilentAsyncFallback = false;
  assert.ok(databaseHAPlanProblems(silent).some((e) => e.path === "/topology/noSilentAsyncFallback"));
  const asyncAck = clone();
  asyncAck.durability.asyncReplicasAreNotAck = false;
  assert.ok(databaseHAPlanProblems(asyncAck).some((e) => e.path === "/durability/asyncReplicasAreNotAck"));
  const lossPolicy = clone();
  lossPolicy.durability.onSyncReplicaLoss = "downgrade-to-async";
  assert.ok(databaseHAPlanProblems(lossPolicy).some((e) => e.path === "/durability/onSyncReplicaLoss"));
});

test("semantikken afviser usikker promotion og manglende fencing", () => {
  const unsafe = clone();
  unsafe.fencing.allowUnsafePromotion = true;
  assert.ok(databaseHAPlanProblems(unsafe).some((e) => e.path === "/fencing/allowUnsafePromotion"));
  const noFenceBefore = clone();
  noFenceBefore.fencing.requireFenceBeforePromotion = false;
  assert.ok(databaseHAPlanProblems(noFenceBefore).some((e) => e.path === "/fencing/requireFenceBeforePromotion"));
});

test("semantikken afviser godkendelser læst fra en replica", () => {
  const broken = clone();
  broken.readConsistency.find((f) => f.flow === "approvals").require = "bounded-staleness";
  assert.ok(databaseHAPlanProblems(broken).some((e) => e.path === "/readConsistency/approvals"));
});

test("semantikken afviser manglende WAL/PITR og fence-fri failback", () => {
  const noPitr = clone();
  noPitr.wal.pitrEnabled = false;
  assert.ok(databaseHAPlanProblems(noPitr).some((e) => e.path === "/wal/pitrEnabled"));
  const noFailbackFence = clone();
  noFailbackFence.failback.requiresFence = false;
  assert.ok(databaseHAPlanProblems(noFailbackFence).some((e) => e.path === "/failback/requiresFence"));
});

test("read-consistency: godkendelser må ikke læses fra sync- eller async-replika", () => {
  assert.equal(canServeRead(plan, "approvals", "primary").ok, true);
  assert.equal(canServeRead(plan, "approvals", "sync-replica").ok, false);
  assert.equal(canServeRead(plan, "approvals", "async-replica").ok, false);
  assert.equal(canServeRead(plan, "reporting", "async-replica").ok, true);
  assert.equal(canServeRead(plan, "policy-decisions", "async-replica").ok, false);
});

test("krydsvalidering mod serviceklasserne finder ingen konflikt", () => {
  const serviceClasses = [
    { moduleRef: "audit-service", data: { moduleRef: "audit-service", deploymentProfileCompatibility: { haEligible: true, failureDomains: 3 }, replication: { replicas: 3, writeMode: "leader-elected", consistency: "strong", upstreamSupportsMultiWriter: false } } },
  ];
  assert.deepEqual(databaseHAServiceClassProblems(plan, serviceClasses), []);
  const impossible = structuredClone(serviceClasses);
  impossible[0].data.deploymentProfileCompatibility.failureDomains = 5;
  assert.ok(databaseHAServiceClassProblems(plan, impossible).length >= 1);
});

/* -------------------------------------------------------------------------- */
/* Replikering, receipts, fencing og partition                                */
/* -------------------------------------------------------------------------- */

test("bekræftede writes giver receipts på primary og sync-replikaer", () => {
  const { cluster } = clusterFixture();
  const first = cluster.commit("acme", { op: "approval.decision", payload: { v: 1 } });
  assert.equal(first.committed, true);
  assert.equal(first.syncAcks, 2);
  assert.equal(cluster.receipts().length, 1);
  for (const instance of cluster.instances()) {
    if (instance.role === "async-replica") continue;
    assert.equal(cluster.receipts({ node: instance.id }).length, 1);
  }
  assert.equal(cluster.hasAllReceipts("pg-2"), true);
});

test("tab af den nødvendige sync-replika stopper writes uden at efterlade rækken", () => {
  const { cluster } = clusterFixture({ minSyncReplicasForWrites: 2 });
  cluster.partitionInto([["pg-1", "pg-2"]]); // pg-3 (sync) er isoleret
  const result = cluster.commit("acme", { op: "approval.decision", payload: { v: 1 } });
  assert.equal(result.committed, false);
  assert.equal(result.reason, "sync-replica-loss");
  assert.equal(cluster.maxSeq("pg-1"), 0, "den tentativt skrevne række skal være rullet tilbage");
  assert.equal(cluster.receipts().length, 0);
});

test("promotion kræver fencing af den tidligere primary", () => {
  const { cluster } = clusterFixture();
  cluster.commit("acme", { op: "approval.decision", payload: { v: 1 } });
  const withoutFence = cluster.promote("pg-2");
  assert.equal(withoutFence.promoted, false);
  assert.match(withoutFence.reason, /ikke fenced/);
  cluster.fence("pg-1", { reason: "test" });
  const promotion = cluster.promote("pg-2");
  assert.equal(promotion.promoted, true);
  assert.equal(cluster.primaryId(), "pg-2");
});

test("en kandidat uden alle receipts må ikke promoveres", () => {
  const { cluster } = clusterFixture();
  // Skriv til primary, men isolér pg-2 så den ikke får rækken.
  cluster.partitionInto([["pg-1", "pg-3"]]);
  const result = cluster.commit("acme", { op: "approval.decision", payload: { v: 1 } });
  assert.equal(result.committed, true); // pg-3 er sync og kvitterer
  cluster.restoreReachability();
  cluster.fence("pg-1");
  const promotion = cluster.promote("pg-2");
  assert.equal(promotion.promoted, false);
  assert.match(promotion.reason, /receipts/);
});

test("netværkspartition giver højst én autoritativ skriver", () => {
  const { cluster } = clusterFixture();
  cluster.commit("acme", { op: "approval.decision", payload: { v: 1 } });
  // Majoritetsgruppen kan promovere; den isolerede primary kan ikke skrive.
  cluster.fence("pg-1");
  cluster.partitionInto([["pg-1"], ["pg-2", "pg-3"]]);
  assert.equal(cluster.assessPartitions().atMostOne, true);
  assert.equal(cluster.promote("pg-2").promoted, true);
  const after = cluster.assessPartitions();
  assert.equal(after.atMostOne, true);
  assert.equal(after.authoritativeWriters.length, 1);
  assert.equal(cluster.isFenced("pg-1"), true);
  assert.equal(after.groups.find((g) => g.nodes.includes("pg-1")).hasQuorum, false);
  // Den nye primary i majoritetsgruppen kan skrive.
  const newWrite = cluster.commit("acme", { op: "approval.decision", payload: { v: 2 } });
  assert.equal(newWrite.committed, true);
});

test("rejoin indhenter loggen, verificerer checksums og ophæver fencing", () => {
  const { cluster } = clusterFixture();
  cluster.commit("acme", { op: "approval.decision", payload: { v: 1 } });
  cluster.fence("pg-1");
  cluster.partitionInto([["pg-1"], ["pg-2", "pg-3"]]);
  cluster.promote("pg-2");
  const missed = cluster.commit("acme", { op: "approval.decision", payload: { v: 2 } });
  assert.equal(missed.committed, true);
  assert.equal(cluster.maxSeq("pg-1"), 1, "den fencede node må ikke have fået den nye write");
  cluster.restoreReachability();
  const rejoin = cluster.rejoin("pg-1", { from: "pg-2" });
  assert.equal(rejoin.copied, 1);
  assert.equal(rejoin.digestVerificationOk, true);
  assert.equal(cluster.isFenced("pg-1"), false);
  assert.equal(cluster.verifyIntegrity().ok, true);
});

test("digest er stabilt og ændrer sig ved indholdsændring", () => {
  assert.equal(digestOf({ a: 1, b: [2, 3] }), digestOf({ b: [2, 3], a: 1 }));
  assert.notEqual(digestOf({ a: 1 }), digestOf({ a: 2 }));
});

test("failover-øvelsen bekræfter alle receipts og er ærligt mærket ikke-målt", () => {
  const result = runDatabaseFailoverDrill(plan);
  assert.equal(result.ok, true);
  assert.equal(result.measured, false);
  assert.equal(result.requiresLiveMeasurement, true);
  assert.equal(result.lostReceipts.length, 0);
  assert.equal(result.receiptsPresent, result.receiptsTotal);
  assert.equal(result.checks.syncReplicaLossStopsWrites, true);
  assert.equal(result.checks.partitionAtMostOneWriter, true);
});

test("schemaopgradering af en replika bevarer data og virker sammen med replikering", () => {
  const dir = mkdtempSync(join(tmpdir(), "dkc-dbha-migrate-"));
  try {
    const instances = plan.topology.instances.map((i) => ({ id: i.id, failureDomain: i.failureDomain, role: i.role, db: openDatabase({ path: join(dir, `${i.id}.db`) }) }));
    // Alle instanser står på v10, med realistiske data.
    for (const instance of instances) {
      const migrator = createMigrator({ db: instance.db });
      migrator.apply({ toVersion: 10 });
      instance.db.prepare("INSERT INTO jobs(tenant_id, id, kind, payload, status, enqueued_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
        "acme", `job-${instance.id}`, "task", "{}", "queued", "2025-09-02T00:00:00Z", "2025-09-02T00:00:00Z"
      );
    }
    // Opgrader til v11 og v12 og bekræft at data og replikering fungerer.
    for (const instance of instances) {
      const migrator = createMigrator({ db: instance.db });
      const upgraded = migrator.apply();
      assert.deepEqual(upgraded.applied, [11, 12]);
      assert.equal(instance.db.get("SELECT 1 AS present FROM jobs WHERE id = ?", `job-${instance.id}`).present, 1);
      assert.ok(instance.db.get("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'event_outbox'"));
      assert.ok(instance.db.get("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'retention_holds'"));
    }
    const cluster = createReplicaCluster({ instances, quorum: plan.topology.quorum, minSyncReplicasForWrites: plan.topology.minSyncReplicasForWrites });
    const result = cluster.commit("acme", { op: "approval.decision", payload: { afterUpgrade: true } });
    assert.equal(result.committed, true);
    assert.equal(cluster.verifyIntegrity().ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
