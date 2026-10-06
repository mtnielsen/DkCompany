/**
 * DKC-061 — semantiske validatorer for produktlivscyklussen.
 *
 * Skemaet håndhæver formen. Disse validatorer håndhæver beslutningerne: et
 * signeret releasekatalog med supportvindue, EOL-status, vedtaget håndtering og
 * kompatibilitetslås; en opdateringsplan med påvirkning, migrationskontrol,
 * rollback og godkendelse; en fjernelsesplan adskilt fra datasletning med
 * reverse-dependency-kontrol; en supportbundlepolitik og -bundle uden
 * hemmeligheder eller HR-indhold og uden skjult fjernadgang; og en offlinepakke
 * hvor lokale kerneflows består og hver ekstern afhængighed er markeret.
 */
import { buildAjv, validate, SCHEMA_IDS } from "./schemas.mjs";
import {
  releaseCatalogProblems,
  updatePlanProblems,
  removalPlanProblems,
  supportPolicyProblems,
  supportBundleProblems,
  offlinePackageProblems,
} from "../../installer/src/lifecycle-model.mjs";

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

export function validateReleaseCatalog(data, ajv, { keyring = null, components = [], now = Date.now() } = {}) {
  return validateOne(ajv, SCHEMA_IDS.releaseCatalog, data, (d) => releaseCatalogProblems(d, { keyring, components, now }));
}

export function validateLifecycleUpdatePlan(data, ajv, { now = Date.now() } = {}) {
  return validateOne(ajv, SCHEMA_IDS.lifecycleUpdatePlan, data, (d) => updatePlanProblems(d, { now }));
}

export function validateLifecycleRemovalPlan(data, ajv, { now = Date.now() } = {}) {
  return validateOne(ajv, SCHEMA_IDS.lifecycleRemovalPlan, data, (d) => removalPlanProblems(d, { now }));
}

export function validateSupportBundlePolicy(data, ajv) {
  return validateOne(ajv, SCHEMA_IDS.supportBundlePolicy, data, (d) => supportPolicyProblems(d));
}

export function validateSupportBundle(data, ajv, { policy = null } = {}) {
  return validateOne(ajv, SCHEMA_IDS.supportBundle, data, (d) => supportBundleProblems(d, { policy }));
}

export function validateOfflinePackage(data, ajv, { components = [], routes = [] } = {}) {
  return validateOne(ajv, SCHEMA_IDS.offlinePackage, data, (d) => offlinePackageProblems(d, { components, routes }));
}
