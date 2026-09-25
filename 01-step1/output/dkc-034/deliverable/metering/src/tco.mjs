/**
 * DKC-034 — TCO-sammenligning for tre virksomhedsprofiler.
 *
 * Hver profil binder kundens faktiske udgangspunkt til en tenant i
 * forbrugsjournalen. Platformprisen kommer fra den meterede rapport — ikke fra
 * et løst tal — og både aktuelle og modellerede omkostninger vises pr. måler.
 * Sammenligningen erklærer altid `measured: false`, og claim-politikken tillader
 * ikke en målt besparelsespåstand, gratis drift eller fuld SaaS-erstatning uden
 * dokumentation.
 */
import { round } from "./pricing.mjs";

export function buildTcoComparison({ companyProfiles, costReport, generatedAt }) {
  const currency = costReport.currency;
  const profiles = (companyProfiles.profiles ?? []).map((profile) => {
    const tenant = (costReport.tenants ?? []).find((t) => t.tenantId === profile.ledgerTenantId);
    if (!tenant) throw new Error(`profilen '${profile.id}' peger på tenanten '${profile.ledgerTenantId}', som ikke findes i rapporten`);

    const currentByMeter = new Map((profile.costLines ?? []).map((line) => [line.meter, line]));
    const meters = new Set([...currentByMeter.keys(), ...Object.keys(tenant.breakdown ?? {})]);
    const costLines = [...meters].sort().map((meter) => {
      const current = currentByMeter.get(meter);
      const platformCost = round(tenant.breakdown?.[meter] ?? 0);
      const note = current?.note ?? (platformCost > 0 ? "Platformsmålt forbrug fra forbrugsjournalen" : "Ingen registreret omkostning");
      return {
        meter,
        currentCost: round(current?.currentCost ?? 0),
        platformCost,
        note,
      };
    });

    const currentMonthlyCost = round(profile.currentMonthlyCost);
    const platformMonthlyCost = round(tenant.total);
    const migrationOneTimeCost = round(profile.migrationOneTimeCost);
    const twelveMonthTco = round(platformMonthlyCost * 12 + migrationOneTimeCost);
    const savingsMonthly = round(currentMonthlyCost - platformMonthlyCost);
    const savingsPercent = currentMonthlyCost > 0 ? round((savingsMonthly / currentMonthlyCost) * 100) : 0;

    return {
      id: profile.id,
      name: profile.name,
      companySize: profile.companySize,
      currentMonthlyCost,
      currentCostSource: profile.currentCostSource,
      platformMonthlyCost,
      migrationOneTimeCost,
      twelveMonthTco,
      savingsMonthly,
      savingsPercent,
      costLines,
      estimationNote: profile.estimationNote,
    };
  });

  return {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "TcoComparison",
    metadata: {
      name: "platform-tco-comparison",
      version: "1.0.0",
      description: "TCO-sammenligning for tre virksomhedsprofiler med kundens faktiske udgangspunkt og den meterede platformpris. Tallene er en model, ikke en målt besparelse.",
      accountableHuman: companyProfiles.metadata?.accountableHuman,
      labels: companyProfiles.metadata?.labels ?? {},
    },
    generatedAt,
    currency,
    baselineSource: companyProfiles.baselineSource,
    measured: false,
    profiles,
    claims: companyProfiles.claims,
  };
}
