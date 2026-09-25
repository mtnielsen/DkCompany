/**
 * DKC-062 — semantiske validatorer for installations- og releaseacceptance.
 *
 * Skemaet håndhæver formen. Disse validatorer håndhæver beslutningerne:
 * kørebare brugerrejser bundet til en understøttet profil/platform, en
 * profilbevidst gate-politik med fælles og særskilte gates, et komplet
 * RACI-register og et acceptresultat hvor 'accepted' kræver både gyldigt
 * testbevis og registreret menneskelig ejeraccept.
 */
import { buildAjv, validate, SCHEMA_IDS } from "./schemas.mjs";
import {
  acceptanceScenarioProblems,
  acceptancePolicyProblems,
  raciProblems,
  ownerAcceptanceProblems,
  acceptanceResultProblems,
} from "../../distribution/src/acceptance-model.mjs";

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

function validateSchemaOnly(ajv, schemaId, data) {
  const instance = ajv ?? buildAjv().ajv;
  const { ok, errors } = validate(instance, schemaId, data);
  return { ok, errors: ok ? [] : errors.map((e) => err(e.path || "/", e.message)) };
}

export function validateAcceptanceScenarioSet(data, ajv, { profiles = [], platforms = [], semantic = true } = {}) {
  if (!semantic) return validateSchemaOnly(ajv, SCHEMA_IDS.acceptanceScenario, data);
  return validateOne(ajv, SCHEMA_IDS.acceptanceScenario, data, (d) => acceptanceScenarioProblems(d, { profiles, platforms }));
}

export function validateAcceptanceGatePolicy(data, ajv, { registry = [], components = [], semantic = true } = {}) {
  if (!semantic) return validateSchemaOnly(ajv, SCHEMA_IDS.acceptanceGatePolicy, data);
  return validateOne(ajv, SCHEMA_IDS.acceptanceGatePolicy, data, (d) => acceptancePolicyProblems(d, { registry, components }));
}

export function validateAcceptanceResult(data, ajv, { semantic = true } = {}) {
  if (!semantic) return validateSchemaOnly(ajv, SCHEMA_IDS.acceptanceResult, data);
  return validateOne(ajv, SCHEMA_IDS.acceptanceResult, data, (d) => acceptanceResultProblems(d));
}

export function validateRaciRegistry(data, ajv, { services = [], dataClasses = undefined, controlProcesses = [], semantic = true } = {}) {
  if (!semantic) return validateSchemaOnly(ajv, SCHEMA_IDS.raciRegistry, data);
  const opts = dataClasses ? { services, dataClasses, controlProcesses } : { services, controlProcesses };
  return validateOne(ajv, SCHEMA_IDS.raciRegistry, data, (d) => raciProblems(d, opts));
}

export { ownerAcceptanceProblems };
