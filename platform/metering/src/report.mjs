/**
 * DKC-034 — byg den autoriserede forbrugs- og driftsomkostningsrapport.
 *
 * Rapporten indeholder pr. tenant: faktisk og estimeret forbrug, en opdeling pr.
 * måler, eksplicit uudmålte/manuel indtastede supportomkostninger, prognose,
 * stopgrænse, budgetstatus og afstemning mod driftsudgifter. Den samlede
 * afstemning er konservativ: én uafstemt tenant gør hele rapporten uafstemt.
 */
import { aggregateAll, reconcileTenant } from "./aggregate.mjs";
import { round } from "./pricing.mjs";
import { MEASUREMENT_MODE, REPORT_CURRENCY } from "./model.mjs";

export function buildCostReport({ priceBook, usageLedger, operatingCosts, generatedAt }) {
  const reportCurrency = priceBook.defaultCurrency ?? REPORT_CURRENCY;
  const { tenants, problems } = aggregateAll(usageLedger, priceBook, { reportCurrency });
  const withReconciliation = tenants.map((tenant) => ({
    ...tenant,
    reconciliation: reconcileTenant({ tenantId: tenant.tenantId, actualTotal: tenant.actualTotal, operatingCosts, reportCurrency }),
  }));

  const actualTotal = round(withReconciliation.reduce((sum, t) => sum + t.actualTotal, 0));
  const operatingExpenseTotal = operatingCosts?.tenants?.length
    ? round(operatingCosts.tenants.reduce((sum, t) => sum + (t.operatingExpenseTotal ?? 0), 0))
    : null;
  const variancePercent = operatingExpenseTotal ? round(((actualTotal - operatingExpenseTotal) / operatingExpenseTotal) * 100) : null;
  const tolerancePercent = operatingCosts?.tolerancePercent ?? 0;
  const statuses = withReconciliation.map((t) => t.reconciliation.status);
  let status = "reconciled";
  if (statuses.includes("unreconciled")) status = "unreconciled";
  else if (statuses.includes("no-operating-expense-data")) status = "no-operating-expense-data";
  else if (statuses.some((s) => s === "within-tolerance")) status = "within-tolerance";

  const report = {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "CostReport",
    metadata: {
      name: "platform-cost-report",
      version: "1.0.0",
      description: "Forbrugs- og driftsomkostningsrapport pr. tenant med prognose, stopgrænser og afstemning. Rapporten er en deterministisk aggregering, ikke en faktura.",
      accountableHuman: priceBook.metadata?.accountableHuman,
      labels: priceBook.metadata?.labels ?? {},
    },
    generatedAt,
    currency: reportCurrency,
    priceBookRef: "metering/price-book.json",
    usageLedgerRef: "metering/usage-ledger.json",
    measurement: {
      mode: MEASUREMENT_MODE,
      measured: false,
      requiresLiveInvoice: true,
      reason: "Forbruget aggregeres deterministisk fra forbrugsjournalen og prisbogen. En målt afstemning kræver en levende faktura og et faktisk driftsregnskab.",
    },
    tenants: withReconciliation,
    reconciliation: {
      status,
      operatingCostRef: operatingCosts?.source ?? null,
      actualTotal,
      operatingExpenseTotal,
      variancePercent,
      tolerancePercent,
      unmeasuredNote: "Uudmålte support-/on-call- og leverandøromkostninger indgår ikke i det faktiske forbrug; de er rapporteret pr. tenant og skal indtastes manuelt.",
    },
  };
  return { report, problems };
}
