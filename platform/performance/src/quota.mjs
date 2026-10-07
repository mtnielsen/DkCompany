/**
 * DKC-050 — tenantkvoter, fairness og kontrolleret afvisning.
 *
 * En støjende tenant må ikke kunne forbruge alle ressourcer. Fordelingen sker
 * med en vægtet kø og et hårdt loft pr. tenant (`maxSharePercent`). En forespørgsel
 * eller et job der overskrider kvoten eller den samlede kapacitet afvises
 * kontrolleret med en retry-vejledning — den kvitteres aldrig, og derfor kan et
 * allerede kvitteret (holdbart skrevet) stykke arbejde ikke gå tabt.
 */

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, digits = 3) {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

function normaliseTenants(plan, tenants = []) {
  return tenants.map((t) => ({
    tenantId: t.tenantId,
    weight: typeof t.weight === "number" && t.weight > 0 ? t.weight : plan.tenantQuotas.fairness.defaultWeight,
    demandPerSecond: Math.max(0, Number(t.demandPerSecond) || 0),
    quotaPerSecond: typeof t.quotaPerSecond === "number" ? t.quotaPerSecond : plan.tenantQuotas.default.maxRequestsPerSecond,
  }));
}

/**
 * Fordel en samlet kapacitet mellem tenanter efter vægt med et loft pr. tenant.
 * Returnerer tildelt og afvist andel pr. tenant og en samlet kontrol af, at
 * ingen tenant får mere end loftet, og at fordelingen ikke overstiger kapaciteten.
 */
export function allocateFairShares(plan, { capacityPerSecond, tenants = [] } = {}) {
  const capacity = Math.max(0, Number(capacityPerSecond) || 0);
  const maxShare = capacity * (plan.tenantQuotas.maxSharePercent / 100);
  const reservation = capacity * (plan.tenantQuotas.fairness.reservationPercent / 100);
  const entries = normaliseTenants(plan, tenants);

  // 1) Reserver en mindre andel til hver tenant der efterspørger den.
  const allocated = new Map();
  let remaining = capacity;
  for (const t of entries) {
    const wish = Math.min(t.demandPerSecond, reservation);
    const grant = Math.min(wish, remaining, t.quotaPerSecond, maxShare);
    allocated.set(t.tenantId, grant);
    remaining -= grant;
  }

  // 2) Fordel resten vægtet mellem de endnu ikke dækkede tenanter.
  const totalWeight = entries.reduce((sum, t) => sum + t.weight, 0) || 1;
  for (const t of entries) {
    const already = allocated.get(t.tenantId);
    const unmet = Math.max(0, t.demandPerSecond - already);
    const weighted = (t.weight / totalWeight) * capacity;
    const grant = Math.min(unmet, weighted, remaining, t.quotaPerSecond - already, maxShare - already);
    allocated.set(t.tenantId, already + Math.max(0, grant));
    remaining -= Math.max(0, grant);
  }

  // 3) Del eventuelt overskud ud i vægtet rækkefølge (fair, deterministisk).
  if (remaining > 1e-9) {
    const ordered = [...entries].sort((a, b) => (b.weight - a.weight) || a.tenantId.localeCompare(b.tenantId));
    for (const t of ordered) {
      if (remaining <= 1e-9) break;
      const already = allocated.get(t.tenantId);
      const unmet = Math.max(0, t.demandPerSecond - already);
      const cap = Math.min(t.quotaPerSecond - already, maxShare - already);
      const grant = Math.min(unmet, cap, remaining);
      allocated.set(t.tenantId, already + Math.max(0, grant));
      remaining -= Math.max(0, grant);
    }
  }

  const allocations = entries.map((t) => {
    const grant = allocated.get(t.tenantId) ?? 0;
    return {
      tenantId: t.tenantId,
      weight: t.weight,
      demandPerSecond: round(t.demandPerSecond),
      allocatedPerSecond: round(grant),
      rejectedPerSecond: round(Math.max(0, t.demandPerSecond - grant)),
      cappedByQuota: t.demandPerSecond > t.quotaPerSecond,
      cappedByFairShare: t.demandPerSecond > maxShare,
      retryAfterSeconds: t.demandPerSecond > grant ? 1 : 0,
    };
  });

  const totalAllocated = allocations.reduce((sum, a) => sum + a.allocatedPerSecond, 0);
  return {
    capacityPerSecond: round(capacity),
    maxSharePerSecond: round(maxShare),
    reservationPerSecond: round(reservation),
    allocations,
    totalAllocatedPerSecond: round(totalAllocated),
    withinCapacity: totalAllocated <= capacity + 1e-9,
    noTenantAboveMaxShare: allocations.every((a) => a.allocatedPerSecond <= maxShare + 1e-9),
    noisyTenantSharePercent: allocations.length ? round((Math.max(...allocations.map((a) => a.allocatedPerSecond)) / capacity) * 100, 1) : 0,
  };
}

/**
 * Adgangskontrol for en enkelt forespørgsel. Kvoten og den samlede kapacitet
 * kontrolleres før noget kvitteres.
 */
export function admitRequest(plan, { tenantId, currentTenantRps = 0, currentTotalRps = 0, capacityPerSecond = Infinity } = {}) {
  const quota = plan.tenantQuotas.default.maxRequestsPerSecond;
  if (currentTenantRps + 1 > quota) {
    return { tenantId, admitted: false, status: 429, reason: "tenant-quota-exceeded", retryAfterSeconds: 1, durable: false };
  }
  const maxShare = capacityPerSecond * (plan.tenantQuotas.maxSharePercent / 100);
  if (currentTotalRps + 1 > capacityPerSecond || (Number.isFinite(maxShare) && currentTotalRps + 1 > maxShare)) {
    return { tenantId, admitted: false, status: 503, reason: "capacity-exceeded", retryAfterSeconds: 1, durable: false };
  }
  return { tenantId, admitted: true, status: 200, reason: "admitted", retryAfterSeconds: 0, durable: true };
}

/**
 * Simulér holdbar kø-adfærd: et job kvitteres kun efter holdbar skrivning.
 * Afviste jobs skrives ikke og mistes derfor aldrig, fordi de aldrig blev
 * kvitteret. Returnerer antal kvitterede og antal afviste.
 */
export function simulateDurableQueue(plan, { jobs = [], capacityPerSecond = Infinity, queueDepth = 0 } = {}) {
  const maxBacklog = plan.backpressure.queueDepthCritical;
  const accepted = [];
  const rejected = [];
  let inFlight = queueDepth;
  for (const job of jobs) {
    if (inFlight + 1 > maxBacklog) {
      rejected.push({ ...job, reason: "backpressure-queue-full", durable: false });
      continue;
    }
    const decision = admitRequest(plan, {
      tenantId: job.tenantId,
      currentTenantRps: job.currentTenantRps ?? 0,
      currentTotalRps: inFlight,
      capacityPerSecond,
    });
    if (!decision.admitted) {
      rejected.push({ ...job, reason: decision.reason, durable: false });
      continue;
    }
    inFlight += 1;
    accepted.push({ ...job, durable: true });
  }
  const acknowledged = accepted.filter((j) => j.durable).length;
  return {
    accepted: accepted.length,
    rejected: rejected.length,
    acknowledged,
    durableWrites: accepted.filter((j) => j.durable).length,
    lostAcknowledged: 0,
    queueDepthAfter: inFlight,
    acceptedJobs: accepted,
    rejectedJobs: rejected,
  };
}
