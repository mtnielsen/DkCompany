/**
 * DKC-034 — semantiske validatorer for forbrugs- og driftsomkostningsmåling.
 *
 * Skemaet håndhæver formen. Denne modul håndhæver beslutningerne: en prisbog
 * der dækker hver måler, en forbrugsjournal med valuta- og
 * idempotency-semantik, en afstemning der ikke er falsk grøn, og en
 * TCO-sammenligning uden en målt besparelsespåstand. Validatoren erstatter ikke
 * en levende faktura.
 */
import { buildAjv, validate, SCHEMA_IDS } from "./schemas.mjs";
import {
  priceBookProblems,
  usageLedgerProblems,
  operatingCostsProblems,
  companyProfilesProblems,
  costReportProblems,
  tcoComparisonProblems,
} from "../../metering/src/model.mjs";

function err(path, message) {
  return { path, message };
}

function validateOne(ajv, schemaId, data, rules) {
  const instance = ajv ?? buildAjv().ajv;
  const { ok, errors } = validate(instance, schemaId, data);
  const result = ok ? [] : errors.map((e) => err(e.path || "/", e.message));
  if (result.length === 0) result.push(...rules(data));
  return { ok: result.length === 0, errors: result };
}

export function validatePriceBook(data, ajv) {
  return validateOne(ajv, SCHEMA_IDS.priceBook, data, (d) => priceBookProblems(d));
}

export function validateUsageLedger(data, ajv, { book = null } = {}) {
  return validateOne(ajv, SCHEMA_IDS.usageLedger, data, (d) => usageLedgerProblems(d, { book }));
}

export function validateOperatingCosts(data, ajv, { ledger = null, book = null } = {}) {
  // Driftsudgifter har ingen egen kontrakt; den semantiske kontrol står alene.
  const instance = ajv ?? buildAjv().ajv;
  void instance;
  const problems = operatingCostsProblems(data, { ledger, book });
  return { ok: problems.length === 0, errors: problems };
}

export function validateCompanyProfiles(data, ajv, { ledger = null, book = null } = {}) {
  const instance = ajv ?? buildAjv().ajv;
  void instance;
  const problems = companyProfilesProblems(data, { ledger, book });
  return { ok: problems.length === 0, errors: problems };
}

export function validateCostReport(data, ajv) {
  return validateOne(ajv, SCHEMA_IDS.costReport, data, (d) => costReportProblems(d));
}

export function validateTcoComparison(data, ajv) {
  return validateOne(ajv, SCHEMA_IDS.tcoComparison, data, (d) => tcoComparisonProblems(d));
}
