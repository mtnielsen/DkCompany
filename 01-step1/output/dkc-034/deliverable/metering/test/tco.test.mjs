import { test } from "node:test";
import assert from "node:assert/strict";
import { repoRoot } from "../../conformance/src/schemas.mjs";
import { loadAll, REPORT_GENERATED_AT } from "../src/model.mjs";
import { buildCostReport } from "../src/report.mjs";
import { buildTcoComparison } from "../src/tco.mjs";
import { tcoComparisonProblems } from "../src/model.mjs";

const all = loadAll(repoRoot);
const { report } = buildCostReport({ ...all, generatedAt: REPORT_GENERATED_AT });
const tco = buildTcoComparison({ companyProfiles: all.companyProfiles, costReport: report, generatedAt: REPORT_GENERATED_AT });

test("tre virksomhedsprofiler sammenlignes mod deres faktiske udgangspunkt", () => {
  assert.equal(tco.profiles.length, 3);
  for (const profile of tco.profiles) {
    assert.ok(profile.currentMonthlyCost > 0);
    assert.ok(profile.currentCostSource.length > 0);
    const platformSum = profile.costLines.reduce((a, l) => a + l.platformCost, 0);
    assert.ok(Math.abs(platformSum - profile.platformMonthlyCost) < 0.01);
  }
});

test("12-måneders TCO og modeldifference stemmer", () => {
  for (const profile of tco.profiles) {
    assert.equal(profile.twelveMonthTco, Math.round((profile.platformMonthlyCost * 12 + profile.migrationOneTimeCost) * 100) / 100);
    assert.equal(profile.savingsMonthly, Math.round((profile.currentMonthlyCost - profile.platformMonthlyCost) * 100) / 100);
  }
});

test("der påstås ingen målt besparelse uden sammenlignelige data", () => {
  assert.equal(tco.claims.savingsClaimed, false);
  assert.equal(tco.claims.comparableDataRef, null);
  assert.equal(tco.claims.noFreeOperation, true);
  assert.equal(tco.claims.notFullSaasReplacement, true);
  assert.ok(tco.claims.documentationRefs.length >= 1);
});

test("en falsk besparelsespåstand afvises", () => {
  const broken = { ...tco, claims: { ...tco.claims, savingsClaimed: true, comparableDataRef: null } };
  assert.ok(tcoComparisonProblems(broken).some((p) => p.path === "/claims/comparableDataRef"));
});

test("en manglende dokumentation afvises", () => {
  const broken = { ...tco, claims: { ...tco.claims, documentationRefs: [] } };
  assert.ok(tcoComparisonProblems(broken).some((p) => p.path === "/claims/documentationRefs"));
});
