/**
 * DKC-052 — konformansvalidatorer for overtagelsesplanen og øvelsesrapporten.
 *
 * Skemaet håndhæver formen. Denne modul håndhæver beslutningerne: navngivne
 * mennesker i alle roller, en uafhængig kontaktkanal med en eskalationskæde
 * der ender hos et menneske, credentials under menneskekontrol, en prioriteret
 * restoreplan og en formelt valgt profil; samt en øvelse hvor menneskelige trin
 * aldrig automatisk bliver `pass`, og hvor agenten ikke kan godkende beredskab.
 */
import { buildAjv, validate, SCHEMA_IDS } from "./schemas.mjs";
import { recoveryDrillProblems, takeoverPlanProblems } from "../../continuity/src/takeover.mjs";

function err(path, message) {
  return { path, message };
}

export function validateTakeoverPlan(data, ajv) {
  const instance = ajv ?? buildAjv().ajv;
  const { ok, errors } = validate(instance, SCHEMA_IDS.takeoverPlan, data);
  const result = ok ? [] : errors.map((e) => err(e.path || "/", e.message));
  if (result.length === 0) result.push(...takeoverPlanProblems(data));
  return { ok: result.length === 0, errors: result };
}

export function validateRecoveryDrill(data, ajv) {
  const instance = ajv ?? buildAjv().ajv;
  const { ok, errors } = validate(instance, SCHEMA_IDS.recoveryDrill, data);
  const result = ok ? [] : errors.map((e) => err(e.path || "/", e.message));
  if (result.length === 0) result.push(...recoveryDrillProblems(data));
  return { ok: result.length === 0, errors: result };
}
