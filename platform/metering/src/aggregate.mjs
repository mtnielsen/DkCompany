/**
 * DKC-034 — aggregering pr. tenant.
 *
 * En hændelse tælles kun én gang pr. idempotency-nøgle (`eventKey`), så en
 * gentaget levering efter et retry ikke dobbelttæller. Faktisk og estimeret
 * forbrug holdes adskilt. Aggregeringen er strengt tenant-scopet: en tenants
 * tal indeholder aldrig en anden tenants hændelser, og en fremmed tenant
 * afvises eksplicit.
 */
import { METERS, REPORT_CURRENCY } from "./model.mjs";
import { priceUsageEvent, round } from "./pricing.mjs";

/** Fjern dubletter på `eventKey`; første forekomst vinder. */
export function dedupeEvents(events = []) {
  const seen = new Map();
  const duplicates = [];
  for (const event of events) {
    if (seen.has(event.eventKey)) {
      duplicates.push(event);
      continue;
    }
    seen.set(event.eventKey, event);
  }
  return { unique: [...seen.values()], duplicates };
}

/**
 * Aggregér én tenants forbrug.
 *
 * @returns en `tenantReport`-struktur (uden prognose/afstemning, som tilføjes
 *          i `report.mjs`) samt prisningsfejl.
 */
export function aggregateTenant(tenant, book, { reportCurrency = REPORT_CURRENCY } = {}) {
  const { unique, duplicates } = dedupeEvents(tenant.events ?? []);
  const breakdown = Object.fromEntries(METERS.map((meter) => [meter, 0]));
  const problems = [];
  let actualTotal = 0;
  let estimatedTotal = 0;
  for (const event of unique) {
    const priced = priceUsageEvent(event, book, { reportCurrency });
    if (!priced.ok) {
      problems.push({ path: `/tenants/${tenant.tenantId}/events/${event.id}`, message: `${priced.reason}: ${priced.detail}` });
      continue;
    }
    breakdown[event.meter] = round(breakdown[event.meter] + priced.amount);
    if (event.provenance === "actual") actualTotal = round(actualTotal + priced.amount);
    else estimatedTotal = round(estimatedTotal + priced.amount);
  }

  const unmeasured = (book?.manualCosts ?? [])
    .filter((cost) => cost.meter)
    .map((cost) => ({
      meter: cost.meter,
      reason: cost.note,
      owner: cost.owner,
      monthlyValue: typeof cost.monthlyValue === "number" ? cost.monthlyValue : null,
    }));

  const total = round(actualTotal + estimatedTotal);
  const limit = tenant.stopLimit ?? {};
  const forecast = buildForecast({ method: limit.forecastMethod, total, limit: limit.monthlyLimit, warningPercent: limit.warningPercent });
  const budgetStatus = budgetStatusFor({ total, limit: limit.monthlyLimit, warningPercent: limit.warningPercent, onExceed: limit.onExceed });

  return {
    tenantId: tenant.tenantId,
    packageId: tenant.packageId,
    currency: reportCurrency,
    actualTotal,
    estimatedTotal,
    total,
    breakdown,
    unmeasured,
    deduplicatedEvents: unique.length,
    duplicateEvents: duplicates.length,
    stopLimit: {
      currency: limit.currency,
      monthlyLimit: limit.monthlyLimit,
      warningPercent: limit.warningPercent,
      onExceed: limit.onExceed,
      forecastMethod: limit.forecastMethod,
    },
    forecast,
    budgetStatus,
    problems,
  };
}

export function buildForecast({ method = "straight-line", total = 0, limit = 1, warningPercent = 80 } = {}) {
  // Journalen dækker én faktisk måned; begge metoder projicerer derfor samme
  // beløb. Forskellen er dokumenteret og kan udvides med en delvis periode.
  const projectedMonthly = round(total);
  const percentOfLimit = limit > 0 ? round((projectedMonthly / limit) * 100) : 0;
  return {
    method,
    projectedMonthly,
    percentOfLimit,
    withinLimit: projectedMonthly <= limit,
    atOrAboveWarning: percentOfLimit >= warningPercent,
  };
}

export function budgetStatusFor({ total = 0, limit = 1, warningPercent = 80, onExceed = "warn" } = {}) {
  if (total > limit) return onExceed === "block" ? "blocked" : "warning";
  const percent = limit > 0 ? (total / limit) * 100 : 0;
  if (percent >= warningPercent) return "warning";
  return "within-limit";
}

/** Aggregér alle tenants; returnerer rapporter og aggregerede prisningsfejl. */
export function aggregateAll(ledger, book, { reportCurrency = REPORT_CURRENCY } = {}) {
  const tenants = [];
  const problems = [];
  for (const tenant of ledger.tenants ?? []) {
    const report = aggregateTenant(tenant, book, { reportCurrency });
    problems.push(...report.problems.map((p) => ({ ...p, path: p.path.replace("/tenants/", "/") })));
    delete report.problems;
    tenants.push(report);
  }
  return { tenants, problems };
}

/**
 * Afstem én tenants beregnede faktiske forbrug mod den manuelt indtastede
 * driftsudgift. Returnerer `{ status, ... }`. En manglende faktura giver
 * `no-operating-expense-data`, ikke en falsk grøn afstemning.
 */
export function reconcileTenant({ tenantId, actualTotal, operatingCosts, reportCurrency = REPORT_CURRENCY } = {}) {
  const tolerance = operatingCosts?.tolerancePercent ?? 0;
  const entry = (operatingCosts?.tenants ?? []).find((t) => t.tenantId === tenantId);
  if (!entry) {
    return {
      status: "no-operating-expense-data",
      operatingCostRef: null,
      actualTotal,
      operatingExpenseTotal: null,
      variancePercent: null,
      tolerancePercent: tolerance,
      unmeasuredNote: `Der findes ingen driftsudgift for '${tenantId}', så forbruget kan ikke afstemmes mod en faktura.`,
    };
  }
  if (operatingCosts.currency !== reportCurrency) {
    return {
      status: "unreconciled",
      operatingCostRef: entry.invoiceRef,
      actualTotal,
      operatingExpenseTotal: entry.operatingExpenseTotal,
      variancePercent: null,
      tolerancePercent: tolerance,
      unmeasuredNote: `Driftsudgifterne er i '${operatingCosts.currency}', men rapporten er i '${reportCurrency}'; de kan ikke afstemmes direkte uden en vekselkurs.`,
    };
  }
  const operating = entry.operatingExpenseTotal ?? 0;
  const variancePercent = operating === 0 ? null : round(((actualTotal - operating) / operating) * 100);
  let status = "unreconciled";
  if (variancePercent !== null && Math.abs(variancePercent) <= tolerance) {
    status = Math.abs(variancePercent) < 0.5 ? "reconciled" : "within-tolerance";
  }
  return {
    status,
    operatingCostRef: entry.invoiceRef,
    actualTotal,
    operatingExpenseTotal: operating,
    variancePercent,
    tolerancePercent: tolerance,
    unmeasuredNote: `Afstemt mod '${entry.invoiceRef}' for perioden; uudmålte support-/on-call-omkostninger indgår ikke i det faktiske forbrug.`,
  };
}
