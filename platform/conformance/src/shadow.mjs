/**
 * DKC-032 — konformansvalidatorer for autonomibevilling og skyggekørsel.
 *
 * Skemaet håndhæver formen. Denne modul håndhæver beslutningerne: et navngivet
 * menneske som ejer, gentaget evaluering på et bundet model-/promptfingeraftryk,
 * staging-only og reversibilitet for begrænset autonomi, og at en skyggekørsel
 * ikke har udført en eneste mutation. Validatoren erstatter ikke en målt kørsel
 * mod en levende model og stagingklynge.
 */
import { buildAjv, validate, SCHEMA_IDS } from "./schemas.mjs";
import { autonomyPolicyProblems, shadowRunProblems } from "../../shadow/src/policy.mjs";

function err(path, message) {
  return { path, message };
}

export function validateAutonomyGrant(data, ajv) {
  const instance = ajv ?? buildAjv().ajv;
  const { ok, errors } = validate(instance, SCHEMA_IDS.autonomyGrant, data);
  const result = ok ? [] : errors.map((e) => err(e.path || "/", e.message));
  if (result.length === 0) result.push(...autonomyPolicyProblems(data));
  return { ok: result.length === 0, errors: result };
}

export function validateShadowRun(data, ajv) {
  const instance = ajv ?? buildAjv().ajv;
  const { ok, errors } = validate(instance, SCHEMA_IDS.shadowRun, data);
  const result = ok ? [] : errors.map((e) => err(e.path || "/", e.message));
  if (result.length === 0) result.push(...shadowRunProblems(data));
  return { ok: result.length === 0, errors: result };
}
