/**
 * DKC-051 — semantiske validatorer for fejl- og katastrofematrixen.
 *
 * Skemaet håndhæver formen. Denne modul håndhæver beslutningerne: et navngivet
 * menneske som ejer, de fem invarianter, mindst ti scenarier der dækker alle
 * kritiske failure scopes, og at en model ikke erklærer en målt øvelse.
 * Validatoren erstatter ikke en målt fejløvelse på en levende klynge.
 */
import { buildAjv, validate, SCHEMA_IDS } from "./schemas.mjs";
import { failureMatrixProblems } from "../../chaos/src/matrix.mjs";

function err(path, message) {
  return { path, message };
}

export function validateFailureMatrix(data, ajv) {
  const instance = ajv ?? buildAjv().ajv;
  const { ok, errors } = validate(instance, SCHEMA_IDS.failureMatrix, data);
  const result = ok ? [] : errors.map((e) => err(e.path || "/", e.message));
  if (result.length === 0) result.push(...failureMatrixProblems(data));
  return { ok: result.length === 0, errors: result };
}
