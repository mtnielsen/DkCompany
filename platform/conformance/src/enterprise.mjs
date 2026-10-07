/**
 * DKC-036 — semantiske validatorer for enterprise- og branchepakker.
 *
 * Skemaet håndhæver formen. Denne modul håndhæver beslutningerne: at
 * kapabilitetsregisteret svarer til komponenterne, at de tre størrelsesprofiler
 * deler de samme sikkerhedskontrakter, at hver pakke har navngivne ejere og en
 * ærlig testkunde, og at den genererede rapport ikke erklærer en pakke
 * implementerbar på et uafklaret grundlag.
 */
import { buildAjv, validate, SCHEMA_IDS } from "./schemas.mjs";
import {
  capabilityCatalogProblems,
  packageCatalogProblems,
  reportProblems,
} from "../../enterprise/src/model.mjs";

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

export function validateEnterprisePackages(data, ajv, options = {}) {
  return validateOne(ajv, SCHEMA_IDS.enterprisePackage, data, (d) => packageCatalogProblems(d, options));
}

export function validateCapabilityCatalog(data, components = []) {
  const problems = capabilityCatalogProblems(data, components);
  return { ok: problems.length === 0, errors: problems };
}

export function validateEnterprisePackageReport(data) {
  const problems = reportProblems(data);
  return { ok: problems.length === 0, errors: problems };
}
