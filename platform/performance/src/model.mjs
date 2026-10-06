/**
 * DKC-050 — semantik for kapacitets- og skaleringsplanen.
 *
 * Skemaet håndhæver formen. Denne modul håndhæver beslutningerne:
 *
 *   - mindst tre hosts i mindst tre adskilte fejldomæner med N+1,
 *   - en reproducerbar lastprofil pr. kundestørrelse med alle dimensioner,
 *   - stateless workloads autoskalerer inden for en ramme; stateful workloads
 *     skalerer kun efter en signeret runbook og erklærer om de er multi-active,
 *   - en app uden multi-active-support må ikke kunne skaleres ved at øge
 *     replikatællingen,
 *   - tenantkvoter med vægtet fairness og et loft pr. tenant,
 *   - connection pools med reserverede admin-forbindelser,
 *   - backpressure der afviser kontrolleret og først kvitterer efter holdbar
 *     skrivning, og
 *   - en enhedspris der kan regnes før/efter skalering.
 *
 * Modellen måler ikke selv: `capacityReport.measurement.measured` er altid
 * `false`, og en levende lasttest er en ekstern integration.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isNamedHuman } from "../../conformance/src/architecture.mjs";
import { HA_PROFILE_REF } from "../../infrastructure/src/ha.mjs";

export const CAPACITY_PLAN_PATH = "performance/capacity-plan.json";
export const CAPACITY_MANIFESTS_DIR = "gitops/manifests/performance";
export const CAPACITY_REPORT_PATH = "performance/report/capacity-report.json";
export const CAPACITY_DOC_PATH = "docs/capacity/scaling-report.md";

function err(path, message) {
  return { path, message };
}

export function loadCapacityPlan(root) {
  return JSON.parse(readFileSync(join(root, CAPACITY_PLAN_PATH), "utf8"));
}

export function profileById(plan, id) {
  return (plan.loadProfiles ?? []).find((p) => p.id === id);
}

export function workloadById(plan, id) {
  return (plan.workloads ?? []).find((w) => w.id === id);
}

export function poolById(plan, id) {
  return (plan.connectionPools ?? []).find((p) => p.id === id);
}

export function capacityPlanProblems(plan) {
  const problems = [];
  if (!plan || typeof plan !== "object") return [err("/", "kapacitetsplanen er ikke et objekt")];
  if (!isNamedHuman(plan.metadata?.accountableHuman)) {
    problems.push(err("/metadata/accountableHuman", "kapacitetsplanen skal have et navngivet menneske som ejer"));
  }
  if (plan.hostingProfileRef !== HA_PROFILE_REF) {
    problems.push(err("/hostingProfileRef", `kapacitetsplanen skal pege på '${HA_PROFILE_REF}'`));
  }

  // --- Fejldomæner og hosts ------------------------------------------------
  const domains = plan.failureDomains ?? [];
  if (domains.length < 3) problems.push(err("/failureDomains", "kapacitetsplanen kræver mindst tre fejldomæner"));
  if (new Set(domains).size !== domains.length) problems.push(err("/failureDomains", "fejldomænerne skal være unikke"));

  const topology = plan.topology ?? {};
  const hosts = topology.hosts ?? [];
  if (hosts.length < 3) problems.push(err("/topology/hosts", "kapacitetsplanen kræver mindst tre hosts"));
  if (topology.hostCount !== hosts.length) {
    problems.push(err("/topology/hostCount", `hostCount (${topology.hostCount}) matcher ikke antallet af hosts (${hosts.length})`));
  }
  if (topology.nPlusOne !== true) problems.push(err("/topology/nPlusOne", "kapacitetsplanen skal erklære N+1"));
  const hostDomains = new Set();
  const hostIds = new Set();
  for (const [i, host] of hosts.entries()) {
    const at = `/topology/hosts/${i}`;
    if (hostIds.has(host.id)) problems.push(err(`${at}/id`, `hosten '${host.id}' er erklæret flere gange`));
    hostIds.add(host.id);
    if (!domains.includes(host.failureDomain)) problems.push(err(`${at}/failureDomain`, `hosten '${host.id}' står i det ukendte fejldomæne '${host.failureDomain}'`));
    hostDomains.add(host.failureDomain);
  }
  if (hostDomains.size < 3) problems.push(err("/topology/hosts", "hosts skal være fordelt på mindst tre fejldomæner"));

  // --- Lastprofiler --------------------------------------------------------
  const profiles = plan.loadProfiles ?? [];
  if (profiles.length < 3) problems.push(err("/loadProfiles", "der skal være mindst tre kundestørrelser"));
  const profileIds = new Set();
  const DIMENSIONS = ["concurrentUsers", "requestsPerSecond", "jobsPerSecond", "filesPerDay", "dataGb", "aiCallsPerDay"];
  for (const [i, profile] of profiles.entries()) {
    const at = `/loadProfiles/${i}`;
    if (profileIds.has(profile.id)) problems.push(err(`${at}/id`, `lastprofilen '${profile.id}' er erklæret flere gange`));
    profileIds.add(profile.id);
    for (const dim of DIMENSIONS) {
      if (!(typeof profile[dim] === "number" && profile[dim] > 0)) problems.push(err(`${at}/${dim}`, `lastprofilen '${profile.id}' mangler en positiv '${dim}'`));
    }
  }
  if (!profileIds.has(plan.baselineProfileId)) {
    problems.push(err("/baselineProfileId", `baselineProfileId '${plan.baselineProfileId}' findes ikke blandt lastprofilerne`));
  }

  // --- Workloads -----------------------------------------------------------
  const workloads = plan.workloads ?? [];
  if (workloads.length === 0) problems.push(err("/workloads", "planen skal erklære mindst én workload"));
  const workloadIds = new Set();
  const poolIds = new Set((plan.connectionPools ?? []).map((p) => p.id));
  for (const [i, w] of workloads.entries()) {
    const at = `/workloads/${i}`;
    if (workloadIds.has(w.id)) problems.push(err(`${at}/id`, `workloaden '${w.id}' er erklæret flere gange`));
    workloadIds.add(w.id);
    if ((w.replicas?.min ?? 0) > (w.replicas?.max ?? 0)) problems.push(err(`${at}/replicas`, `workloaden '${w.id}' har min > max`));
    if ((w.latency?.baseP99Ms ?? 0) < (w.latency?.baseP95Ms ?? 0)) problems.push(err(`${at}/latency`, `workloaden '${w.id}' har p99 under p95`));
    if (w.connectionPoolRef && !poolIds.has(w.connectionPoolRef)) {
      problems.push(err(`${at}/connectionPoolRef`, `workloaden '${w.id}' peger på den ukendte pool '${w.connectionPoolRef}'`));
    }
    if (w.kind === "stateless") {
      if (!w.autoscale) problems.push(err(`${at}/autoscale`, `den stateless workload '${w.id}' mangler en autoscale-politik`));
      else {
        if (w.autoscale.minReplicas !== w.replicas.min || w.autoscale.maxReplicas !== w.replicas.max) {
          problems.push(err(`${at}/autoscale`, `autoscale-rammen for '${w.id}' matcher ikke replikarammen`));
        }
        if (w.autoscale.mode === "cpu" && !(w.autoscale.targetUtilizationPercent >= 1 && w.autoscale.targetUtilizationPercent <= 95)) {
          problems.push(err(`${at}/autoscale/targetUtilizationPercent`, `'${w.id}' mangler et gyldigt CPU-mål`));
        }
        if (w.autoscale.mode === "queue-depth" && !(w.autoscale.targetQueueDepth >= 1)) {
          problems.push(err(`${at}/autoscale/targetQueueDepth`, `'${w.id}' mangler en gyldig kødybde`));
        }
      }
      if (w.statefulScaling) problems.push(err(`${at}/statefulScaling`, `den stateless workload '${w.id}' må ikke have en stateful plan`));
    } else if (w.kind === "stateful") {
      if (w.autoscale) problems.push(err(`${at}/autoscale`, `den stateful workload '${w.id}' må ikke autoskaleres direkte`));
      const sp = w.statefulScaling;
      if (!sp) problems.push(err(`${at}/statefulScaling`, `den stateful workload '${w.id}' mangler en runbookstyret plan`));
      else {
        if (sp.mode !== "runbook-only") problems.push(err(`${at}/statefulScaling/mode`, `'${w.id}' må kun skalere efter runbook`));
        if (!(sp.runbookRef ?? "").trim()) problems.push(err(`${at}/statefulScaling/runbookRef`, `'${w.id}' mangler en runbookreference`));
        if (sp.multiActive !== true && (sp.activeWriters ?? 1) > 1) {
          problems.push(err(`${at}/statefulScaling/activeWriters`, `'${w.id}' erklærer flere aktive skrivere uden multi-active-support`));
        }
        if (sp.multiActive === false && (w.replicas?.max ?? 0) > (w.replicas?.min ?? 0)) {
          problems.push(err(`${at}/replicas`, `'${w.id}' uden multi-active-support må ikke kunne skaleres ved at øge replikatællingen`));
        }
        if (!sp.replication) problems.push(err(`${at}/statefulScaling/replication`, `'${w.id}' mangler replikeringsdata`));
      }
    } else {
      problems.push(err(`${at}/kind`, `workloaden '${w.id}' har en ukendt kind`));
    }
  }

  // --- Tenantkvoter --------------------------------------------------------
  const tq = plan.tenantQuotas ?? {};
  if (!(tq.maxSharePercent >= 1 && tq.maxSharePercent <= 99)) {
    problems.push(err("/tenantQuotas/maxSharePercent", "en enkelt tenant skal kunne begrænses til under 100 % af kapaciteten"));
  }
  if (tq.fairness?.algorithm !== "weighted-fair-queue") {
    problems.push(err("/tenantQuotas/fairness/algorithm", "fairness skal bruge en vægtet kø"));
  }
  if (!(tq.fairness?.defaultWeight > 0)) problems.push(err("/tenantQuotas/fairness/defaultWeight", "standardvægten skal være positiv"));
  const q = tq.default ?? {};
  for (const field of ["maxRequestsPerSecond", "maxConcurrentJobs", "maxStorageGb", "maxAiCallsPerDay", "maxConnections"]) {
    if (!(typeof q[field] === "number" && q[field] > 0)) problems.push(err(`/tenantQuotas/default/${field}`, `tenantkvoten mangler en positiv '${field}'`));
  }
  if (tq.onExceed !== "reject") problems.push(err("/tenantQuotas/onExceed", "overskredet kvote skal afvises kontrolleret"));

  // --- Connection pools ----------------------------------------------------
  const pools = plan.connectionPools ?? [];
  if (pools.length === 0) problems.push(err("/connectionPools", "der skal være mindst én connection pool"));
  const seenPools = new Set();
  for (const [i, pool] of pools.entries()) {
    const at = `/connectionPools/${i}`;
    if (seenPools.has(pool.id)) problems.push(err(`${at}/id`, `poolen '${pool.id}' er erklæret flere gange`));
    seenPools.add(pool.id);
    if (!workloadIds.has(pool.target)) problems.push(err(`${at}/target`, `poolen '${pool.id}' peger på den ukendte workload '${pool.target}'`));
    if (pool.reservedAdminConnections >= pool.maxConnectionsPerReplica) {
      problems.push(err(`${at}/reservedAdminConnections`, `poolen '${pool.id}' skal efterlade forbindelser til tenanttrafik`));
    }
  }

  // --- Backpressure --------------------------------------------------------
  const bp = plan.backpressure ?? {};
  if (!(bp.queueDepthWarn > 0) || !(bp.queueDepthCritical > bp.queueDepthWarn)) {
    problems.push(err("/backpressure", "kødybdegrænserne skal være positive og critical > warn"));
  }
  if (bp.strategy !== "pause-publishers") problems.push(err("/backpressure/strategy", "backpressure skal pause udgivere"));
  if (bp.visible !== true) problems.push(err("/backpressure/visible", "køtilstanden skal være synlig"));
  if (bp.onOverflow !== "reject") problems.push(err("/backpressure/onOverflow", "overskredet kapacitet skal afvises kontrolleret"));
  if (bp.durableBeforeAck !== true) problems.push(err("/backpressure/durableBeforeAck", "en kvittering må først gives efter holdbar skrivning"));

  // --- Omkostning og rapport ----------------------------------------------
  const cost = plan.cost ?? {};
  for (const field of ["perVcpuHour", "perGbMonth", "perAiCall", "perMillionRequests", "perMillionJobs"]) {
    if (!(typeof cost[field] === "number" && cost[field] >= 0)) problems.push(err(`/cost/${field}`, `omkostningsmodellen mangler en ikke-negativ '${field}'`));
  }
  const report = plan.capacityReport ?? {};
  const factors = report.scalingFactors ?? [];
  if (!factors.includes(1)) problems.push(err("/capacityReport/scalingFactors", "skaleringsfaktorerne skal indeholde 1x"));
  if (factors.some((f, i) => i > 0 && f <= factors[i - 1])) problems.push(err("/capacityReport/scalingFactors", "skaleringsfaktorerne skal være strengt stigende"));
  if (report.measurement?.mode !== "deterministic-simulation" || report.measurement?.measured !== false) {
    problems.push(err("/capacityReport/measurement", "modellen må ikke erklære en levende måling"));
  }
  if (report.measurement?.requiresLiveLoadTest !== true) {
    problems.push(err("/capacityReport/measurement/requiresLiveLoadTest", "en levende lasttest skal markeres som påkrævet"));
  }

  return problems;
}
