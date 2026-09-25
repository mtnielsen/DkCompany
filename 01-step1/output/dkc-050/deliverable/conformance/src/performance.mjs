/**
 * DKC-050 — semantiske validatorer for kapacitets- og skaleringsplanen.
 *
 * Skemaet håndhæver formen. Denne modul håndhæver beslutningerne: tre hosts i
 * tre fejldomæner med N+1, reproducerbare lastprofiler, autoskalering for
 * stateless og køworkers, runbookstyret skalering af stateful workloads,
 * tenantkvoter med fairness, connection pools og kontrolleret backpressure.
 * Validatoren erstatter ikke en målt lasttest.
 */
import { buildAjv, validate, SCHEMA_IDS } from "./schemas.mjs";
import { capacityPlanProblems } from "../../performance/src/model.mjs";

function err(path, message) {
  return { path, message };
}

export function validateCapacityPlan(data, ajv) {
  const instance = ajv ?? buildAjv().ajv;
  const { ok, errors } = validate(instance, SCHEMA_IDS.capacityPlan, data);
  const result = ok ? [] : errors.map((e) => err(e.path || "/", e.message));
  if (result.length === 0) result.push(...capacityPlanProblems(data));
  return { ok: result.length === 0, errors: result };
}
