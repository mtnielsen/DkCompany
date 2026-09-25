import { test } from "node:test";
import assert from "node:assert/strict";
import { repoRoot } from "../../conformance/src/schemas.mjs";
import { loadPriceBook, loadUsageLedger } from "../src/model.mjs";
import { aggregateTenant, aggregateAll, dedupeEvents, buildForecast, budgetStatusFor, reconcileTenant } from "../src/aggregate.mjs";
import { priceUsageEvent, round } from "../src/pricing.mjs";

const book = loadPriceBook(repoRoot);
const ledger = loadUsageLedger(repoRoot);
const acme = ledger.tenants.find((t) => t.tenantId === "acme");

test("en dublet på idempotency-nøglen tælles kun én gang", () => {
  const { unique, duplicates } = dedupeEvents(acme.events);
  assert.equal(duplicates.length, 1);
  assert.equal(unique.length, acme.events.length - 1);
  const aggregate = aggregateTenant(acme, book, { reportCurrency: "EUR" });
  assert.equal(aggregate.duplicateEvents, 1);
  assert.equal(aggregate.deduplicatedEvents, unique.length);
});

test("opdelingen pr. måler summer til tenantens total", () => {
  const aggregate = aggregateTenant(acme, book, { reportCurrency: "EUR" });
  const sum = round(Object.values(aggregate.breakdown).reduce((a, b) => a + b, 0));
  assert.equal(sum, aggregate.total);
  assert.equal(round(aggregate.actualTotal + aggregate.estimatedTotal), aggregate.total);
});

test("en tenants aggregering indeholder ikke en anden tenants forbrug", () => {
  const { tenants } = aggregateAll(ledger, book, { reportCurrency: "EUR" });
  const acmeReport = tenants.find((t) => t.tenantId === "acme");
  const globexReport = tenants.find((t) => t.tenantId === "globex");
  assert.notEqual(acmeReport.total, globexReport.total);
  assert.equal(globexReport.breakdown.backup, 0);
  assert.ok(acmeReport.breakdown.backup > 0);
});

test("prognose og stopgrænse håndhæves", () => {
  const forecast = buildForecast({ method: "straight-line", total: 900, limit: 1000, warningPercent: 80 });
  assert.equal(forecast.percentOfLimit, 90);
  assert.equal(forecast.withinLimit, true);
  assert.equal(forecast.atOrAboveWarning, true);
  assert.equal(budgetStatusFor({ total: 1100, limit: 1000, warningPercent: 80, onExceed: "block" }), "blocked");
  assert.equal(budgetStatusFor({ total: 1100, limit: 1000, warningPercent: 80, onExceed: "warn" }), "warning");
  assert.equal(budgetStatusFor({ total: 100, limit: 1000, warningPercent: 80, onExceed: "warn" }), "within-limit");
});

test("afstemning er ikke falsk grøn uden driftsudgifter", () => {
  const result = reconcileTenant({ tenantId: "acme", actualTotal: 100, operatingCosts: { tolerancePercent: 10, tenants: [] } });
  assert.equal(result.status, "no-operating-expense-data");
  const within = reconcileTenant({ tenantId: "acme", actualTotal: 100, operatingCosts: { tolerancePercent: 10, currency: "EUR", tenants: [{ tenantId: "acme", operatingExpenseTotal: 105, invoiceRef: "invoice://x" }] } });
  assert.equal(within.status, "within-tolerance");
  const outside = reconcileTenant({ tenantId: "acme", actualTotal: 200, operatingCosts: { tolerancePercent: 10, currency: "EUR", tenants: [{ tenantId: "acme", operatingExpenseTotal: 105, invoiceRef: "invoice://x" }] } });
  assert.equal(outside.status, "unreconciled");
});

test("prissætningen er deterministisk", () => {
  const a = priceUsageEvent(acme.events[0], book, { reportCurrency: "EUR" }).amount;
  const b = priceUsageEvent(acme.events[0], book, { reportCurrency: "EUR" }).amount;
  assert.equal(a, b);
});
