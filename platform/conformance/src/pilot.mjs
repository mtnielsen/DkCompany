/**
 * DKC-033 — semantiske validatorer for pilotforløb og readiness.
 *
 * Skemaet håndhæver formen. Disse validatorer håndhæver beslutningerne: tre
 * repræsentative virksomhedsprofiler, der hver gennemfører de seks kritiske
 * arbejdsgange, en readiness-politik med de krævede gates og en rapport hvor
 * `ready` kun kan opstå når hver aktiv, obligatorisk gate er bestået.
 */
import { buildAjv, validate, SCHEMA_IDS } from "./schemas.mjs";
import {
  pilotProfileProblems,
  pilotScenarioProblems,
  readinessPolicyProblems,
  observationProblems,
  customerAcceptanceProblems,
  readinessReportProblems,
} from "../../pilot/src/model.mjs";

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

export function validatePilotProfiles(data, ajv, { deploymentProfiles = [], semantic = true } = {}) {
  if (!semantic) return validateSchemaOnly(ajv, SCHEMA_IDS.pilotBusinessProfile, data);
  return validateOne(ajv, SCHEMA_IDS.pilotBusinessProfile, data, (d) => pilotProfileProblems(d, { deploymentProfiles }));
}

export function validatePilotScenarios(data, ajv, { profiles = [], semantic = true } = {}) {
  if (!semantic) return validateSchemaOnly(ajv, SCHEMA_IDS.pilotScenario, data);
  return validateOne(ajv, SCHEMA_IDS.pilotScenario, data, (d) => pilotScenarioProblems(d, { profiles }));
}

export function validateReadinessPolicy(data, ajv, { registry = [], requirementIds = [], semantic = true } = {}) {
  if (!semantic) return validateSchemaOnly(ajv, SCHEMA_IDS.readinessPolicy, data);
  return validateOne(ajv, SCHEMA_IDS.readinessPolicy, data, (d) => readinessPolicyProblems(d, { registry, requirementIds }));
}

export function validatePilotReadiness(data, ajv, { semantic = true } = {}) {
  if (!semantic) return validateSchemaOnly(ajv, SCHEMA_IDS.pilotReadiness, data);
  return validateOne(ajv, SCHEMA_IDS.pilotReadiness, data, (d) => readinessReportProblems(d));
}

export { observationProblems, customerAcceptanceProblems };
