/**
 * DKC-059 — semantiske validatorer for providerkontrakter.
 *
 * Skemaet håndhæver formen. Disse validatorer håndhæver beslutningerne: et
 * capability-katalog med obligatoriske og sikkerhedskritiske capabilities, et
 * providerregister der er konsistent med kataloget, en supportmatrix der
 * klassificerer hvert skift, og en preflight/kvittering der ikke lader en
 * forbindelsesstreng omgå gaten.
 */
import { buildAjv, validate, SCHEMA_IDS } from "./schemas.mjs";
import {
  capabilityCatalogProblems,
  providerRegistryProblems,
  supportMatrixProblems,
  swapPolicyProblems,
  swapFixtureProblems,
} from "../../migration/src/provider-model.mjs";

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

export function validateProviderCapabilityCatalog(data, ajv, options = {}) {
  return validateOne(ajv, SCHEMA_IDS.providerCapabilityCatalog, data, (d) => capabilityCatalogProblems(d, options));
}

export function validateProviderRegistry(data, ajv, { catalog = null } = {}) {
  return validateOne(ajv, SCHEMA_IDS.providerRegistry, data, (d) => providerRegistryProblems(d, { catalog }));
}

export function validateProviderSupportMatrix(data, ajv, { providers = null, catalog = null } = {}) {
  return validateOne(ajv, SCHEMA_IDS.providerSupportMatrix, data, (d) => supportMatrixProblems(d, { providers, catalog }));
}

export function validateProviderPreflight(data, ajv) {
  // Preflight'en har ingen yderligere krydsreference; skemaet er kontrakten.
  return validateOne(ajv, SCHEMA_IDS.providerPreflight, data, () => []);
}

export function validateProviderSwapReceipt(data, ajv) {
  return validateOne(ajv, SCHEMA_IDS.providerSwapReceipt, data, () => []);
}

export function validateProviderPolicy(data) {
  const problems = swapPolicyProblems(data);
  return { ok: problems.length === 0, errors: problems };
}

export function validateProviderSwapFixture(data, ajv, { providers = null, matrix = null } = {}) {
  const problems = swapFixtureProblems(data, { providers, matrix });
  return { ok: problems.length === 0, errors: problems };
}
