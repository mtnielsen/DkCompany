#!/usr/bin/env node
/**
 * DKC-034 — fokuseret kontrol af forbrugs- og driftsomkostningsmålingen.
 *
 *   node metering/src/check.mjs
 *
 * Kontrollerer offline at:
 *   - prisbog, forbrugsjournal, driftsudgifter og virksomhedsprofiler validerer
 *     mod skema og beslutningssemantik,
 *   - de genererede rapporter og dokumenter er i trit med input,
 *   - en manglende pris, en dublet, en valuta-inkonsistens og et
 *     tenant-brud faktisk afvises (negativ kontrol),
 *   - en tenant kun kan eksportere sin egen rapport, og at
 *   - afstemningen ikke er falsk grøn.
 *
 * Der køres ingen levende faktura- eller forbrugsmåling; `make metering-live`
 * er NOT RUN.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../../conformance/src/schemas.mjs";
import { validatePriceBook, validateUsageLedger, validateCostReport, validateTcoComparison } from "../../conformance/src/metering.mjs";
import {
  loadAll,
  usageLedgerProblems,
  REPORT_GENERATED_AT,
  COST_REPORT_PATH,
  TCO_COMPARISON_PATH,
  COST_REPORT_DOC_PATH,
  TCO_DOC_PATH,
} from "./model.mjs";
import { aggregateTenant, aggregateAll } from "./aggregate.mjs";
import { priceUsageEvent } from "./pricing.mjs";
import { buildCostReport } from "./report.mjs";
import { buildTcoComparison } from "./tco.mjs";
import { renderMetering } from "./render.mjs";
import { exportCostReport } from "./authorization.mjs";

export function runMeteringCheck(root = repoRoot) {
  const problems = [];
  const all = loadAll(root);

  const priceValidation = validatePriceBook(all.priceBook);
  for (const e of priceValidation.errors) problems.push(`prisbog${e.path}: ${e.message}`);

  const ledgerValidation = validateUsageLedger(all.usageLedger, undefined, { book: all.priceBook });
  for (const e of ledgerValidation.errors) problems.push(`forbrugsjournal${e.path}: ${e.message}`);

  const { report, problems: aggregationProblems } = buildCostReport({ ...all, generatedAt: REPORT_GENERATED_AT });
  for (const p of aggregationProblems) problems.push(`aggregering${p.path}: ${p.message}`);

  const reportValidation = validateCostReport(report);
  for (const e of reportValidation.errors) problems.push(`cost-report${e.path}: ${e.message}`);

  const tco = buildTcoComparison({ companyProfiles: all.companyProfiles, costReport: report, generatedAt: report.generatedAt });
  const tcoValidation = validateTcoComparison(tco);
  for (const e of tcoValidation.errors) problems.push(`tco-comparison${e.path}: ${e.message}`);

  // Genererede artefakter skal være byte-identiske med input.
  const rendered = renderMetering({ costReport: report, tcoComparison: tco });
  for (const [rel, expected] of rendered) {
    const path = join(root, rel);
    if (!existsSync(path)) {
      problems.push(`${rel} mangler; kør 'make metering-render'`);
      continue;
    }
    if (readFileSync(path, "utf8") !== expected) problems.push(`${rel} er ude af trit; kør 'make metering-render'`);
  }

  // Afstemningen må ikke være falsk grøn.
  if (report.reconciliation.status === "unreconciled") {
    problems.push("forbrugsregistreringen kan ikke afstemmes med driftsudgifterne");
  }

  // Negativ 1: en manglende pris afvises.
  const withoutCompute = { ...all.priceBook, prices: all.priceBook.prices.filter((p) => p.meter !== "compute") };
  if (!validatePriceBook(withoutCompute).errors.some((e) => e.message.includes("compute"))) {
    problems.push("semantikken afviser ikke en prisbog uden en compute-pris");
  }
  const acme = all.usageLedger.tenants.find((t) => t.tenantId === "acme");
  if (priceUsageEvent(acme.events[0], withoutCompute, { reportCurrency: "EUR" }).ok) {
    problems.push("prissætningen regner en manglende pris som nul");
  }

  // Negativ 2: en dublet dobbelttælles ikke.
  const acmeAgg = aggregateTenant(acme, all.priceBook, { reportCurrency: "EUR" });
  if (acmeAgg.duplicateEvents < 1) problems.push("aggregeringen registrerer ikke den kendte dublet");
  if (acmeAgg.deduplicatedEvents + acmeAgg.duplicateEvents !== acme.events.length) {
    problems.push("aggregeringens hændelsestælling stemmer ikke med journalen");
  }

  // Negativ 3: en ikke-understøttet valuta afvises.
  const badCurrency = JSON.parse(JSON.stringify(all.usageLedger));
  badCurrency.tenants[0].events[0].currency = "GBP";
  if (usageLedgerProblems(badCurrency, { book: all.priceBook }).length === 0) {
    problems.push("semantikken afviser ikke en hændelse i en ikke-understøttet valuta");
  }

  // Negativ 4: tenant-isolation i aggregering og eksport.
  const { tenants } = aggregateAll(all.usageLedger, all.priceBook, { reportCurrency: "EUR" });
  const globex = tenants.find((t) => t.tenantId === "globex");
  const acmeTotals = tenants.find((t) => t.tenantId === "acme");
  const expectedGlobex = Object.values(globex.breakdown).reduce((a, b) => a + b, 0);
  if (Math.abs(expectedGlobex - globex.total) > 0.01) problems.push("tenantens opdeling summer ikke til tenantens total");
  if (globex.total === acmeTotals.total) problems.push("to tenants får samme total — mulig krydskontaminering");
  try {
    exportCostReport({ report, principal: { kind: "human", id: "user-globex", tenantId: "globex", roles: ["billing-reader"] } });
  } catch {
    problems.push("en autoriseret tenant kunne ikke eksportere sin egen rapport");
  }
  const globexExport = exportCostReport({ report, principal: { kind: "human", id: "user-globex", tenantId: "globex", roles: ["billing-reader"] } });
  if (globexExport.tenants.some((t) => t.tenantId !== "globex")) problems.push("tenant-eksporten lækkede en anden tenants data");
  let leaked = false;
  try {
    exportCostReport({ report, principal: { kind: "human", id: "user-globex", tenantId: "globex", roles: ["billing-reader"] }, requestedTenantId: "acme" });
    leaked = true;
  } catch {
    leaked = false;
  }
  if (leaked) problems.push("en kunde kunne eksportere en fremmed tenants rapport");

  return { ok: problems.length === 0, problems, report, tco, rendered };
}

function main() {
  const result = runMeteringCheck(repoRoot);
  if (!result.ok) {
    console.error("✘ Metering-kontrol fejlede:\n");
    for (const p of result.problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log("✔ Prisbog, forbrugsjournal, driftsudgifter og virksomhedsprofiler er konsistente");
  console.log(`✔ ${result.report.tenants.length} tenants; samlet afstemning: ${result.report.reconciliation.status}`);
  console.log(`✔ Rapport: ${COST_REPORT_PATH}, ${TCO_COMPARISON_PATH}, ${COST_REPORT_DOC_PATH} og ${TCO_DOC_PATH}`);
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));
if (invokedDirectly) main();
