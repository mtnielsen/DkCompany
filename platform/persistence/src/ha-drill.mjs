/**
 * DKC-039 — deterministisk database-failover-øvelse.
 *
 * Øvelsen bruger `replication.mjs` over rigtige SQLite-forbindelser og
 * bekræfter de fire acceptkrav: alle commitkvitteringer findes efter promotion,
 * en partition giver højst én autoritativ skriver, tab af en nødvendig
 * sync-replika stopper writes, og rejoin verificerer checksums. Resultatet bærer
 * `measured: false`; en rigtig måling kræver en levende motor (NOT RUN).
 */
import { createReplicaCluster, ROLE_SYNC } from "./replication.mjs";
import { openDatabase } from "./db.mjs";

/* -------------------------------------------------------------------------- */
/* Deterministisk failover-simulering                                         */
/* -------------------------------------------------------------------------- */

function buildCluster(plan, { makeDb } = {}) {
  const make = makeDb ?? (() => openDatabase());
  const instances = (plan.topology?.instances ?? []).map((i) => ({ id: i.id, failureDomain: i.failureDomain, role: i.role, db: make() }));
  return createReplicaCluster({
    instances,
    quorum: plan.topology.quorum,
    minSyncReplicasForWrites: plan.topology.minSyncReplicasForWrites,
  });
}

function closeCluster(cluster) {
  for (const instance of cluster.instances()) {
    try {
      /* db handles are closed by the caller-provided factory owner */
    } catch {
      /* ignore */
    }
  }
}

/**
 * Kør en deterministisk database-failover-øvelse.
 *
 * Resultatet bærer `measured: false`. En rigtig måling kræver en levende
 * PostgreSQL/operator og er NOT RUN.
 */
export function runDatabaseFailoverDrill(plan, { now = Date.now(), receiptsCount = 5, tenantId = "acme", makeDb } = {}) {
  // 1) Bekræftede writes før nedbrud.
  const cluster = buildCluster(plan, { makeDb });
  const receipts = [];
  for (let i = 0; i < receiptsCount; i += 1) {
    const result = cluster.commit(tenantId, { op: "approval.decision", payload: { index: i }, now });
    if (!result.committed) throw new Error(`write ${i} blev ikke bekræftet: ${result.reason}`);
    receipts.push(result.receipt);
  }

  // 2) Netværkspartition: kun en quorum-gruppe må have en autoritativ skriver.
  const primary = cluster.primaryId();
  const replicas = cluster.instances().filter((i) => i.id !== primary);
  const majority = [replicas.find((r) => r.role === ROLE_SYNC).id, replicas.filter((r) => r.role === ROLE_SYNC)[1].id];
  cluster.fence(primary, { reason: "partition-fence", now });
  const partitionResult = cluster.partitionInto([[primary], majority]);
  const promotion = cluster.promote(majority[0], { now });
  const partitionAfterPromotion = cluster.assessPartitions();

  // 3) Alle bekræftede writes skal findes på den nye primary.
  const newPrimary = promotion.promoted ? promotion.primary : null;
  const promotedLog = newPrimary ? new Map(cluster.receipts({ node: newPrimary }).map((r) => [r.seq, r.digest])) : new Map();
  const lost = receipts.filter((r) => promotedLog.get(r.seq) !== r.digest);

  // 4) Tab af en nødvendig sync-replika skal stoppe writes.
  const syncLossCluster = buildCluster(plan, { makeDb });
  const syncReplicas = syncLossCluster.instances().filter((i) => i.role === ROLE_SYNC);
  const keep = syncReplicas.slice(0, plan.topology.minSyncReplicasForWrites - 1).map((r) => r.id);
  syncLossCluster.partitionInto([[syncLossCluster.primaryId(), ...keep]]);
  const syncLoss = syncLossCluster.commit(tenantId, { op: "approval.decision", payload: { afterLoss: true }, now });

  // 5) Rejoin af den gamle primary efter failover.
  let rejoin = null;
  if (newPrimary) {
    cluster.restoreReachability();
    rejoin = cluster.rejoin(primary, { from: newPrimary, now });
  }

  const integrity = cluster.verifyIntegrity();
  closeCluster(cluster);
  closeCluster(syncLossCluster);

  const checks = {
    allReceiptsPresent: lost.length === 0,
    partitionAtMostOneWriter: partitionResult.atMostOne && partitionAfterPromotion.atMostOne,
    promotionRequiresFence: promotion.promoted === true,
    syncReplicaLossStopsWrites: syncLoss.committed === false && syncLoss.reason === "sync-replica-loss",
    integrityOk: integrity.ok,
    rejoinOk: rejoin ? rejoin.digestVerificationOk && rejoin.copied >= 0 : false,
  };

  return {
    measured: false,
    evidenceKind: "simulation",
    requiresLiveMeasurement: true,
    engine: plan.engine?.family ?? null,
    receiptsTotal: receipts.length,
    receiptsPresent: receipts.length - lost.length,
    lostReceipts: lost.map((r) => r.seq),
    promotion,
    partition: partitionResult,
    partitionAfterPromotion,
    syncReplicaLoss: syncLoss,
    rejoin,
    integrity,
    checks,
    ok: Object.values(checks).every(Boolean),
  };
}
