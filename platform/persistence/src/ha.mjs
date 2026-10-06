/**
 * DKC-039 — database-HA med fencing og konsistent failover.
 *
 * Modulet håndhæver de beslutninger som JSON Schema ikke kan udtrykke alene:
 *
 *   - en vedligeholdt operator/failover-controller skal være valgt,
 *   - der skal være mindst tre quorum-instanser i adskilte fejldomæner,
 *   - kritiske writes skal bekræftes synkront til quorum, og der må ikke ske
 *     nogen tavs overgang til async,
 *   - den tidligere primary skal fences før promotion, og usikker promotion
 *     må ikke være tilladt,
 *   - godkendelser må kun læses fra primary (ingen forældet replica),
 *   - WAL skal arkiveres med PITR, og failback/rejoin skal kræve fence.
 *
 * Simuleringen er deterministisk og **ikke** en målt failover. Den bærer
 * `measured: false`, så et design ikke forveksles med driftsbevis.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isNamedHuman } from "../../conformance/src/architecture.mjs";
import { ROLE_PRIMARY, ROLE_SYNC } from "./replication.mjs";

export const DB_HA_PLAN_PATH = "persistence/ha-plan.json";

const ENGINE_FAMILIES = ["postgresql", "mysql", "mariadb"];
const DURABILITY_POLICIES = ["sync-remote-apply", "sync-quorum-commit", "sync-on"];

function err(path, message) {
  return { path, message };
}

export function loadDatabaseHAPlan(root) {
  return JSON.parse(readFileSync(join(root, DB_HA_PLAN_PATH), "utf8"));
}

export function quorumFor(memberCount) {
  return Math.floor(memberCount / 2) + 1;
}

/* -------------------------------------------------------------------------- */
/* Semantik                                                                   */
/* -------------------------------------------------------------------------- */

export function databaseHAPlanProblems(plan) {
  const problems = [];
  if (!plan || typeof plan !== "object") return [err("/", "database-HA-planen er ikke et objekt")];
  if (!isNamedHuman(plan.metadata?.accountableHuman)) {
    problems.push(err("/metadata/accountableHuman", "planen skal have et navngivet menneske som ejer"));
  }

  // --- Operator og motor ----------------------------------------------------
  const engine = plan.engine ?? {};
  if (!ENGINE_FAMILIES.includes(engine.family)) problems.push(err("/engine/family", `motorfamilien '${engine.family}' er ikke understøttet`));
  if (!(engine.versionRange ?? "").trim()) problems.push(err("/engine/versionRange", "der skal angives et versionsinterval"));
  if (!(engine.operator ?? "").trim()) problems.push(err("/engine/operator", "der skal vælges en vedligeholdt databaseoperator"));
  if (engine.operatorMaintained !== true) problems.push(err("/engine/operatorMaintained", "operatoren skal være vedligeholdt"));
  if (!(engine.failoverController ?? "").trim()) problems.push(err("/engine/failoverController", "der skal vælges en failover-controller"));
  if (engine.noOwnEngine !== true) problems.push(err("/engine/noOwnEngine", "platformen må ikke drive sin egen motor"));

  // --- Fejldomæner og topologi ---------------------------------------------
  const domains = plan.failureDomains ?? [];
  if (domains.length < 3) problems.push(err("/failureDomains", "database-HA kræver mindst tre fejldomæner"));
  if (new Set(domains).size !== domains.length) problems.push(err("/failureDomains", "fejldomænerne skal være unikke"));

  const topology = plan.topology ?? {};
  const instances = topology.instances ?? [];
  if (instances.length < 3) problems.push(err("/topology/instances", "der kræves mindst tre instanser"));
  const ids = new Set();
  for (const [i, instance] of instances.entries()) {
    const at = `/topology/instances/${i}`;
    if (ids.has(instance.id)) problems.push(err(`${at}/id`, `instansen '${instance.id}' er erklæret flere gange`));
    ids.add(instance.id);
    if (!domains.includes(instance.failureDomain)) problems.push(err(`${at}/failureDomain`, `instansen '${instance.id}' står i det ukendte fejldomæne '${instance.failureDomain}'`));
    if (![ROLE_PRIMARY, ROLE_SYNC, "async-replica"].includes(instance.role)) problems.push(err(`${at}/role`, `instansen '${instance.id}' har en ukendt rolle`));
  }
  const primaries = instances.filter((i) => i.role === ROLE_PRIMARY);
  if (primaries.length !== 1) problems.push(err("/topology/instances", "der skal være præcis én primary"));
  if (topology.primary && !instances.some((i) => i.id === topology.primary)) problems.push(err("/topology/primary", `primary '${topology.primary}' findes ikke blandt instanserne`));
  const syncCount = instances.filter((i) => i.role === ROLE_SYNC).length;
  const asyncCount = instances.filter((i) => i.role === "async-replica").length;
  if ((topology.syncReplicas ?? 0) !== syncCount) problems.push(err("/topology/syncReplicas", `syncReplicas (${topology.syncReplicas}) matcher ikke antallet af sync-replikaer (${syncCount})`));
  if ((topology.asyncReplicas ?? 0) !== asyncCount) problems.push(err("/topology/asyncReplicas", `asyncReplicas (${topology.asyncReplicas}) matcher ikke antallet af async-replikaer (${asyncCount})`));
  if (syncCount < 2) problems.push(err("/topology/syncReplicas", "der kræves mindst to sync-replikaer for at tåle tab af én"));
  const quorum = topology.quorum;
  const voters = instances.filter((i) => i.role === ROLE_PRIMARY || i.role === ROLE_SYNC).length;
  if (!Number.isInteger(quorum) || quorum < quorumFor(voters) || quorum > voters) {
    problems.push(err("/topology/quorum", `quorum (${quorum}) skal være mindst ${quorumFor(voters)} (flertal af ${voters} stemmeberettigede) og højst ${voters}`));
  }
  if (!Number.isInteger(topology.minSyncReplicasForWrites) || topology.minSyncReplicasForWrites < 1 || topology.minSyncReplicasForWrites > syncCount) {
    problems.push(err("/topology/minSyncReplicasForWrites", "mindst én sync-replika skal kræves for writes, og kravet må ikke overstige antallet af sync-replikaer"));
  }
  if (!DURABILITY_POLICIES.includes(topology.durabilityPolicy)) problems.push(err("/topology/durabilityPolicy", `durability-politikken '${topology.durabilityPolicy}' er ukendt`));
  if (topology.noSilentAsyncFallback !== true) problems.push(err("/topology/noSilentAsyncFallback", "der må ikke ske tavs overgang til async"));

  const domainSpread = new Set(instances.map((i) => i.failureDomain));
  if (domainSpread.size < 3) problems.push(err("/topology/instances", "instanserne skal fordeles på mindst tre fejldomæner"));

  // --- Durability -----------------------------------------------------------
  const durability = plan.durability ?? {};
  if (!/^synchronous_commit=(remote_apply|on|remote_write)$/.test(durability.criticalWriteMode ?? "")) {
    problems.push(err("/durability/criticalWriteMode", "kritiske writes skal bruge synchronous_commit remote_apply/on/remote_write"));
  }
  if (durability.confirmBeforeAck !== true) problems.push(err("/durability/confirmBeforeAck", "en write må først bekræftes efter quorum"));
  if (durability.stopWritesOnSyncReplicaLoss !== true) problems.push(err("/durability/stopWritesOnSyncReplicaLoss", "tab af en nødvendig sync-replika skal stoppe writes"));
  if (durability.onSyncReplicaLoss !== "reject-writes") problems.push(err("/durability/onSyncReplicaLoss", "politikken skal være 'reject-writes', ikke tavs datatab"));
  if (durability.asyncReplicasAreNotAck !== true) problems.push(err("/durability/asyncReplicasAreNotAck", "en async-replika må ikke tælle som commitkvittering"));

  // --- Fencing --------------------------------------------------------------
  const fencing = plan.fencing ?? {};
  if (!(fencing.method ?? "").trim()) problems.push(err("/fencing/method", "der skal være en fencing-metode"));
  if (fencing.requireFenceBeforePromotion !== true) problems.push(err("/fencing/requireFenceBeforePromotion", "den tidligere primary skal fences før promotion"));
  if (fencing.token !== "monotonic-epoch") problems.push(err("/fencing/token", "fencing-tokenet skal være monotont"));
  if (fencing.fenceOldPrimaryOnPartition !== true) problems.push(err("/fencing/fenceOldPrimaryOnPartition", "en isoleret gammel primary skal fences"));
  if (!(fencing.isolation ?? "").trim()) problems.push(err("/fencing/isolation", "fencing skal isolere den gamle primary"));
  if (fencing.allowUnsafePromotion !== false) problems.push(err("/fencing/allowUnsafePromotion", "usikker promotion må ikke være tilladt"));

  // --- Read-consistency pr. flow -------------------------------------------
  const flows = plan.readConsistency ?? [];
  if (flows.length === 0) problems.push(err("/readConsistency", "mindst ét flow skal erklære sin read-consistency"));
  const flowIds = new Set();
  for (const [i, flow] of flows.entries()) {
    const at = `/readConsistency/${i}`;
    if (flowIds.has(flow.flow)) problems.push(err(`${at}/flow`, `flowet '${flow.flow}' er erklæret flere gange`));
    flowIds.add(flow.flow);
    if (!["primary-only", "primary-or-sync-committed", "bounded-staleness"].includes(flow.require)) {
      problems.push(err(`${at}/require`, `ukendt read-consistency '${flow.require}'`));
    }
    if (flow.require === "primary-only" && flow.maxStalenessMs !== 0) {
      problems.push(err(`${at}/maxStalenessMs`, "primary-only må ikke have et staleness-budget over 0"));
    }
    if (flow.require === "bounded-staleness" && !(flow.maxStalenessMs > 0)) {
      problems.push(err(`${at}/maxStalenessMs`, "bounded-staleness kræver et positivt staleness-budget"));
    }
  }
  const approvals = flows.find((f) => f.flow === "approvals");
  if (!approvals) problems.push(err("/readConsistency", "godkendelsesflowet skal erklære sin read-consistency"));
  else if (approvals.require !== "primary-only") {
    problems.push(err("/readConsistency/approvals", "godkendelser må ikke læses fra en replica"));
  }

  // --- WAL, PITR og failback/rejoin ----------------------------------------
  const wal = plan.wal ?? {};
  if (wal.archiveEnabled !== true) problems.push(err("/wal/archiveEnabled", "WAL/binlog-arkivering skal være aktiveret"));
  if (!(wal.archiveTarget ?? "").trim()) problems.push(err("/wal/archiveTarget", "der skal være et arkivmål"));
  if (wal.pitrEnabled !== true) problems.push(err("/wal/pitrEnabled", "PITR skal være aktiveret"));
  if (!(wal.retentionHours > 0)) problems.push(err("/wal/retentionHours", "arkivet skal have en positiv retention"));
  if (!(wal.baseBackupSchedule ?? "").trim()) problems.push(err("/wal/baseBackupSchedule", "der skal være en base-backup-plan"));
  if (wal.archiveEncrypted !== true) problems.push(err("/wal/archiveEncrypted", "arkivet skal være krypteret"));

  const failback = plan.failback ?? {};
  if (!Array.isArray(failback.procedure) || failback.procedure.length < 3) problems.push(err("/failback/procedure", "failback skal have en dokumenteret procedure"));
  if (failback.requiresFence !== true) problems.push(err("/failback/requiresFence", "failback skal kræve fence"));
  if (failback.requiresRejoinBeforePromote !== true) problems.push(err("/failback/requiresRejoinBeforePromote", "en tidligere primary skal rejoin'e før den må promoveres"));
  if (!["maintenance", "immediate"].includes(failback.switchoverWindow)) problems.push(err("/failback/switchoverWindow", "ukendt switchover-vindue"));

  const rejoin = plan.rejoin ?? {};
  if (!(rejoin.method ?? "").trim()) problems.push(err("/rejoin/method", "rejoin-metoden skal angives"));
  if (rejoin.requiresFence !== true) problems.push(err("/rejoin/requiresFence", "rejoin skal kræve fence"));
  if (rejoin.catchUpBeforePromote !== true) problems.push(err("/rejoin/catchUpBeforePromote", "en rejoin'et node skal indhente loggen før promotion"));
  if (rejoin.verifyChecksums !== true) problems.push(err("/rejoin/verifyChecksums", "rejoin skal verificere checksums"));

  return problems;
}

/* -------------------------------------------------------------------------- */
/* Read-consistency og serviceklasser                                         */
/* -------------------------------------------------------------------------- */

/** Kan et flow læses fra den givne replikatype uden at bryde kontrakten? */
export function canServeRead(plan, flow, replicaKind) {
  const entry = (plan.readConsistency ?? []).find((f) => f.flow === flow);
  if (!entry) return { ok: false, reason: `ukendt flow '${flow}'` };
  if (replicaKind === "primary") return { ok: true, require: entry.require };
  if (replicaKind === "sync-replica") {
    return { ok: entry.require === "primary-or-sync-committed" || entry.require === "bounded-staleness", require: entry.require };
  }
  if (replicaKind === "async-replica") {
    return { ok: entry.require === "bounded-staleness", require: entry.require };
  }
  return { ok: false, reason: `ukendt replikatype '${replicaKind}'` };
}

/** Krydsvalidér mod DKC-037's serviceklasser: en HA-klasse må ikke kræve mere end planen. */
export function databaseHAServiceClassProblems(plan, serviceClasses = []) {
  const problems = [];
  const instances = plan.topology?.instances ?? [];
  const domains = new Set(instances.map((i) => i.failureDomain));
  for (const entry of serviceClasses) {
    const sc = entry.data ?? entry;
    const compat = sc?.deploymentProfileCompatibility;
    if (!compat?.haEligible) continue;
    if (compat.failureDomains > domains.size) {
      problems.push(`${sc.moduleRef}: kræver ${compat.failureDomains} fejldomæner, men databasen har ${domains.size}`);
    }
    const replicas = sc.replication?.replicas ?? 1;
    if (replicas > instances.length) {
      problems.push(`${sc.moduleRef}: kræver ${replicas} replikaer, men databasen har ${instances.length} instanser`);
    }
    const writeMode = sc.replication?.writeMode;
    if (writeMode === "multi-writer" && sc.replication?.upstreamSupportsMultiWriter !== true) {
      problems.push(`${sc.moduleRef}: erklærer multi-writer uden upstream-understøttelse`);
    }
    if (sc.replication?.consistency === "eventual" && compat.haEligible === true) {
      problems.push(`${sc.moduleRef}: en HA-egnet klasse må ikke nøjes med eventual consistency`);
    }
  }
  return problems;
}

