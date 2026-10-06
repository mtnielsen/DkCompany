/**
 * DKC-050 — enhedspris og omkostning pr. enhed.
 *
 * Prisen regnes fra planens omkostningsmodel, så "pris før/efter skalering" kan
 * sammenlignes direkte med den målte kapacitet. Alle tal er listepriser i den
 * angivne valuta og udgør ikke en faktura.
 */

const SECONDS_PER_MONTH = 86400 * 30;

export function unitPrice(plan, { requestsPerSecond = 0, jobsPerSecond = 0, aiCallsPerDay = 0, dataGb = 0, vcpu = 0 } = {}) {
  const c = plan.cost;
  const requests = (requestsPerSecond * SECONDS_PER_MONTH) / 1_000_000;
  const jobs = (jobsPerSecond * SECONDS_PER_MONTH) / 1_000_000;
  const ai = aiCallsPerDay * 30;
  return {
    currency: c.currency,
    perRequest: c.perMillionRequests / 1_000_000,
    perJob: c.perMillionJobs / 1_000_000,
    perAiCall: c.perAiCall,
    perGbMonth: c.perGbMonth,
    perVcpuMonth: c.perVcpuHour * 730,
    monthly: {
      vcpu: round(vcpu * c.perVcpuHour * 730),
      storage: round(dataGb * c.perGbMonth),
      ai: round(ai * c.perAiCall),
      requests: round(requests * c.perMillionRequests),
      jobs: round(jobs * c.perMillionJobs),
    },
  };
}

function round(value) {
  return Math.round(value * 100) / 100;
}
