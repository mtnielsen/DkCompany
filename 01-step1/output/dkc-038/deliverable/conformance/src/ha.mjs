/**
 * DKC-038 — semantiske validatorer for HA-klyngen.
 *
 * Skemaet håndhæver formen. Denne modul håndhæver beslutningerne: tre
 * quorum-medlemmer i adskilte fejldomæner, N+1, redundant ingress/DNS, mTLS og
 * rotation, default-deny, samt at stateless/stateful workloads har de krævede
 * HA-felter. Validatoren erstatter ikke en målt failover.
 */
import { buildAjv, validate, SCHEMA_IDS } from "./schemas.mjs";
import { haClusterProblems } from "../../infrastructure/src/ha.mjs";

function err(path, message) {
  return { path, message };
}

export function validateHACluster(data, ajv) {
  const instance = ajv ?? buildAjv().ajv;
  const { ok, errors } = validate(instance, SCHEMA_IDS.haCluster, data);
  const result = ok ? [] : errors.map((e) => err(e.path || "/", e.message));
  if (result.length === 0) result.push(...haClusterProblems(data));
  return { ok: result.length === 0, errors: result };
}
