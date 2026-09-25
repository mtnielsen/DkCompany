/**
 * DKC-041 — holdbart fil- og objektlager.
 *
 * Modulet håndhæver de beslutninger som JSON Schema ikke kan udtrykke alene:
 *
 *   - et vedligeholdt CSI- og objektlager med en dokumenteret fejlmodel skal
 *     være valgt,
 *   - der skal være mindst tre hosts i adskilte fejldomæner, og quorum skal
 *     være et flertal; usikre writes ved quorumtab er forbudt,
 *   - hver dataklasse skal have en tenantafgrænset nøgle, og autoritative data
 *     må ikke ligge på ephemeral disk,
 *   - cache og genopbyggelige indeks må ikke være autoritative,
 *   - checksums skal beregnes ved skrivning og læsning, og scrub skal opdage
 *     silent corruption og reparere fra en sund replika eller parity,
 *   - den valgte topologi skal beskrive hosts, diske, fejldomæner, quorum og
 *     minimum frirum, og krydsvalideres mod HA-planen og serviceklasserne.
 *
 * Modellen er deterministisk og **ikke** en målt fejlmodel på et levende lager.
 * Den bærer `measured: false`, så et design ikke forveksles med driftsbevis.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isNamedHuman } from "../../conformance/src/architecture.mjs";

export const STORAGE_PLAN_PATH = "storage/storage-plan.json";

function err(path, message) {
  return { path, message };
}

export function loadStoragePlan(root) {
  return JSON.parse(readFileSync(join(root, STORAGE_PLAN_PATH), "utf8"));
}

export function quorumFor(memberCount) {
  return Math.floor(memberCount / 2) + 1;
}

export function dataClassById(plan, id) {
  return (plan.dataClasses ?? []).find((c) => c.id === id) ?? null;
}

export function hostById(plan, id) {
  return (plan.topology?.hosts ?? []).find((h) => h.id === id) ?? null;
}

export function failureDomainSpread(plan) {
  return new Set((plan.topology?.hosts ?? []).map((h) => h.failureDomain));
}

/* -------------------------------------------------------------------------- */
/* Semantik                                                                   */
/* -------------------------------------------------------------------------- */

export function storagePlanProblems(plan) {
  const problems = [];
  if (!plan || typeof plan !== "object") return [err("/", "storage-planen er ikke et objekt")];
  if (!isNamedHuman(plan.metadata?.accountableHuman)) {
    problems.push(err("/metadata/accountableHuman", "planen skal have et navngivet menneske som ejer"));
  }

  // --- Udbyder og fejlmodel ------------------------------------------------
  const provider = plan.provider ?? {};
  const csi = provider.csi ?? {};
  if (!(csi.name ?? "").trim()) problems.push(err("/provider/csi/name", "der skal vælges et CSI-lager"));
  if (csi.maintained !== true) problems.push(err("/provider/csi/maintained", "CSI-lageret skal være vedligeholdt"));
  if (csi.documented !== true) problems.push(err("/provider/csi/documented", "CSI-lagerets fejlmodel skal være dokumenteret"));
  if (!["replicated", "erasure-coding"].includes(csi.failureModel)) problems.push(err("/provider/csi/failureModel", `CSI-fejlmodellen '${csi.failureModel}' er ukendt`));
  if (!(csi.docsRef ?? "").trim()) problems.push(err("/provider/csi/docsRef", "CSI-fejlmodellen skal referere til dokumentation"));

  const objectStore = provider.objectStore ?? {};
  if (!(objectStore.name ?? "").trim()) problems.push(err("/provider/objectStore/name", "der skal vælges et objektlager"));
  if (objectStore.maintained !== true) problems.push(err("/provider/objectStore/maintained", "objektlageret skal være vedligeholdt"));
  if (objectStore.s3Compatible !== true) problems.push(err("/provider/objectStore/s3Compatible", "objektlageret skal være S3-kompatibelt"));
  if (objectStore.versioning !== true) problems.push(err("/provider/objectStore/versioning", "objektlageret skal understøtte versionsstyring"));
  if (objectStore.objectLock !== true) problems.push(err("/provider/objectStore/objectLock", "objektlageret skal understøtte object-lock"));
  if (!["replicated", "erasure-coding"].includes(objectStore.failureModel)) problems.push(err("/provider/objectStore/failureModel", `objektlagerets fejlmodel '${objectStore.failureModel}' er ukendt`));
  if (!(objectStore.docsRef ?? "").trim()) problems.push(err("/provider/objectStore/docsRef", "objektlagerets fejlmodel skal referere til dokumentation"));

  // --- Fejldomæner og topologi ---------------------------------------------
  const domains = plan.failureDomains ?? [];
  if (domains.length < 3) problems.push(err("/failureDomains", "holdbart lager kræver mindst tre fejldomæner"));
  if (new Set(domains).size !== domains.length) problems.push(err("/failureDomains", "fejldomænerne skal være unikke"));

  const topology = plan.topology ?? {};
  const hosts = topology.hosts ?? [];
  if (hosts.length < 3) problems.push(err("/topology/hosts", "der kræves mindst tre hosts"));
  const hostIds = new Set();
  let totalDisks = 0;
  for (const [i, host] of hosts.entries()) {
    const at = `/topology/hosts/${i}`;
    if (hostIds.has(host.id)) problems.push(err(`${at}/id`, `hosten '${host.id}' er erklæret flere gange`));
    hostIds.add(host.id);
    if (!domains.includes(host.failureDomain)) problems.push(err(`${at}/failureDomain`, `hosten '${host.id}' står i det ukendte fejldomæne '${host.failureDomain}'`));
    if (!Array.isArray(host.disks) || host.disks.length < 1) problems.push(err(`${at}/disks`, `hosten '${host.id}' skal have mindst én disk`));
    else {
      const diskIds = new Set();
      for (const [d, disk] of host.disks.entries()) {
        if (diskIds.has(disk.id)) problems.push(err(`${at}/disks/${d}/id`, `disken '${disk.id}' er erklæret flere gange på hosten`));
        diskIds.add(disk.id);
        totalDisks += 1;
      }
    }
  }
  const spread = failureDomainSpread(plan);
  if (spread.size < 3) problems.push(err("/topology/hosts", "hosts skal fordeles på mindst tre fejldomæner"));

  const replicaFactor = topology.replicaFactor ?? 0;
  if (replicaFactor < 2) problems.push(err("/topology/replicaFactor", "replikafaktoren skal være mindst 2"));
  if (replicaFactor > hosts.length) problems.push(err("/topology/replicaFactor", `replikafaktoren (${replicaFactor}) må ikke overstige antallet af hosts (${hosts.length})`));
  const quorum = topology.quorum;
  if (!Number.isInteger(quorum) || quorum < quorumFor(replicaFactor) || quorum > replicaFactor) {
    problems.push(err("/topology/quorum", `quorum (${quorum}) skal være mindst ${quorumFor(replicaFactor)} (flertal af ${replicaFactor}) og højst ${replicaFactor}`));
  }
  if (!Number.isInteger(topology.writeQuorum) || topology.writeQuorum < quorum || topology.writeQuorum > replicaFactor) {
    problems.push(err("/topology/writeQuorum", `skrive-quorum (${topology.writeQuorum}) skal være mindst quorum (${quorum}) og højst replikafaktoren (${replicaFactor})`));
  }
  if (!Number.isInteger(topology.readQuorum) || topology.readQuorum < 1 || topology.readQuorum > replicaFactor) {
    problems.push(err("/topology/readQuorum", `læse-quorum (${topology.readQuorum}) skal være mellem 1 og replikafaktoren (${replicaFactor})`));
  }
  if (topology.writeQuorum + topology.readQuorum <= replicaFactor) {
    problems.push(err("/topology/readQuorum", "skrive- og læse-quorum skal overlappe, så en læsning ser den seneste bekræftede skrivning"));
  }
  if (topology.unsafeWritesOnQuorumLoss !== false) problems.push(err("/topology/unsafeWritesOnQuorumLoss", "usikre writes ved quorumtab må ikke være tilladt"));
  if (topology.ephemeralDiskRequiredState !== false) problems.push(err("/topology/ephemeralDiskRequiredState", "nødvendig tilstand må ikke ligge på ephemeral disk"));
  if (!(topology.minFreeSpacePercent > 0)) problems.push(err("/topology/minFreeSpacePercent", "der skal reserveres et minimum af fri plads i procent"));
  if (!(topology.minFreeSpaceBytes > 0)) problems.push(err("/topology/minFreeSpaceBytes", "der skal reserveres et minimum af fri plads i bytes"));

  if (csi.failureModel === "erasure-coding" || objectStore.failureModel === "erasure-coding") {
    const ec = topology.erasureCoding;
    if (!ec) problems.push(err("/topology/erasureCoding", "en erasure-coding-fejlmodel kræver eksplicitte data-/parity-shards"));
    else {
      if (ec.dataShards + ec.parityShards < 3) problems.push(err("/topology/erasureCoding", "data- og parity-shards skal tilsammen give redundans"));
      if (ec.minShards < ec.dataShards) problems.push(err("/topology/erasureCoding/minShards", "minimum antal shards må ikke være mindre end data-shards"));
      if (ec.minShards > ec.dataShards + ec.parityShards) problems.push(err("/topology/erasureCoding/minShards", "minimum antal shards må ikke overstige det samlede antal shards"));
    }
  }

  // --- Dataklassifikation --------------------------------------------------
  const classes = plan.dataClasses ?? [];
  if (classes.length < 2) problems.push(err("/dataClasses", "der kræves mindst to dataklasser (autoritativ og genopbyggelig)"));
  const classIds = new Set();
  for (const [i, cls] of classes.entries()) {
    const at = `/dataClasses/${i}`;
    if (classIds.has(cls.id)) problems.push(err(`${at}/id`, `dataklassen '${cls.id}' er erklæret flere gange`));
    classIds.add(cls.id);
    if (cls.tenantScopedKey !== true) problems.push(err(`${at}/tenantScopedKey`, `dataklassen '${cls.id}' skal bruge en kundeafgrænset nøgle`));
    if (cls.durable === true && cls.ephemeral === true) {
      problems.push(err(at, `dataklassen '${cls.id}' kan ikke være både holdbar og ephemeral`));
    }
    if (cls.cache === true && cls.rebuildable !== true) {
      problems.push(err(`${at}/rebuildable`, `cache-klassen '${cls.id}' skal være genopbyggelig`));
    }
    if (cls.cache === true && cls.durable === true) {
      problems.push(err(at, `cache-klassen '${cls.id}' må ikke være autoritativ/holdbar`));
    }
    if (cls.placement === "ephemeral" && cls.durable === true) {
      problems.push(err(`${at}/placement`, `den holdbare klassen '${cls.id}' må ikke placeres på ephemeral disk`));
    }
  }
  const authoritative = classes.find((c) => c.id === "authoritative");
  if (!authoritative) problems.push(err("/dataClasses", "der mangler en 'authoritative'-dataklasse"));
  else {
    if (authoritative.durable !== true) problems.push(err("/dataClasses/authoritative/durable", "autoritative data skal være holdbare"));
    if (authoritative.cache !== false) problems.push(err("/dataClasses/authoritative/cache", "autoritative data er ikke en cache"));
    if (authoritative.rebuildable !== false) problems.push(err("/dataClasses/authoritative/rebuildable", "autoritative data må ikke være genopbyggelige alene"));
    if (authoritative.ephemeral !== false) problems.push(err("/dataClasses/authoritative/ephemeral", "autoritative data må ikke være ephemerale"));
    if (authoritative.encryption !== "aes-256-gcm") problems.push(err("/dataClasses/authoritative/encryption", "autoritative data skal krypteres"));
  }
  const cache = classes.find((c) => c.cache === true);
  if (!cache) problems.push(err("/dataClasses", "der mangler en genopbyggelig cache-dataklasse"));
  const rebuildable = classes.find((c) => c.rebuildable === true);
  if (!rebuildable) problems.push(err("/dataClasses", "der mangler en genopbyggelig dataklasse (cache eller indeks)"));

  // --- Checksums, scrub og kapacitet --------------------------------------
  const checksums = plan.checksums ?? {};
  if (checksums.algorithm !== "sha256") problems.push(err("/checksums/algorithm", "checksum-algoritmen skal være sha256"));
  if (checksums.onWrite !== true) problems.push(err("/checksums/onWrite", "checksum skal beregnes ved skrivning"));
  if (checksums.onRead !== true) problems.push(err("/checksums/onRead", "checksum skal verificeres ved læsning"));
  if (!(checksums.scrubIntervalHours > 0)) problems.push(err("/checksums/scrubIntervalHours", "scrub skal have et positivt interval"));

  const scrub = plan.scrub ?? {};
  if (scrub.enabled !== true) problems.push(err("/scrub/enabled", "scrub skal være aktiveret"));
  if (scrub.detectsSilentCorruption !== true) problems.push(err("/scrub/detectsSilentCorruption", "scrub skal opdage silent corruption"));
  if (scrub.repair !== true) problems.push(err("/scrub/repair", "scrub skal kunne reparere"));
  if (scrub.repairSource !== "healthy-replica-or-parity") problems.push(err("/scrub/repairSource", "repair skal hente fra en sund replika eller parity"));
  if (!(scrub.maxConcurrentRepairs >= 1)) problems.push(err("/scrub/maxConcurrentRepairs", "der skal tillades mindst én samtidig repair"));

  const capacity = plan.capacity ?? {};
  if (!(capacity.perHostCapacityBytes > 0)) problems.push(err("/capacity/perHostCapacityBytes", "hver host skal have en kapacitet"));
  if (!(capacity.alarmThresholdPercent > 0)) problems.push(err("/capacity/alarmThresholdPercent", "der skal være en kapacitetsalarm-tærskel"));
  if (!(capacity.hardStopPercent >= 0 && capacity.hardStopPercent < capacity.alarmThresholdPercent)) {
    problems.push(err("/capacity/hardStopPercent", "hard-stop-tærsklen skal være lavere end alarmtærsklen og ikke negativ"));
  }
  if (!Array.isArray(capacity.alerts) || capacity.alerts.length === 0) problems.push(err("/capacity/alerts", "der skal være mindst én kapacitetsalarm"));
  else {
    const critical = capacity.alerts.some((a) => a.severity === "critical");
    if (!critical) problems.push(err("/capacity/alerts", "der skal være mindst én kritisk kapacitetsalarm"));
    for (const [i, alert] of capacity.alerts.entries()) {
      if (alert.atFreePercent >= capacity.alarmThresholdPercent) {
        problems.push(err(`/capacity/alerts/${i}/atFreePercent`, `alarmen '${alert.name}' skal udløse før eller på alarmtærsklen ${capacity.alarmThresholdPercent} %`));
      }
    }
  }

  // --- Nøgler og relokation ------------------------------------------------
  const keys = plan.keys ?? {};
  if (keys.tenantScoped !== true) problems.push(err("/keys/tenantScoped", "nøgler skal være kundeafgrænsede"));
  if (!(keys.provider ?? "").trim()) problems.push(err("/keys/provider", "der skal vælges en nøgleudbyder"));
  if (keys.storeContainsKey !== false) problems.push(err("/keys/storeContainsKey", "nøglen må ikke ligge i selve lageret"));
  if (!(keys.rotationDays > 0)) problems.push(err("/keys/rotationDays", "nøgler skal rotere"));
  if (keys.algorithm !== "aes-256-gcm") problems.push(err("/keys/algorithm", "nøglealgoritmen skal være aes-256-gcm"));

  const relocation = plan.relocation ?? {};
  if (relocation.workloadStateOnEphemeral !== false) problems.push(err("/relocation/workloadStateOnEphemeral", "workloadens tilstand må ikke ligge på ephemeral disk"));
  if (relocation.stateLivesInStorage !== true) problems.push(err("/relocation/stateLivesInStorage", "tilstanden skal ligge i lageret, ikke i containeren"));
  if (relocation.preserveFilesAndPermissions !== true) problems.push(err("/relocation/preserveFilesAndPermissions", "filer og rettigheder skal bevares ved flytning"));
  if (!Array.isArray(relocation.procedure) || relocation.procedure.length < 3) problems.push(err("/relocation/procedure", "relokation skal have en dokumenteret procedure"));

  const slos = plan.slos ?? {};
  if (slos.repairUnderLoadPreservesSlo !== true) problems.push(err("/slos/repairUnderLoadPreservesSlo", "repair/rebalance under belastning skal bevare SLOerne"));
  if (!(slos.maxRepairSeconds > 0)) problems.push(err("/slos/maxRepairSeconds", "der skal være et repair-tidsbudget"));
  if (!(slos.maxScrubSeconds > 0)) problems.push(err("/slos/maxScrubSeconds", "der skal være et scrub-tidsbudget"));
  if (!(slos.availabilityPercent > 0 && slos.availabilityPercent <= 100)) problems.push(err("/slos/availabilityPercent", "der skal være et gyldigt tilgængelighedsmål"));

  return problems;
}

/* -------------------------------------------------------------------------- */
/* Kapacitet                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Vurdér fri plads for hver host ud fra brugte bytes. Returnerer alarmsignaler
 * når en host er under alarmtærsklen eller hard-stop-tærsklen.
 */
export function capacityStatus(plan, usedBytesByHost = {}) {
  const capacityBytes = plan.capacity?.perHostCapacityBytes ?? 0;
  const alarmPercent = plan.capacity?.alarmThresholdPercent ?? 0;
  const hardStopPercent = plan.capacity?.hardStopPercent ?? 0;
  const minFreeBytes = plan.topology?.minFreeSpaceBytes ?? 0;
  const hosts = {};
  const alarms = [];
  for (const host of plan.topology?.hosts ?? []) {
    const used = usedBytesByHost[host.id] ?? 0;
    const free = Math.max(0, capacityBytes - used);
    const freePercent = capacityBytes > 0 ? (free / capacityBytes) * 100 : 0;
    const belowBytes = free < minFreeBytes;
    const level = freePercent <= hardStopPercent || belowBytes ? "hard-stop" : freePercent <= alarmPercent ? "alarm" : "ok";
    if (level !== "ok") {
      alarms.push({ host: host.id, freePercent: Number(freePercent.toFixed(2)), freeBytes: free, level });
    }
    hosts[host.id] = { usedBytes: used, freeBytes: free, freePercent: Number(freePercent.toFixed(2)), level };
  }
  return { hosts, alarms, ok: alarms.length === 0 };
}

/* -------------------------------------------------------------------------- */
/* Krydsvalidering                                                            */
/* -------------------------------------------------------------------------- */

/** Krydsvalidér mod DKC-037's serviceklasser: en HA-klasse må ikke kræve mere end lageret. */
export function storageServiceClassProblems(plan, serviceClasses = []) {
  const problems = [];
  const domains = failureDomainSpread(plan);
  const replicaFactor = plan.topology?.replicaFactor ?? 1;
  for (const entry of serviceClasses) {
    const sc = entry.data ?? entry;
    const compat = sc?.deploymentProfileCompatibility;
    const replication = sc?.replication ?? {};
    if (replication.storageClass && !(plan.provider?.csi?.name ?? "").trim()) {
      problems.push(`${sc.moduleRef}: kræver en storageClass, men lagerplanen vælger ikke et CSI-lager`);
    }
    if (compat?.haEligible && (compat.failureDomains ?? 0) > domains.size) {
      problems.push(`${sc.moduleRef}: kræver ${compat.failureDomains} fejldomæner, men lageret har ${domains.size}`);
    }
    if ((replication.replicas ?? 1) > replicaFactor) {
      problems.push(`${sc.moduleRef}: kræver ${replication.replicas} replikaer, men lageret har replikafaktor ${replicaFactor}`);
    }
    if (replication.statefulMode === "ephemeral" && compat?.haEligible) {
      problems.push(`${sc.moduleRef}: en HA-egnet klasse må ikke erklære ephemeral statefulMode`);
    }
  }
  return problems;
}

/** Krydsvalidér mod DKC-038's HA-plan: lagerets fejldomæner skal matche klyngen. */
export function storageHAProblems(plan, haPlan) {
  const problems = [];
  if (!haPlan) return problems;
  const clusterDomains = new Set(haPlan.failureDomains ?? []);
  for (const domain of plan.failureDomains ?? []) {
    if (!clusterDomains.has(domain)) problems.push(`lagerets fejldomæne '${domain}' findes ikke i HA-planen`);
  }
  const stateful = (haPlan.workloads ?? []).filter((w) => w.stateless === false);
  for (const workload of stateful) {
    if (workload.statefulPlan?.nPlusOne !== true) problems.push(`workloaden '${workload.id}' mangler N+1 i HA-planen`);
  }
  return problems;
}
