import { test } from "node:test";
import assert from "node:assert/strict";
import { repoRoot } from "../../conformance/src/schemas.mjs";
import { loadPriceBook, loadUsageLedger } from "../src/model.mjs";
import { activePrice, fxRate, convert, priceUsageEvent } from "../src/pricing.mjs";

const book = loadPriceBook(repoRoot);
const ledger = loadUsageLedger(repoRoot);
const acme = ledger.tenants.find((t) => t.tenantId === "acme");

test("den aktive pris vælges efter måler og tidspunkt", () => {
  const price = activePrice(book, "compute", "2026-02-15T10:00:00Z");
  assert.equal(price.id, "compute-vcpu-hour");
  assert.equal(activePrice(book, "compute", "2025-01-01T00:00:00Z"), null);
});

test("en manglende pris afvises i stedet for at blive regnet som nul", () => {
  const withoutCompute = { ...book, prices: book.prices.filter((p) => p.meter !== "compute") };
  const result = priceUsageEvent(acme.events[0], withoutCompute, { reportCurrency: "EUR" });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "missing-price");
});

test("valutaer omregnes via en eksplicit kurs", () => {
  assert.equal(fxRate(book, "DKK", "EUR"), 0.134);
  assert.equal(convert(book, 100, "DKK", "EUR"), 13.4);
  assert.equal(fxRate(book, "GBP", "EUR"), null);
  assert.throws(() => convert(book, 100, "GBP", "EUR"), /manglende vekselkurs/);
});

test("en hændelse i en valuta uden kurs afvises", () => {
  const event = { ...acme.events[0], currency: "GBP" };
  const result = priceUsageEvent(event, book, { reportCurrency: "EUR" });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "currency-inconsistency");
});
