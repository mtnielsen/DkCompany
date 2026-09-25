/**
 * DKC-034 — konformanstest for forbrugs- og driftsomkostningsmålingen.
 *
 * Tester skema + semantik på de faktiske filer og eksemplerne, og at et brud
 * afvises. En målt fakturaafstemning er og forbliver NOT RUN.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../src/schemas.mjs";
import {
  validatePriceBook,
  validateUsageLedger,
  validateOperatingCosts,
  validateCompanyProfiles,
  validateCostReport,
  validateTcoComparison,
} from "../src/metering.mjs";
import { priceBookProblems } from "../../metering/src/model.mjs";

function read(rel) {
  return JSON.parse(readFileSync(join(repoRoot, rel), "utf8"));
}

const priceBook = read("metering/price-book.json");
const usageLedger = read("metering/usage-ledger.json");
const operatingCosts = read("metering/operating-costs.json");
const companyProfiles = read("metering/company-profiles.json");
const costReport = read("metering/report/cost-report.json");
const tco = read("metering/report/tco-comparison.json");

test("den faktiske prisbog validerer mod skema og semantik", () => {
  const result = validatePriceBook(priceBook);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("den faktiske forbrugsjournal validerer mod skema og semantik", () => {
  const result = validateUsageLedger(usageLedger, undefined, { book: priceBook });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("driftsudgifter og virksomhedsprofiler validerer", () => {
  assert.equal(validateOperatingCosts(operatingCosts, undefined, { ledger: usageLedger, book: priceBook }).ok, true);
  assert.equal(validateCompanyProfiles(companyProfiles, undefined, { ledger: usageLedger, book: priceBook }).ok, true);
});

test("den genererede rapport og TCO-sammenligning validerer", () => {
  assert.equal(validateCostReport(costReport).ok, true);
  assert.equal(validateTcoComparison(tco).ok, true);
});

test("de fire eksempler validerer", () => {
  assert.equal(validatePriceBook(read("contracts/examples/price-book.example.json")).ok, true);
  assert.equal(validateUsageLedger(read("contracts/examples/usage-ledger.example.json"), undefined, { book: priceBook }).ok, true);
  assert.equal(validateCostReport(read("contracts/examples/cost-report.example.json")).ok, true);
  assert.equal(validateTcoComparison(read("contracts/examples/tco-comparison.example.json")).ok, true);
});

test("en prisbog uden en dækket måler afvises", () => {
  const broken = { ...priceBook, prices: priceBook.prices.filter((p) => p.meter !== "backup") };
  assert.ok(priceBookProblems(broken).some((p) => p.message.includes("backup")));
});

test("en forbrugshændelse i en ikke-understøttet valuta afvises", () => {
  const broken = JSON.parse(JSON.stringify(usageLedger));
  broken.tenants[0].events[0].currency = "GBP";
  assert.ok(validateUsageLedger(broken, undefined, { book: priceBook }).errors.length > 0);
});

test("en TCO-sammenligning uden dokumentation afvises", () => {
  const broken = { ...tco, claims: { ...tco.claims, documentationRefs: [] } };
  assert.ok(validateTcoComparison(broken).errors.length > 0);
});
