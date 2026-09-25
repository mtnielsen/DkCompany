/**
 * DKC-030 — semantiske validatorer for CRM med entydigt ejerskab af kundedata.
 *
 * Skemaet håndhæver formen. Denne modul håndhæver beslutningerne: en
 * EspoCRM-baseret kilde med ejerskab, roller og dedup-nøgler; en post med en
 * tenantafgrænset stabil reference, entydigt ejerskab og klassifikation; og en
 * ærlig sletterapport pr. flade.
 */
import { buildAjv, validate, SCHEMA_IDS } from "./schemas.mjs";
import { crmSourceProblems, crmPolicyProblems, crmRecordProblems, crmDeletionReceiptProblems } from "../../crm/src/model.mjs";

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

export function validateCrmSource(data, ajv, { supportedTenants = null } = {}) {
  return validateOne(ajv, SCHEMA_IDS.crmSource, data, (d) => crmSourceProblems(d, { supportedTenants }));
}

export function validateCrmRecord(data, ajv) {
  return validateOne(ajv, SCHEMA_IDS.crmRecord, data, (d) => crmRecordProblems(d));
}

export function validateCrmDeletionReceipt(data, ajv) {
  return validateOne(ajv, SCHEMA_IDS.crmDeletionReceipt, data, (d) => crmDeletionReceiptProblems(d));
}

export function validateCrmPolicy(data) {
  // Politikken har ingen egen kontrakt; den semantiske kontrol står alene.
  const problems = crmPolicyProblems(data);
  return { ok: problems.length === 0, errors: problems };
}
