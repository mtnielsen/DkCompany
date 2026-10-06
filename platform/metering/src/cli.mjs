#!/usr/bin/env node
/**
 * DKC-034 — CLI for forbrugs- og driftsomkostningsmåling.
 *
 *   node metering/src/cli.mjs render    # skriv rapport og TCO-sammenligning
 *   node metering/src/cli.mjs check     # validér input, semantik og artefakter
 *   node metering/src/cli.mjs report    # skriv forbrugsrapporten til stdout
 *   node metering/src/cli.mjs drill     # kør den deterministiske kontrol
 *
 * En `drill` er en deterministisk aggregering (`measured: false`); en målt
 * afstemning mod en levende faktura er NOT RUN.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { repoRoot } from "../../conformance/src/schemas.mjs";
import { loadAll, REPORT_CURRENCY, REPORT_GENERATED_AT } from "./model.mjs";
import { buildCostReport } from "./report.mjs";
import { buildTcoComparison } from "./tco.mjs";
import { renderMetering } from "./render.mjs";
import { runMeteringCheck } from "./check.mjs";
import { aggregateTenant, dedupeEvents } from "./aggregate.mjs";
import { priceUsageEvent } from "./pricing.mjs";
import { exportCostReport } from "./authorization.mjs";

function writeFile(root, rel, contents) {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

export function renderMeteringArtifacts(root = repoRoot) {
  const all = loadAll(root);
  const { report, problems } = buildCostReport({ ...all, generatedAt: REPORT_GENERATED_AT });
  if (problems.length) throw new Error(`kunne ikke bygge rapporten: ${problems.map((p) => p.message).join("; ")}`);
  const tco = buildTcoComparison({ companyProfiles: all.companyProfiles, costReport: report, generatedAt: report.generatedAt });
  const rendered = renderMetering({ costReport: report, tcoComparison: tco });
  for (const [rel, value] of rendered) writeFile(root, rel, value);
  return { report, tco, rendered };
}

function drill() {
  const all = loadAll(repoRoot);
  const checks = {};

  // 1) Alle tre virksomhedsprofiler har et gennemskueligt udgangspunkt.
  checks.threeProfiles = (all.companyProfiles.profiles ?? []).length >= 3;
  checks.profileHasActualBaseline = all.companyProfiles.profiles.every((p) => p.currentMonthlyCost > 0 && (p.currentCostSource ?? "").trim());

  // 2) En dublet dobbelttælles ikke.
  const acme = all.usageLedger.tenants.find((t) => t.tenantId === "acme");
  const { unique, duplicates } = dedupeEvents(acme.events);
  const aggregate = aggregateTenant(acme, all.priceBook, { reportCurrency: REPORT_CURRENCY });
  const rawSum = acme.events.reduce((sum, e) => sum + (priceUsageEvent(e, all.priceBook, { reportCurrency: REPORT_CURRENCY }).amount ?? 0), 0);
  checks.duplicateNotDoubleCounted = duplicates.length >= 1 && aggregate.total < Math.round(rawSum * 100) / 100;
  checks.deduplicatedCountMatches = unique.length + duplicates.length === acme.events.length;

  // 3) En manglende pris regnes ikke som nul.
  const withoutCompute = { ...all.priceBook, prices: all.priceBook.prices.filter((p) => p.meter !== "compute") };
  checks.missingPriceRejected = priceUsageEvent(acme.events[0], withoutCompute, { reportCurrency: REPORT_CURRENCY }).ok === false;

  // 4) Tenant-isolation: en kunde kan kun eksportere sin egen rapport.
  const { report } = buildCostReport({ ...all, generatedAt: "2026-03-01T00:00:00Z" });
  const globexExport = exportCostReport({ report, principal: { kind: "human", id: "u1", tenantId: "globex", roles: ["billing-reader"] } });
  checks.tenantIsolation = globexExport.tenants.every((t) => t.tenantId === "globex");
  let denied = false;
  try {
    exportCostReport({ report, principal: { kind: "human", id: "u1", tenantId: "globex", roles: ["billing-reader"] }, requestedTenantId: "acme" });
  } catch {
    denied = true;
  }
  checks.crossTenantDenied = denied;

  // 5) Afstemningen er ikke falsk grøn.
  checks.reconciliationNotFalselyGreen = report.reconciliation.status !== "unreconciled" && report.tenants.every((t) => t.reconciliation.status !== "reconciled" || t.reconciliation.operatingExpenseTotal !== null);

  // 6) Ingen målt besparelsespåstand.
  checks.noMeasuredSavingsClaim = all.companyProfiles.claims.savingsClaimed === false && all.companyProfiles.claims.comparableDataRef === null;

  for (const [name, ok] of Object.entries(checks)) console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  const ok = Object.values(checks).every(Boolean);
  console.log(`målt=false, tenants=${report.tenants.length}, valuta=${report.currency}, afstemning=${report.reconciliation.status}`);
  if (!ok) process.exit(1);
}

function main() {
  const command = process.argv[2];
  if (command === "render") {
    const { rendered } = renderMeteringArtifacts(repoRoot);
    console.log(`✔ Skrev ${rendered.size} metering-artefakter`);
    return;
  }
  if (command === "check") {
    const result = runMeteringCheck(repoRoot);
    if (!result.ok) {
      console.error("✘ Metering-kontrol fejlede:\n");
      for (const p of result.problems) console.error(`  - ${p}`);
      process.exit(1);
    }
    console.log("✔ Forbrugs- og driftsomkostningsmålingen er konsistent");
    return;
  }
  if (command === "report") {
    const all = loadAll(repoRoot);
    const { report } = buildCostReport({ ...all, generatedAt: REPORT_GENERATED_AT });
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    return;
  }
  if (command === "drill") {
    drill();
    return;
  }
  console.error("Brug: node metering/src/cli.mjs <render|check|report|drill>");
  process.exit(2);
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));
if (invokedDirectly) main();
