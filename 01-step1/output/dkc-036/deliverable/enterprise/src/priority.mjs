/**
 * DKC-036 — efterspørgsels- og omkostningsprioritering.
 *
 * Prioriteringen er deterministisk og bygger på to dokumenterede kilder:
 * efterspørgslen fra pilotvirksomhedsprofilerne (DKC-033) og den samlede
 * omkostning fra TCO-sammenligningen (DKC-034). Den er en planlægningsrækkefølge
 * — ikke en bestillings- eller implementeringsgodkendelse.
 */
export function demandScore(pkg, { pilotProfiles = null } = {}) {
  const matchedPilot = (pilotProfiles?.profiles ?? []).filter(
    (p) => (pkg.demand?.segments ?? []).includes(p.segment) || (pkg.demand?.pilotProfileRefs ?? []).includes(p.id)
  ).length;
  const matchedBusiness = (pkg.demand?.businessProfileRefs ?? []).length;
  return matchedPilot + matchedBusiness;
}

export function packageTco(pkg, tco) {
  const profile = (tco?.profiles ?? []).find((p) => p.id === pkg.tcoRef?.profileId);
  if (!profile) return null;
  return {
    profileId: profile.id,
    name: profile.name,
    twelveMonthTco: profile.twelveMonthTco,
    platformMonthlyCost: profile.platformMonthlyCost,
    measured: tco?.measured === true,
  };
}

export function prioritizePackages(packages, { pilotProfiles = null, tco = null } = {}) {
  const rows = packages.map((pkg) => {
    const demand = demandScore(pkg, { pilotProfiles });
    const cost = packageTco(pkg, tco);
    const tcoBand = cost ? Math.round(cost.twelveMonthTco / 1000) : 0;
    const priorityScore = demand * 1000 - tcoBand;
    return {
      id: pkg.id,
      title: pkg.title,
      demandScore: demand,
      businessProfileRefs: [...(pkg.demand?.businessProfileRefs ?? [])],
      declaredDemandRank: pkg.demand?.demandRank ?? null,
      tco: cost,
      priorityScore,
      rationale: `Efterspørgsel ${demand} (pilotsegmenter + forretningsprofiler); 12-måneders TCO ${cost ? `${cost.twelveMonthTco} ${cost.profileId}` : "ukendt"}.`,
    };
  });
  return rows.sort((a, b) => b.priorityScore - a.priorityScore || (a.declaredDemandRank ?? 99) - (b.declaredDemandRank ?? 99) || a.id.localeCompare(b.id));
}
