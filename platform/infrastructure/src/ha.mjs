/**
 * DKC-038 — HA-topologi, sikker serverkommunikation og failover-adfærd.
 *
 * Modulet håndhæver de beslutninger, JSON Schema ikke kan udtrykke alene:
 *
 *   - en quorum-klynge skal have mindst tre medlemmer i adskilte fejldomæner,
 *   - tab af quorum må ikke tillade konkurrerende ledere eller usikre writes,
 *   - der skal være N+1-kapacitet, så ét fejldomæne kan tages ud,
 *   - ingress og DNS skal have mindst to uafhængige mål,
 *   - stateless-tjenester skal have replikaer, startup/readiness/liveness,
 *     topology spread, disruption budget og ressourcegrænser,
 *   - stateful workloads skal have en eksplicit plan og en recovery-lokation
 *     uden for de primære fejldomæner,
 *   - mTLS, certifikatrotation og default-deny-netværkspolitik er obligatorisk.
 *
 * Simuleringen er deterministisk og er **ikke** en målt failover. Den bærer
 * `measured: false`, så et design ikke forveksles med driftsbevis.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isNamedHuman } from "../../conformance/src/architecture.mjs";

export const HA_PLAN_PATH = "infrastructure/ha-plan.json";
export const HA_PROFILE_REF = "catalog/profiles/ha-cluster.profile.json";

function err(path, message) {
  return { path, message };
}

export function loadHAPlan(root) {
  return JSON.parse(readFileSync(join(root, HA_PLAN_PATH), "utf8"));
}

export function quorumFor(memberCount) {
  return Math.floor(memberCount / 2) + 1;
}

/* -------------------------------------------------------------------------- */
/* Semantik                                                                   */
/* -------------------------------------------------------------------------- */

export function haClusterProblems(plan) {
  const problems = [];
  if (!plan || typeof plan !== "object") return [err("/", "HA-planen er ikke et objekt")];
  if (!isNamedHuman(plan.metadata?.accountableHuman)) {
    problems.push(err("/metadata/accountableHuman", "HA-planen skal have et navngivet menneske som ejer"));
  }
  if (plan.hostingProfileRef !== HA_PROFILE_REF) {
    problems.push(err("/hostingProfileRef", `HA-planen skal pege på '${HA_PROFILE_REF}'`));
  }

  const domains = plan.failureDomains ?? [];
  if (domains.length < 3) problems.push(err("/failureDomains", "en HA-klynge kræver mindst tre fejldomæner"));
  if (new Set(domains).size !== domains.length) problems.push(err("/failureDomains", "fejldomænerne skal være unikke"));

  // --- Kontrolplan ---------------------------------------------------------
  const cp = plan.controlPlane ?? {};
  const members = cp.members ?? [];
  if (cp.topology === "managed-ha-control-plane") {
    if (!(cp.managedProvider ?? "").trim()) problems.push(err("/controlPlane/managedProvider", "en managed HA-kontrolplan skal navngive udbyderen"));
    if (cp.datastore?.type !== "managed") problems.push(err("/controlPlane/datastore/type", "en managed kontrolplan skal bruge det managed datastore"));
  } else {
    if (members.length < 3) problems.push(err("/controlPlane/members", "en tre-medlems-quorumklynge kræver mindst tre medlemmer"));
    const memberDomains = new Set();
    for (const [i, member] of members.entries()) {
      if (!domains.includes(member.failureDomain)) problems.push(err(`/controlPlane/members/${i}/failureDomain`, `medlemmet '${member.id}' står i det ukendte fejldomæne '${member.failureDomain}'`));
      memberDomains.add(member.failureDomain);
    }
    if (memberDomains.size < 3) problems.push(err("/controlPlane/members", "quorum-medlemmerne skal være fordelt på mindst tre fejldomæner"));
    const eligible = members.filter((m) => m.leaderEligible).length;
    if (eligible < 2) problems.push(err("/controlPlane/members", "mindst to medlemmer skal kunne vælges som leder, så ét tab ikke fjerner valget"));
    const quorum = cp.datastore?.quorum;
    if (!Number.isInteger(quorum) || quorum < quorumFor(members.length) || quorum > members.length) {
      problems.push(err("/controlPlane/datastore/quorum", `quorum (${quorum}) skal være mindst ${quorumFor(members.length)} og højst ${members.length}`));
    }
  }
  if (cp.datastore?.unsafeWritesOnQuorumLoss !== false) {
    problems.push(err("/controlPlane/datastore/unsafeWritesOnQuorumLoss", "usikre writes ved quorumtab må ikke være tilladt"));
  }
  if (cp.datastore?.writeMode === "single-writer") {
    problems.push(err("/controlPlane/datastore/writeMode", "en tre-medlems-kontrolplan skal vælge leder eller quorum-commit, ikke en fast single-writer"));
  }

  // --- Ingress og DNS ------------------------------------------------------
  const ingress = plan.ingress ?? {};
  if ((ingress.replicas ?? 0) < 2) problems.push(err("/ingress/replicas", "ingress skal have mindst to replikaer"));
  if ((ingress.failureDomains ?? 0) < 2) problems.push(err("/ingress/failureDomains", "ingress skal fordeles på mindst to fejldomæner"));
  const endpoints = ingress.endpoints ?? [];
  if (endpoints.length < 2) problems.push(err("/ingress/endpoints", "der skal være mindst to ingress-endpoints"));
  const healthyEndpoints = endpoints.filter((e) => e.healthy).length;
  if (healthyEndpoints < 2) problems.push(err("/ingress/endpoints", "mindst to ingress-endpoints skal være sunde, så ét tab ikke giver totalt udfald"));
  const endpointDomains = new Set(endpoints.map((e) => e.failureDomain));
  if (endpointDomains.size < 2) problems.push(err("/ingress/endpoints", "ingress-endpoints skal ligge i mindst to fejldomæner"));

  const dns = plan.dns ?? {};
  for (const [i, record] of (dns.records ?? []).entries()) {
    if ((record.targets ?? []).length < 2) problems.push(err(`/dns/records/${i}/targets`, `DNS-posten '${record.name}' skal have mindst to mål`));
  }
  if ((dns.minHealthyTargets ?? 0) < 2) problems.push(err("/dns/minHealthyTargets", "mindst to DNS-mål skal være sunde"));
  if (dns.failover === "round-robin") problems.push(err("/dns/failover", "round-robin uden sundhedstjek er ikke redundant failover"));

  // --- Certifikater og netværk --------------------------------------------
  const certs = plan.certificates ?? {};
  if (certs.mtlsRequired !== true) problems.push(err("/certificates/mtlsRequired", "mTLS er obligatorisk mellem servere"));
  if (!(certs.issuer ?? "").trim()) problems.push(err("/certificates/issuer", "der skal være en certifikatudsteder"));
  if (!Number.isInteger(certs.rotationDays) || certs.rotationDays < 1 || certs.rotationDays > 90) {
    problems.push(err("/certificates/rotationDays", "certifikatrotation skal være mellem 1 og 90 dage"));
  }
  if (certs.autoRotation !== true) problems.push(err("/certificates/autoRotation", "certifikatrotation skal være automatisk"));

  const network = plan.network ?? {};
  if (network.defaultDeny !== true) problems.push(err("/network/defaultDeny", "netværkspolitikken skal være default-deny"));
  if (network.crossTenantDeny !== true) problems.push(err("/network/crossTenantDeny", "trafik mellem uautoriserede tenants skal afvises"));
  const policies = new Set(network.policies ?? []);
  for (const required of ["default-deny", "allow-internal"]) {
    if (!policies.has(required)) problems.push(err("/network/policies", `netværkspolitikken mangler '${required}'`));
  }

  // --- Kapacitet (N+1) -----------------------------------------------------
  const capacity = plan.capacity ?? {};
  if (capacity.nPlusOne !== true) problems.push(err("/capacity/nPlusOne", "HA kræver N+1-kapacitet"));
  if ((capacity.memberCount ?? 0) < 3) problems.push(err("/capacity/memberCount", "kapacitetsplanen skal dække mindst tre medlemmer"));
  const loss = capacityAfterLoss(plan, 1);
  if (!loss.sufficient) {
    problems.push(err("/capacity", `N+1 er ikke opfyldt: ${loss.capacityCpuMillicores}m tilbage mod ${loss.requiredCpuMillicores}m påkrævet`));
  }

  // --- Workloads -----------------------------------------------------------
  const workloads = plan.workloads ?? [];
  if (workloads.length === 0) problems.push(err("/workloads", "HA-planen skal erklære mindst én workload"));
  const ids = new Set();
  for (const [i, workload] of workloads.entries()) {
    const at = `/workloads/${i}`;
    if (ids.has(workload.id)) problems.push(err(`${at}/id`, `workloaden '${workload.id}' er erklæret flere gange`));
    ids.add(workload.id);
    if (certs.mtlsRequired === true && workload.mtls !== true) problems.push(err(`${at}/mtls`, `workloaden '${workload.id}' skal bruge mTLS`));
    if (workload.serviceDiscovery !== true) problems.push(err(`${at}/serviceDiscovery`, `workloaden '${workload.id}' skal bruge service discovery`));
    if (workload.stateless === true) {
      if (workload.replicas < 2) problems.push(err(`${at}/replicas`, `den stateless workload '${workload.id}' skal have mindst to replikaer`));
      if (!workload.probes) problems.push(err(`${at}/probes`, `workloaden '${workload.id}' mangler probes`));
      if (!workload.topologySpread) problems.push(err(`${at}/topologySpread`, `workloaden '${workload.id}' mangler topology spread`));
      else if (workload.topologySpread.whenUnsatisfiable !== "DoNotSchedule") {
        problems.push(err(`${at}/topologySpread/whenUnsatisfiable`, `workloaden '${workload.id}' må ikke placere replikaer samlet i ét fejldomæne`));
      }
      if (!workload.disruptionBudget) problems.push(err(`${at}/disruptionBudget`, `workloaden '${workload.id}' mangler et disruption budget`));
      if (!workload.resources?.limits) problems.push(err(`${at}/resources/limits`, `workloaden '${workload.id}' mangler ressourcegrænser`));
    } else {
      const sp = workload.statefulPlan;
      if (!sp) problems.push(err(`${at}/statefulPlan`, `den stateful workload '${workload.id}' mangler en eksplicit plan`));
      else {
        if (!["leader-elected", "single-writer", "quorum-commit"].includes(sp.writeMode)) problems.push(err(`${at}/statefulPlan/writeMode`, `workloaden '${workload.id}' har en ukendt writeMode`));
        if (sp.activeWriters > 1 && sp.upstreamSupportsMultiWriter !== true) {
          problems.push(err(`${at}/statefulPlan/activeWriters`, `workloaden '${workload.id}' erklærer flere aktive skrivere uden upstream-understøttelse`));
        }
        if (sp.nPlusOne !== true) problems.push(err(`${at}/statefulPlan/nPlusOne`, `den stateful workload '${workload.id}' skal have N+1`));
        if (domains.includes(sp.recoveryLocation)) problems.push(err(`${at}/statefulPlan/recoveryLocation`, `recovery-lokationen for '${workload.id}' må ikke ligge i et primært fejldomæne`));
      }
    }
    const pdb = workload.disruptionBudget;
    if (pdb) {
      if (pdb.minAvailable >= workload.replicas) problems.push(err(`${at}/disruptionBudget/minAvailable`, `disruption budget for '${workload.id}' blokerer al frivillig drain`));
      if (pdb.maxUnavailable > workload.replicas - pdb.minAvailable) problems.push(err(`${at}/disruptionBudget/maxUnavailable`, `disruption budget for '${workload.id}' er selvmodsigende`));
    }
  }
  return problems;
}

/* -------------------------------------------------------------------------- */
/* Quorum og simulering                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Beregn quorum-tilstanden for en given mængde nede medlemmer.
 * `writeAllowed` er kun sand når quorum er intakt; `unsafeWrites` er altid
 * `false`, fordi designet afviser writes uden quorum frem for at risikere
 * split-brain.
 */
export function assessQuorum(plan, { down = [], leaderId = null } = {}) {
  const cp = plan.controlPlane ?? {};
  if (cp.topology === "managed-ha-control-plane") {
    const providerDown = down.includes("provider") || down.includes(cp.managedProvider);
    return {
      topology: cp.topology,
      memberCount: cp.members?.length ?? 0,
      quorum: 0,
      healthy: providerDown ? 0 : 1,
      hasQuorum: !providerDown,
      writeAllowed: !providerDown,
      leaderElected: !providerDown,
      maxConcurrentLeaders: providerDown ? 0 : 1,
      unsafeWrites: false,
    };
  }
  const members = cp.members ?? [];
  const downSet = new Set(down);
  const healthy = members.filter((m) => !downSet.has(m.id));
  const quorum = cp.datastore?.quorum ?? quorumFor(members.length);
  const hasQuorum = healthy.length >= quorum;
  const leaderElected = hasQuorum && healthy.some((m) => m.leaderEligible);
  return {
    topology: cp.topology,
    memberCount: members.length,
    quorum,
    healthy: healthy.length,
    healthyMembers: healthy.map((m) => m.id),
    hasQuorum,
    writeAllowed: hasQuorum && cp.datastore?.unsafeWritesOnQuorumLoss === false,
    leaderElected,
    maxConcurrentLeaders: hasQuorum ? 1 : 0,
    unsafeWrites: false,
    leaderId: leaderId && healthy.some((m) => m.id === leaderId) ? leaderId : null,
  };
}

export function capacityAfterLoss(plan, lossCount = 1) {
  const capacity = plan.capacity ?? {};
  const remainingMembers = Math.max(0, (capacity.memberCount ?? 0) - lossCount);
  const capacityCpuMillicores = remainingMembers * (capacity.perMemberCpuMillicores ?? 0);
  const requiredCpuMillicores = Math.ceil((capacity.baselineCpuMillicores ?? 0) * (1 + (capacity.reservePercent ?? 0) / 100));
  return { remainingMembers, capacityCpuMillicores, requiredCpuMillicores, sufficient: capacityCpuMillicores >= requiredCpuMillicores };
}

function ingressState(plan, downMembers = []) {
  const endpoints = (plan.ingress?.endpoints ?? []).filter((e) => e.healthy);
  // Et ingress-endpoint kan dele fejldomæne med et nede medlem; vi tæller det
  // stadig som sundt, fordi ingress er en separat replikeret komponent.
  const healthyTargets = endpoints.map((e) => e.ip);
  const domains = new Set(endpoints.map((e) => e.failureDomain));
  return {
    replicas: plan.ingress?.replicas ?? 0,
    healthyEndpoints: healthyTargets.length,
    healthyTargets,
    minHealthyTargets: plan.dns?.minHealthyTargets ?? 0,
    dnsRedundant: healthyTargets.length >= (plan.dns?.minHealthyTargets ?? 0) && domains.size >= 2,
    downMembers,
  };
}

/**
 * Frivillig drain: cordonér medlemmet, respektér disruption budgets, og
 * flyt workloads. Ingen in-flight data går tabt.
 */
export function voluntaryDrain(plan, { memberId, now = Date.now() } = {}) {
  const member = (plan.controlPlane?.members ?? []).find((m) => m.id === memberId);
  if (plan.controlPlane?.topology !== "managed-ha-control-plane" && !member) {
    throw new Error(`ukendt kontrolplansmedlem '${memberId}'`);
  }
  const at = new Date(now).toISOString();
  return {
    mode: "voluntary-drain",
    memberId,
    cordoned: true,
    drained: true,
    inFlightLoss: false,
    steps: ["cordon", "drain", "evict-respecting-pdb", "verify-capacity"],
    quorum: assessQuorum(plan, { down: [memberId] }),
    ingress: ingressState(plan, [memberId]),
    capacity: capacityAfterLoss(plan, 1),
    startedAt: at,
    completedAt: new Date(now + 20_000).toISOString(),
    estimatedFailoverSeconds: Math.round((plan.controlPlane?.failoverTargetSeconds ?? 60) * 0.6),
  };
}

/** Hårdt servernedbrud: ingen drain, ledervalg og in-flight tab. */
export function hardCrash(plan, { memberId, now = Date.now() } = {}) {
  const member = (plan.controlPlane?.members ?? []).find((m) => m.id === memberId);
  if (plan.controlPlane?.topology !== "managed-ha-control-plane" && !member) {
    throw new Error(`ukendt kontrolplansmedlem '${memberId}'`);
  }
  const at = new Date(now).toISOString();
  return {
    mode: "hard-crash",
    memberId,
    cordoned: false,
    drained: false,
    inFlightLoss: true,
    leaderReelection: true,
    steps: ["detect-missed-heartbeat", "elect-new-leader", "reschedule-workloads"],
    quorum: assessQuorum(plan, { down: [memberId] }),
    ingress: ingressState(plan, [memberId]),
    capacity: capacityAfterLoss(plan, 1),
    startedAt: at,
    completedAt: new Date(now + (plan.controlPlane?.failoverTargetSeconds ?? 60) * 1000).toISOString(),
    estimatedFailoverSeconds: plan.controlPlane?.failoverTargetSeconds ?? 60,
  };
}

/**
 * Kør en failover-øvelse. Resultatet er en deterministisk simulering og bærer
 * `measured: false`; en rigtig måling kræver en levende klynge.
 */
export function runFailoverDrill(plan, { mode, memberId, now = Date.now(), serviceClasses = [] } = {}) {
  if (mode !== "voluntary-drain" && mode !== "hard-crash") throw new Error(`ukendt drill-mode '${mode}'`);
  const result = mode === "voluntary-drain" ? voluntaryDrain(plan, { memberId, now }) : hardCrash(plan, { memberId, now });
  const slos = serviceClasses.map((sc) => sc.data ?? sc).filter((sc) => sc?.deploymentProfileCompatibility?.haEligible);
  const minRtoMinutes = slos.length ? Math.min(...slos.map((sc) => sc.recovery?.rtoMinutes ?? Infinity)) : null;
  const estimatedMinutes = result.estimatedFailoverSeconds / 60;
  return {
    ...result,
    measured: false,
    evidenceKind: "simulation",
    requiresLiveMeasurement: true,
    withinTarget: result.quorum.hasQuorum && result.quorum.writeAllowed && result.capacity.sufficient && result.ingress.dnsRedundant,
    minServiceClassRtoMinutes: minRtoMinutes,
    withinServiceClassSlo: minRtoMinutes === null ? null : estimatedMinutes <= minRtoMinutes,
  };
}

/**
 * Krydsvalider HA-planen mod DKC-037's serviceklasser: en HA-egnet klasse må
 * ikke kræve mere end planen tilbyder.
 */
export function haServiceClassProblems(plan, serviceClasses = []) {
  const problems = [];
  for (const entry of serviceClasses) {
    const sc = entry.data ?? entry;
    if (!sc?.deploymentProfileCompatibility?.haEligible) continue;
    const ha = sc.deploymentProfileCompatibility;
    if (ha.failureDomains > (plan.failureDomains ?? []).length) {
      problems.push(`${sc.moduleRef}: kræver ${ha.failureDomains} fejldomæner, men planen har ${(plan.failureDomains ?? []).length}`);
    }
    if (ha.nPlusOne === true && plan.capacity?.nPlusOne !== true) {
      problems.push(`${sc.moduleRef}: kræver N+1, men planen erklærer det ikke`);
    }
    const workload = (plan.workloads ?? []).find((w) => w.id === sc.moduleRef || w.moduleRef === sc.moduleRef);
    if (!workload) continue;
    if (workload.replicas < (sc.replication?.replicas ?? 1)) {
      problems.push(`${sc.moduleRef}: planen har ${workload.replicas} replikaer, serviceklassen kræver ${sc.replication?.replicas}`);
    }
    if (workload.stateless === false && workload.statefulPlan?.writeMode !== sc.replication?.writeMode) {
      problems.push(`${sc.moduleRef}: writeMode '${workload.statefulPlan?.writeMode}' matcher ikke serviceklassens '${sc.replication?.writeMode}'`);
    }
  }
  return problems;
}
