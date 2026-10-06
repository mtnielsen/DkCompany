/**
 * DKC-035 — semantiske validatorer for modulregistreringen.
 *
 * Skemaet håndhæver formen. Denne modul håndhæver beslutningerne: at
 * familiekataloget peger på komponenter og krav der findes, at hver
 * katalogkomponents `localization`-blok er konsistent med familiens gates, og
 * at den genererede rapport ikke erklærer en familie danskklar på et uafklaret
 * grundlag.
 */
import { buildAjv, validate, SCHEMA_IDS } from "./schemas.mjs";
import {
  familyCatalogProblems,
  localeRequirementProblems,
  adapterInterfaceProblems,
  componentLocalizationProblems,
  reportProblems,
} from "../../localization/src/model.mjs";

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

export function validateModuleFamilies(data, ajv, options = {}) {
  return validateOne(ajv, SCHEMA_IDS.moduleFamily, data, (d) => familyCatalogProblems(d, options));
}

export function validateLocaleRequirements(data, ajv) {
  return validateOne(ajv, SCHEMA_IDS.localeRequirement, data, (d) => localeRequirementProblems(d));
}

export function validateAdapterInterfaces(data, ajv) {
  return validateOne(ajv, SCHEMA_IDS.adapterInterface, data, (d) => adapterInterfaceProblems(d));
}

export function validateComponentLocalization(manifest, options = {}) {
  const problems = componentLocalizationProblems(manifest, options);
  return { ok: problems.length === 0, errors: problems };
}

export function validateModuleRegistrationReport(data) {
  const problems = reportProblems(data);
  return { ok: problems.length === 0, errors: problems };
}
