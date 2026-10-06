/**
 * DKC-034 — semantik for forbrugs- og driftsomkostningsmåling.
 *
 * Skemaet håndhæver formen. Denne modul håndhæver beslutningerne:
 *
 *   - prisbogen dækker hver måler (en pris eller en eksplicit manuel omkostning),
 *     og en manglende pris afvises frem for at blive regnet som nul,
 *   - alle beløb har en understøttet valuta og en vekselkurs til rapportens
 *     valuta, så valutaer ikke blandes stiltiende,
 *   - forbrugsjournalen skelner mellem faktisk og estimeret forbrug og bærer en
 *     idempotency-nøgle pr. hændelse, så en gentaget levering ikke dobbelttælles,
 *   - hver tenant har en stopgrænse, og driftsudgifter kan afstemmes mod den
 *     beregnede forbrugsregistrering,
 *   - tre virksomhedsprofiler har et gennemskueligt udgangspunkt, og
 *   - der fremsættes ingen målt besparelsespåstand eller påstand om gratis
 *     drift / fuld SaaS-erstatning uden dokumentation.
 *
 * Modellen måler ikke selv: `measurement.measured` er altid `false`, og en
 * faktisk afstemning kræver en levende faktura.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isNamedHuman } from "../../conformance/src/architecture.mjs";

export const PRICE_BOOK_PATH = "metering/price-book.json";
export const USAGE_LEDGER_PATH = "metering/usage-ledger.json";
export const OPERATING_COSTS_PATH = "metering/operating-costs.json";
export const COMPANY_PROFILES_PATH = "metering/company-profiles.json";
export const COST_REPORT_PATH = "metering/report/cost-report.json";
export const TCO_COMPARISON_PATH = "metering/report/tco-comparison.json";
export const COST_REPORT_DOC_PATH = "docs/costs/cost-report.md";
export const TCO_DOC_PATH = "docs/business/tco-comparison.md";

export const METERS = ["compute", "storage", "backup", "model-calls", "integrations", "runtime", "support", "upstream-features", "migration"];
export const REPORT_CURRENCY = "EUR";
export const MEASUREMENT_MODE = "deterministic-aggregation";
/** Fast genereringstidspunkt, så de committede artefakter er deterministiske. */
export const REPORT_GENERATED_AT = "2026-03-01T00:00:00Z";

function err(path, message) {
  return { path, message };
}

function readJson(root, rel) {
  return JSON.parse(readFileSync(join(root, rel), "utf8"));
}

export function loadPriceBook(root) {
  return readJson(root, PRICE_BOOK_PATH);
}
export function loadUsageLedger(root) {
  return readJson(root, USAGE_LEDGER_PATH);
}
export function loadOperatingCosts(root) {
  return readJson(root, OPERATING_COSTS_PATH);
}
export function loadCompanyProfiles(root) {
  return readJson(root, COMPANY_PROFILES_PATH);
}
export function loadAll(root) {
  return {
    priceBook: loadPriceBook(root),
    usageLedger: loadUsageLedger(root),
    operatingCosts: loadOperatingCosts(root),
    companyProfiles: loadCompanyProfiles(root),
  };
}

/* -------------------------------------------------------------------------- */
/* Prisbog                                                                    */
/* -------------------------------------------------------------------------- */

export function priceBookProblems(book, { supportedMeters = METERS } = {}) {
  const problems = [];
  if (!book || typeof book !== "object") return [err("/", "prisbogen er ikke et objekt")];
  if (!isNamedHuman(book.metadata?.accountableHuman)) {
    problems.push(err("/metadata/accountableHuman", "prisbogen skal have et navngivet menneske som ejer"));
  }
  if (book.missingPricePolicy !== "reject") {
    problems.push(err("/missingPricePolicy", "en manglende pris skal afvises (reject), ikke regnes som nul"));
  }
  const currencies = new Set(book.supportedCurrencies ?? []);
  if (!currencies.has(book.defaultCurrency)) {
    problems.push(err("/defaultCurrency", `standardvalutaen '${book.defaultCurrency}' er ikke i supportedCurrencies`));
  }
  if (currencies.size !== (book.supportedCurrencies ?? []).length) {
    problems.push(err("/supportedCurrencies", "valutaerne skal være unikke"));
  }

  const fxKeys = new Set();
  for (const [i, fx] of (book.fxRates ?? []).entries()) {
    const at = `/fxRates/${i}`;
    if (!currencies.has(fx.from) || !currencies.has(fx.to)) {
      problems.push(err(at, `vekselkursen '${fx.from}->${fx.to}' bruger en ikke-understøttet valuta`));
    }
    if (!(typeof fx.rate === "number" && fx.rate > 0)) problems.push(err(`${at}/rate`, "vekselkursen skal være positiv"));
    if (Number.isNaN(Date.parse(fx.asOf))) problems.push(err(`${at}/asOf`, "vekselkursen mangler et gyldigt tidspunkt"));
    fxKeys.add(`${fx.from}->${fx.to}`);
  }

  const vendorIds = new Set();
  for (const [i, vendor] of (book.vendors ?? []).entries()) {
    const at = `/vendors/${i}`;
    if (vendorIds.has(vendor.id)) problems.push(err(`${at}/id`, `leverandøren '${vendor.id}' er erklæret flere gange`));
    vendorIds.add(vendor.id);
    if (!["supported", "maintenance", "eol", "unknown"].includes(vendor.maintenanceStatus)) {
      problems.push(err(`${at}/maintenanceStatus`, `leverandøren '${vendor.id}' har en ukendt vedligeholdelsesstatus`));
    }
    if (!isNamedHuman(vendor.supportOwner)) {
      problems.push(err(`${at}/supportOwner`, `leverandøren '${vendor.id}' skal have et navngivet menneske som supportansvarlig`));
    }
    if (!(vendor.patchWindow ?? "").trim()) problems.push(err(`${at}/patchWindow`, `leverandøren '${vendor.id}' mangler et patchvindue`));
    if (vendor.maintenanceStatus === "eol") {
      problems.push(err(`${at}/maintenanceStatus`, `leverandøren '${vendor.id}' er eol og må ikke stå uimodsagt i en prisbog til drift`));
    }
  }

  const covered = new Set();
  const priceIds = new Set();
  for (const [i, price] of (book.prices ?? []).entries()) {
    const at = `/prices/${i}`;
    if (priceIds.has(price.id)) problems.push(err(`${at}/id`, `prisen '${price.id}' er erklæret flere gange`));
    priceIds.add(price.id);
    if (!supportedMeters.includes(price.meter)) problems.push(err(`${at}/meter`, `prisen '${price.id}' har en ukendt måler '${price.meter}'`));
    covered.add(price.meter);
    if (!currencies.has(price.currency)) problems.push(err(`${at}/currency`, `prisen '${price.id}' bruger den ikke-understøttede valuta '${price.currency}'`));
    if (!(typeof price.unitPrice === "number" && price.unitPrice >= 0)) problems.push(err(`${at}/unitPrice`, `prisen '${price.id}' mangler en ikke-negativ enhedspris`));
    if (Number.isNaN(Date.parse(price.effectiveFrom))) problems.push(err(`${at}/effectiveFrom`, `prisen '${price.id}' mangler et gyldigt gyldighedstidspunkt`));
    if (price.effectiveTo && Number.isNaN(Date.parse(price.effectiveTo))) problems.push(err(`${at}/effectiveTo`, `prisen '${price.id}' har et ugyldigt udløbstidspunkt`));
    if (price.effectiveTo && Date.parse(price.effectiveTo) <= Date.parse(price.effectiveFrom)) {
      problems.push(err(`${at}/effectiveTo`, `prisen '${price.id}' udløber før den træder i kraft`));
    }
    if (price.vendorRef && !vendorIds.has(price.vendorRef)) problems.push(err(`${at}/vendorRef`, `prisen '${price.id}' peger på den ukendte leverandør '${price.vendorRef}'`));
  }

  for (const [i, manual] of (book.manualCosts ?? []).entries()) {
    const at = `/manualCosts/${i}`;
    if (!supportedMeters.includes(manual.meter)) problems.push(err(`${at}/meter`, `den manuelle omkostning '${manual.id}' har en ukendt måler '${manual.meter}'`));
    covered.add(manual.meter);
    if (!currencies.has(manual.currency)) problems.push(err(`${at}/currency`, `den manuelle omkostning '${manual.id}' bruger en ikke-understøttet valuta`));
    if (!isNamedHuman(manual.owner)) problems.push(err(`${at}/owner`, `den manuelle omkostning '${manual.id}' skal have et navngivet menneske som ejer`));
    if (!(manual.note ?? "").trim() || manual.note.trim().length < 20) {
      problems.push(err(`${at}/note`, `den manuelle omkostning '${manual.id}' skal beskrive hvorfor den ikke er udmålt`));
    }
  }

  for (const meter of supportedMeters) {
    if (!covered.has(meter)) problems.push(err("/prices", `måleren '${meter}' har hverken en pris eller en manuel omkostning`));
  }
  return problems;
}

/* -------------------------------------------------------------------------- */
/* Forbrugsjournal                                                            */
/* -------------------------------------------------------------------------- */

export function usageLedgerProblems(ledger, { book = null, supportedMeters = METERS } = {}) {
  const problems = [];
  if (!ledger || typeof ledger !== "object") return [err("/", "forbrugsjournalen er ikke et objekt")];
  if (!isNamedHuman(ledger.metadata?.accountableHuman)) {
    problems.push(err("/metadata/accountableHuman", "forbrugsjournalen skal have et navngivet menneske som ejer"));
  }
  const currencies = new Set(book?.supportedCurrencies ?? []);
  const fx = new Set((book?.fxRates ?? []).map((r) => `${r.from}->${r.to}`));
  const hasPath = (from, to) => from === to || fx.has(`${from}->${to}`) || fx.has(`${to}->${from}`);

  const tenants = ledger.tenants ?? [];
  if (tenants.length === 0) problems.push(err("/tenants", "journalen skal have mindst én tenant"));
  const tenantIds = new Set();
  for (const [i, tenant] of tenants.entries()) {
    const at = `/tenants/${i}`;
    if (tenantIds.has(tenant.tenantId)) problems.push(err(`${at}/tenantId`, `tenanten '${tenant.tenantId}' er erklæret flere gange`));
    tenantIds.add(tenant.tenantId);
    const limit = tenant.stopLimit ?? {};
    if (currencies.size && !currencies.has(limit.currency)) problems.push(err(`${at}/stopLimit/currency`, `stopgrænsen for '${tenant.tenantId}' bruger en ikke-understøttet valuta`));
    if (!(typeof limit.monthlyLimit === "number" && limit.monthlyLimit > 0)) problems.push(err(`${at}/stopLimit/monthlyLimit`, `stopgrænsen for '${tenant.tenantId}' skal være positiv`));
    if (!["block", "warn"].includes(limit.onExceed)) problems.push(err(`${at}/stopLimit/onExceed`, `stopgrænsen for '${tenant.tenantId}' mangler en handling`));
    if (!["straight-line", "trailing-30d"].includes(limit.forecastMethod)) problems.push(err(`${at}/stopLimit/forecastMethod`, `stopgrænsen for '${tenant.tenantId}' mangler en prognosemetode`));

    const eventIds = new Set();
    for (const [j, event] of (tenant.events ?? []).entries()) {
      const et = `${at}/events/${j}`;
      if (eventIds.has(event.id)) problems.push(err(`${et}/id`, `hændelsen '${event.id}' er erklæret flere gange`));
      eventIds.add(event.id);
      if (!supportedMeters.includes(event.meter)) problems.push(err(`${et}/meter`, `hændelsen '${event.id}' har en ukendt måler`));
      if (!(typeof event.quantity === "number" && event.quantity > 0)) problems.push(err(`${et}/quantity`, `hændelsen '${event.id}' skal have en positiv mængde`));
      if (!["actual", "estimated"].includes(event.provenance)) problems.push(err(`${et}/provenance`, `hændelsen '${event.id}' mangler herkomst`));
      if (Number.isNaN(Date.parse(event.occurredAt))) problems.push(err(`${et}/occurredAt`, `hændelsen '${event.id}' mangler et gyldigt tidspunkt`));
      if (currencies.size) {
        if (!currencies.has(event.currency)) {
          problems.push(err(`${et}/currency`, `hændelsen '${event.id}' bruger den ikke-understøttede valuta '${event.currency}'`));
        } else if (!hasPath(event.currency, book?.defaultCurrency ?? event.currency)) {
          problems.push(err(`${et}/currency`, `hændelsen '${event.id}' mangler en vekselkurs fra '${event.currency}'`));
        }
      }
    }
  }
  return problems;
}

/* -------------------------------------------------------------------------- */
/* Driftsudgifter                                                             */
/* -------------------------------------------------------------------------- */

export function operatingCostsProblems(costs, { ledger = null, book = null } = {}) {
  const problems = [];
  if (!costs || typeof costs !== "object") return [err("/", "driftsudgifterne er ikke et objekt")];
  if (!isNamedHuman(costs.metadata?.accountableHuman)) {
    problems.push(err("/metadata/accountableHuman", "driftsudgifterne skal have et navngivet menneske som ejer"));
  }
  if (book && !(book.supportedCurrencies ?? []).includes(costs.currency)) {
    problems.push(err("/currency", `driftsudgifterne bruger en ikke-understøttet valuta '${costs.currency}'`));
  }
  if (!(typeof costs.tolerancePercent === "number" && costs.tolerancePercent >= 0)) {
    problems.push(err("/tolerancePercent", "afstemningstolerancen skal være et ikke-negativt tal"));
  }
  const ledgerTenants = new Set((ledger?.tenants ?? []).map((t) => t.tenantId));
  const seen = new Set();
  for (const [i, tenant] of (costs.tenants ?? []).entries()) {
    const at = `/tenants/${i}`;
    if (seen.has(tenant.tenantId)) problems.push(err(`${at}/tenantId`, `driftsudgiften for '${tenant.tenantId}' er erklæret flere gange`));
    seen.add(tenant.tenantId);
    if (ledgerTenants.size && !ledgerTenants.has(tenant.tenantId)) {
      problems.push(err(`${at}/tenantId`, `driftsudgiften peger på den ukendte tenant '${tenant.tenantId}'`));
    }
    if (!(typeof tenant.operatingExpenseTotal === "number" && tenant.operatingExpenseTotal >= 0)) {
      problems.push(err(`${at}/operatingExpenseTotal`, `driftsudgiften for '${tenant.tenantId}' skal være ikke-negativ`));
    }
    if (!(tenant.invoiceRef ?? "").trim()) problems.push(err(`${at}/invoiceRef`, `driftsudgiften for '${tenant.tenantId}' mangler en fakturareference`));
  }
  for (const id of ledgerTenants) {
    if (!seen.has(id)) problems.push(err("/tenants", `tenanten '${id}' mangler en driftsudgift, så afstemning ikke er mulig`));
  }
  return problems;
}

/* -------------------------------------------------------------------------- */
/* Virksomhedsprofiler og claim-politik                                       */
/* -------------------------------------------------------------------------- */

export function companyProfilesProblems(profiles, { ledger = null, book = null, minProfiles = 3 } = {}) {
  const problems = [];
  if (!profiles || typeof profiles !== "object") return [err("/", "virksomhedsprofilerne er ikke et objekt")];
  if (!isNamedHuman(profiles.metadata?.accountableHuman)) {
    problems.push(err("/metadata/accountableHuman", "virksomhedsprofilerne skal have et navngivet menneske som ejer"));
  }
  const currencies = new Set(book?.supportedCurrencies ?? []);
  if (currencies.size && !currencies.has(profiles.currency)) {
    problems.push(err("/currency", `virksomhedsprofilerne bruger en ikke-understøttet valuta '${profiles.currency}'`));
  }
  const list = profiles.profiles ?? [];
  if (list.length < minProfiles) problems.push(err("/profiles", `der skal være mindst ${minProfiles} virksomhedsprofiler`));
  const ledgerTenants = new Set((ledger?.tenants ?? []).map((t) => t.tenantId));
  const ids = new Set();
  for (const [i, profile] of list.entries()) {
    const at = `/profiles/${i}`;
    if (ids.has(profile.id)) problems.push(err(`${at}/id`, `profilen '${profile.id}' er erklæret flere gange`));
    ids.add(profile.id);
    if (ledgerTenants.size && !ledgerTenants.has(profile.ledgerTenantId)) {
      problems.push(err(`${at}/ledgerTenantId`, `profilen '${profile.id}' peger på den ukendte tenant '${profile.ledgerTenantId}'`));
    }
    if (!(typeof profile.currentMonthlyCost === "number" && profile.currentMonthlyCost >= 0)) {
      problems.push(err(`${at}/currentMonthlyCost`, `profilen '${profile.id}' mangler en ikke-negativ nutidsomkostning`));
    }
    const lines = profile.costLines ?? [];
    if (lines.length === 0) problems.push(err(`${at}/costLines`, `profilen '${profile.id}' mangler omkostningslinjer`));
    const meters = new Set();
    let sum = 0;
    for (const [j, line] of lines.entries()) {
      if (meters.has(line.meter)) problems.push(err(`${at}/costLines/${j}/meter`, `måleren '${line.meter}' er angivet flere gange i profilen '${profile.id}'`));
      meters.add(line.meter);
      sum += line.currentCost;
    }
    if (lines.length && Math.abs(sum - profile.currentMonthlyCost) > 0.01) {
      problems.push(err(`${at}/costLines`, `omkostningslinjerne for '${profile.id}' summer til ${sum}, ikke ${profile.currentMonthlyCost}`));
    }
    if (!(typeof profile.migrationOneTimeCost === "number" && profile.migrationOneTimeCost >= 0)) {
      problems.push(err(`${at}/migrationOneTimeCost`, `profilen '${profile.id}' mangler en ikke-negativ migreringsomkostning`));
    }
  }

  const claims = profiles.claims ?? {};
  if (claims.noFreeOperation !== true) problems.push(err("/claims/noFreeOperation", "der må ikke påstås gratis drift"));
  if (claims.notFullSaasReplacement !== true) problems.push(err("/claims/notFullSaasReplacement", "der må ikke påstås fuld SaaS-erstatning"));
  if (!(claims.documentationRefs ?? []).length) problems.push(err("/claims/documentationRefs", "claim-politikken skal pege på dokumentation"));
  if (claims.savingsClaimed === true && !(claims.comparableDataRef ?? "").trim()) {
    problems.push(err("/claims/comparableDataRef", "en besparelsespåstand kræver rigtige sammenlignelige data"));
  }
  if (claims.savingsClaimed !== true && (claims.comparableDataRef ?? null) !== null) {
    problems.push(err("/claims/comparableDataRef", "uden en besparelsespåstand må der ikke hævdes sammenlignelige data"));
  }
  if (!(claims.rationale ?? "").trim() || claims.rationale.trim().length < 30) {
    problems.push(err("/claims/rationale", "claim-politikken skal begrunde hvorfor der ikke påstås gratis drift eller fuld SaaS-erstatning"));
  }
  return problems;
}

/* -------------------------------------------------------------------------- */
/* Genereret rapport og TCO                                                   */
/* -------------------------------------------------------------------------- */

/** Semantiske problemer for den genererede forbrugsrapport. */
export function costReportProblems(report) {
  const problems = [];
  if (!report || typeof report !== "object") return [err("/", "rapporten er ikke et objekt")];
  if (!isNamedHuman(report.metadata?.accountableHuman)) {
    problems.push(err("/metadata/accountableHuman", "rapporten skal have et navngivet menneske som ejer"));
  }
  if (report.measurement?.measured !== false) problems.push(err("/measurement/measured", "rapporten må ikke erklære en levende måling"));
  if (report.measurement?.requiresLiveInvoice !== true) problems.push(err("/measurement/requiresLiveInvoice", "en målt afstemning kræver en levende faktura"));
  const tenantIds = new Set();
  for (const [i, tenant] of (report.tenants ?? []).entries()) {
    const at = `/tenants/${i}`;
    if (tenantIds.has(tenant.tenantId)) problems.push(err(`${at}/tenantId`, `tenanten '${tenant.tenantId}' er erklæret flere gange`));
    tenantIds.add(tenant.tenantId);
    if (Math.abs(tenant.actualTotal + tenant.estimatedTotal - tenant.total) > 0.01) {
      problems.push(err(`${at}/total`, `total for '${tenant.tenantId}' er ikke summen af faktisk og estimeret forbrug`));
    }
    const lineSum = Object.values(tenant.breakdown ?? {}).reduce((a, b) => a + b, 0);
    if (Math.abs(lineSum - tenant.total) > 0.01) {
      problems.push(err(`${at}/breakdown`, `opdelingen for '${tenant.tenantId}' summer til ${lineSum}, ikke ${tenant.total}`));
    }
    if (!tenant.reconciliation) problems.push(err(`${at}/reconciliation`, `tenanten '${tenant.tenantId}' mangler en afstemning`));
    if (tenant.currency !== report.currency) problems.push(err(`${at}/currency`, `tenanten '${tenant.tenantId}' er ikke i rapportvalutaen`));
  }
  const statuses = new Set((report.tenants ?? []).map((t) => t.reconciliation?.status));
  if (statuses.has("unreconciled") && report.reconciliation?.status !== "unreconciled") {
    problems.push(err("/reconciliation/status", "en uafstemt tenant skal gøre hele rapporten uafstemt"));
  }
  return problems;
}

/** Semantiske problemer for TCO-sammenligningen. */
export function tcoComparisonProblems(tco, { minProfiles = 3 } = {}) {
  const problems = [];
  if (!tco || typeof tco !== "object") return [err("/", "TCO-sammenligningen er ikke et objekt")];
  if (!isNamedHuman(tco.metadata?.accountableHuman)) {
    problems.push(err("/metadata/accountableHuman", "TCO-sammenligningen skal have et navngivet menneske som ejer"));
  }
  if (tco.measured !== false) problems.push(err("/measured", "TCO-sammenligningen må ikke erklære en målt besparelse"));
  const profiles = tco.profiles ?? [];
  if (profiles.length < minProfiles) problems.push(err("/profiles", `der skal være mindst ${minProfiles} virksomhedsprofiler`));
  const ids = new Set();
  for (const [i, profile] of profiles.entries()) {
    const at = `/profiles/${i}`;
    if (ids.has(profile.id)) problems.push(err(`${at}/id`, `profilen '${profile.id}' er erklæret flere gange`));
    ids.add(profile.id);
    if (Math.abs(profile.savingsMonthly - (profile.currentMonthlyCost - profile.platformMonthlyCost)) > 0.01) {
      problems.push(err(`${at}/savingsMonthly`, `difference for '${profile.id}' stemmer ikke med aktuel minus platform`));
    }
    if (Math.abs(profile.twelveMonthTco - (profile.platformMonthlyCost * 12 + profile.migrationOneTimeCost)) > 0.01) {
      problems.push(err(`${at}/twelveMonthTco`, `12-måneders TCO for '${profile.id}' stemmer ikke`));
    }
    const platformSum = (profile.costLines ?? []).reduce((a, l) => a + l.platformCost, 0);
    if (Math.abs(platformSum - profile.platformMonthlyCost) > 0.01) {
      problems.push(err(`${at}/costLines`, `platformslinjerne for '${profile.id}' summer til ${platformSum}, ikke ${profile.platformMonthlyCost}`));
    }
    const currentSum = (profile.costLines ?? []).reduce((a, l) => a + l.currentCost, 0);
    if (Math.abs(currentSum - profile.currentMonthlyCost) > 0.01) {
      problems.push(err(`${at}/costLines`, `nutidslinjerne for '${profile.id}' summer til ${currentSum}, ikke ${profile.currentMonthlyCost}`));
    }
  }
  const claims = tco.claims ?? {};
  if (claims.savingsClaimed === true && !(claims.comparableDataRef ?? "").trim()) {
    problems.push(err("/claims/comparableDataRef", "en besparelsespåstand kræver rigtige sammenlignelige data"));
  }
  if (claims.savingsClaimed !== true && (claims.comparableDataRef ?? null) !== null) {
    problems.push(err("/claims/comparableDataRef", "uden en besparelsespåstand må der ikke hævdes sammenlignelige data"));
  }
  if (claims.noFreeOperation !== true) problems.push(err("/claims/noFreeOperation", "der må ikke påstås gratis drift"));
  if (claims.notFullSaasReplacement !== true) problems.push(err("/claims/notFullSaasReplacement", "der må ikke påstås fuld SaaS-erstatning"));
  if (!(claims.documentationRefs ?? []).length) problems.push(err("/claims/documentationRefs", "claim-politikken skal pege på dokumentation"));
  return problems;
}
