/**
 * DKC-015 — registrering af stagingomkostninger.
 *
 * Omkostningen er en del af acceptkriterierne: en staginginstallation uden et
 * registreret beløb er ikke dokumenteret. Modulet summerer posterne og fejler,
 * hvis de ikke matcher planens månedsbeløb.
 */
import { PLAN_PATH } from "./plan.mjs";

export function computeCost(plan) {
  const items = (plan?.cost?.items ?? []).map((item) => ({ id: item.id, description: item.description, monthly: Number(item.monthly) }));
  const computed = Number(items.reduce((acc, item) => acc + item.monthly, 0).toFixed(2));
  const declared = Number(plan?.cost?.monthlyEstimate);
  return { currency: plan?.cost?.currency ?? null, declared, computed, items, consistent: Math.abs(computed - declared) <= 0.01 };
}

export function stagingCostDocument(plan) {
  const cost = computeCost(plan);
  return {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "StagingCost",
    generatedFrom: PLAN_PATH,
    currency: cost.currency,
    monthlyEstimate: cost.declared,
    computedMonthly: cost.computed,
    items: cost.items,
    notes: "Staging bruger samme hostingprofil som prod, men med ét miljø og lavere kapacitet. Beløbet er et budget, ikke en målt regning.",
  };
}

export function checkCost(plan) {
  const cost = computeCost(plan);
  if (!cost.consistent) {
    return { ok: false, problems: [`månedsbeløbet (${cost.declared}) matcher ikke summen af posterne (${cost.computed})`], cost };
  }
  return { ok: true, problems: [], cost };
}
