/**
 * DKC-039 — semantiske validatorer for database-HA-planen.
 *
 * Skemaet håndhæver formen. Denne modul håndhæver beslutningerne: vedligeholdt
 * operator, tre quorum-instanser i adskilte fejldomæner, sync-replikering uden
 * tavs async-overgang, fencing før promotion, read-consistency pr. flow (hvor
 * godkendelser kun må læses fra primary), WAL-arkivering med PITR og en
 * fence-krævende failback/rejoin. Validatoren erstatter ikke en målt failover.
 */
import { buildAjv, validate, SCHEMA_IDS } from "./schemas.mjs";
import { databaseHAPlanProblems } from "../../persistence/src/ha.mjs";

function err(path, message) {
  return { path, message };
}

export function validateDatabaseHA(data, ajv) {
  const instance = ajv ?? buildAjv().ajv;
  const { ok, errors } = validate(instance, SCHEMA_IDS.databaseHA, data);
  const problems = ok ? [] : errors.map((e) => err(e.path || "/", e.message));
  if (problems.length === 0) problems.push(...databaseHAPlanProblems(data));
  return { ok: problems.length === 0, errors: problems };
}
