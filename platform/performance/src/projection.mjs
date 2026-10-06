/**
 * DKC-050 — deterministisk kapacitetsprojektion.
 *
 * Projektionen antager ikke lineær skalering. Hvert workload har en målbar
 * kapacitet pr. replika, en replikaramme og en latens ved lav belastning.
 * Belastningen fra en lastprofil oversættes til en utilisation, og latensen
 * vokser efter en kømodel (`1 / (1 - u)`), så en flaskehals bliver synlig i
 * stedet for at blive skjult bag et gennemsnit.
 *
 * Resultatet bærer `measured: false`. Det er en model, ikke en målt lasttest.
 */

const HOURS_PER_MONTH = 730;
const SECONDS_PER_DAY = 86400;
const SECONDS_PER_MONTH = SECONDS_PER_DAY * 30;

/** Parse en Kubernetes-ressourcestreng ('500m', '2', '1.5') til millicores. */
export function parseCpuMillicores(value) {
  if (typeof value === "number") return value * 1000;
  const text = String(value ?? "").trim();
  if (text.endsWith("m")) return Number(text.slice(0, -1));
  return Number(text) * 1000;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** Kømodel: latensmultiplikator ved utilisation u i [0,1). */
export function queueFactor(utilization) {
  const u = clamp(utilization, 0, 0.98);
  return 1 / (1 - u);
}

function round(value, digits = 2) {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

function primaryCapacity(workload) {
  const entries = Object.entries(workload.capacityPerReplica ?? {});
  return entries.length ? { unit: entries[0][0], value: entries[0][1] } : { unit: null, value: 0 };
}

/**
 * Beregn hvor mange replikaer en stateless workload har ved en given
 * efterspørgsel. Replikaerne udledes af autoscalerens politik (CPU- eller
 * kødybde-mål) og begrænses af replikarammen. Stateful workloads holder deres
 * faste replikatælling, fordi skalering kræver en runbook.
 */
export function replicasFor(workload, demandPerSecond) {
  if (workload.kind === "stateful") {
    return { replicas: workload.replicas.min, scaled: false, capped: false, reason: "runbook-only" };
  }
  const perReplica = Object.values(workload.capacityPerReplica)[0] || 1;
  const policy = workload.autoscale;
  let target;
  if (policy.mode === "cpu") {
    const targetUtil = (policy.targetUtilizationPercent ?? 70) / 100;
    target = Math.ceil(demandPerSecond / Math.max(perReplica * targetUtil, 1e-9));
  } else {
    target = Math.ceil(demandPerSecond / perReplica);
  }
  const min = workload.replicas.min;
  const max = workload.replicas.max;
  const replicas = clamp(target, min, max);
  return { replicas, scaled: replicas > min, capped: target > max, reason: "autoscale" };
}

/**
 * Effektiv kapacitet for ét workload ved en given replikamængde og et givent
 * antal nede hosts. En stateful app uden multi-active-support vinder intet ved
 * flere replikaer: der er stadig kun én aktiv skriver.
 */
export function effectiveCapacity(workload, replicas, { hostCount, downHosts = 0 } = {}) {
  const primary = primaryCapacity(workload);
  const quorum = Math.floor(hostCount / 2) + 1;
  const healthyHosts = hostCount - downHosts;
  if (workload.kind === "stateful") {
    if (healthyHosts < quorum) return { capacity: 0, writers: 0, available: false, unit: primary.unit, multiActive: workload.statefulScaling?.multiActive === true };
    const multiActive = workload.statefulScaling?.multiActive === true;
    const writers = multiActive ? replicas : 1;
    return { capacity: writers * primary.value, writers, available: true, unit: primary.unit, multiActive };
  }
  const effectiveReplicas = replicas * (healthyHosts / hostCount);
  return { capacity: effectiveReplicas * primary.value, writers: effectiveReplicas, available: true, unit: primary.unit, multiActive: true };
}

/** Den primære efterspørgsel et workload skal betjene for en lastprofil. */
export function demandFor(workload, profile) {
  if (workload.id === "api") return profile.requestsPerSecond;
  if (workload.id === "queue-worker") return profile.jobsPerSecond;
  if (workload.id === "ai-gateway") return profile.aiCallsPerDay / SECONDS_PER_DAY;
  if (workload.id === "database") return profile.requestsPerSecond * 0.6 + profile.jobsPerSecond;
  if (workload.id === "broker") return profile.jobsPerSecond + profile.requestsPerSecond * 0.05;
  if (workload.id === "object-store") return profile.filesPerDay / SECONDS_PER_DAY;
  if (workload.kind === "stateful") return profile.requestsPerSecond * 0.2 + profile.jobsPerSecond * 0.2;
  return 0;
}

/**
 * Projektér én lastprofil ved en skaleringsfaktor. Returnerer throughput,
 * p95/p99, fejlrate, køalder, replikeringslag og pris. `measured` er altid
 * `false`.
 */
export function projectCapacity(plan, profile, { scaleFactor = 1, downHosts = 0 } = {}) {
  const hostCount = plan.topology.hostCount;
  const workloads = plan.workloads.map((workload) => {
    const demand = demandFor(workload, profile) * scaleFactor;
    const { replicas, scaled, capped, reason } = replicasFor(workload, demand);
    const cap = effectiveCapacity(workload, replicas, { hostCount, downHosts });
    const utilization = cap.capacity > 0 ? demand / cap.capacity : Infinity;
    const factor = Number.isFinite(utilization) ? queueFactor(utilization) : 50;
    const sustained = Math.min(demand, cap.capacity);
    const overload = Math.max(0, demand - cap.capacity);
    return {
      id: workload.id,
      kind: workload.kind,
      replicas,
      scaled,
      capped,
      reason,
      unit: cap.unit,
      capacityPerSecond: round(cap.capacity),
      demandPerSecond: round(demand),
      sustainedPerSecond: round(sustained),
      utilizationPercent: cap.capacity > 0 ? round(utilization * 100, 1) : null,
      overloadPerSecond: round(overload),
      latency: {
        p95Ms: round(workload.latency.baseP95Ms * factor),
        p99Ms: round(workload.latency.baseP99Ms * factor),
      },
      multiActive: cap.multiActive,
    };
  });

  const totalDemand = workloads.reduce((sum, w) => sum + w.demandPerSecond, 0);
  const totalSustained = workloads.reduce((sum, w) => sum + w.sustainedPerSecond, 0);
  const totalOverload = workloads.reduce((sum, w) => sum + w.overloadPerSecond, 0);
  const bottleneck = workloads.reduce((worst, w) => {
    if (!worst) return w;
    return (w.utilizationPercent ?? 0) > (worst.utilizationPercent ?? 0) ? w : worst;
  }, null);

  const errorRate = totalDemand > 0 ? round((totalOverload / totalDemand) * 100, 3) : 0;

  const queue = workloads.find((w) => w.id === "queue-worker");
  const queueAgeSeconds = queue ? round(Math.max(0, queue.overloadPerSecond / Math.max(queue.capacityPerSecond, 1)) * 60, 1) : 0;

  const replicationLagMs = Math.max(
    0,
    ...plan.workloads
      .filter((w) => w.kind === "stateful")
      .map((w) => {
        const reported = workloads.find((x) => x.id === w.id);
        const lag = w.statefulScaling?.replication?.replicationLagMs ?? 0;
        return round(lag * (reported?.utilizationPercent ? queueFactor(Math.min(reported.utilizationPercent / 100, 0.98)) : 1));
      }),
  );

  const cpuMillicores = plan.workloads.reduce((sum, w) => sum + w.replicas.min * parseCpuMillicores(w.resourceLimits.cpu), 0);
  const price = {
    currency: plan.cost.currency,
    vcpuMonthly: round((cpuMillicores / 1000) * plan.cost.perVcpuHour * HOURS_PER_MONTH),
    storageMonthly: round(profile.dataGb * plan.cost.perGbMonth),
    aiMonthly: round(profile.aiCallsPerDay * 30 * plan.cost.perAiCall),
    requestsMonthly: round(((profile.requestsPerSecond * SECONDS_PER_MONTH) / 1_000_000) * plan.cost.perMillionRequests),
    jobsMonthly: round(((profile.jobsPerSecond * SECONDS_PER_MONTH) / 1_000_000) * plan.cost.perMillionJobs),
  };
  price.totalMonthly = round(price.vcpuMonthly + price.storageMonthly + price.aiMonthly + price.requestsMonthly + price.jobsMonthly);

  return {
    profileId: profile.id,
    scaleFactor,
    downHosts,
    measured: false,
    throughputPerSecond: round(totalSustained),
    throughputUtilizationPercent: totalDemand > 0 ? round((totalSustained / totalDemand) * 100, 1) : 100,
    errorRatePercent: errorRate,
    queueAgeSeconds,
    replicationLagMs,
    p95Ms: round(Math.max(...workloads.map((w) => w.latency.p95Ms))),
    p99Ms: round(Math.max(...workloads.map((w) => w.latency.p99Ms))),
    bottleneck: bottleneck ? { id: bottleneck.id, utilizationPercent: bottleneck.utilizationPercent } : null,
    price,
    workloads,
  };
}

/**
 * Byg den fulde rapport: hver lastprofil ved hver skaleringsfaktor, plus en
 * N+1-måling for baselineprofilen efter tab af én host.
 */
export function buildCapacityReport(plan) {
  const factors = plan.capacityReport.scalingFactors;
  const baseline = plan.loadProfiles.find((p) => p.id === plan.baselineProfileId);
  const profiles = plan.loadProfiles.map((profile) => ({
    profileId: profile.id,
    name: profile.name,
    runs: factors.map((factor) => projectCapacity(plan, profile, { scaleFactor: factor })),
  }));

  const baselineRuns = profiles.find((p) => p.profileId === baseline.id).runs;
  const baselineDemand = baselineRuns[0].throughputPerSecond;
  const afterHostLoss = projectCapacity(plan, baseline, { scaleFactor: 1, downHosts: 1 });
  const nPlusOne = {
    downHosts: 1,
    hostCount: plan.topology.hostCount,
    remainingHosts: plan.topology.hostCount - 1,
    baselineThroughputPerSecond: baselineDemand,
    throughputAfterLossPerSecond: afterHostLoss.throughputPerSecond,
    errorRateAfterLossPercent: afterHostLoss.errorRatePercent,
    sufficient: afterHostLoss.errorRatePercent === 0 && afterHostLoss.throughputPerSecond >= baselineDemand,
    measured: false,
  };

  const scalingRealized = {};
  for (const profile of profiles) {
    const [base, ...rest] = profile.runs;
    scalingRealized[profile.profileId] = {
      baseThroughputPerSecond: base.throughputPerSecond,
      steps: rest.map((run) => {
        const ratio = base.throughputPerSecond > 0 ? run.throughputPerSecond / base.throughputPerSecond : 0;
        const linear = base.throughputPerSecond > 0 && Math.abs(ratio - run.scaleFactor) / run.scaleFactor < 0.01;
        return {
          scaleFactor: run.scaleFactor,
          throughputRatio: round(ratio, 3),
          linear,
          throughputPerSecond: run.throughputPerSecond,
          errorRatePercent: run.errorRatePercent,
          p95Ms: run.p95Ms,
          p99Ms: run.p99Ms,
          queueAgeSeconds: run.queueAgeSeconds,
          replicationLagMs: run.replicationLagMs,
          totalMonthly: run.price.totalMonthly,
          bottleneck: run.bottleneck,
        };
      }),
    };
  }

  return {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "CapacityReport",
    generatedFrom: "performance/capacity-plan.json",
    measurement: plan.capacityReport.measurement,
    scalingFactors: factors,
    profiles,
    nPlusOne,
    scalingRealized,
  };
}
