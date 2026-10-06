/**
 * DKC-041 — semantiske validatorer for lagerplanen.
 *
 * Skemaet håndhæver formen. Denne modul håndhæver beslutningerne: vedligeholdt
 * CSI-/objektlager med dokumenteret fejlmodel, tre hosts i tre fejldomæner,
 * synkront skrive-quorum uden usikre writes, versionsstyrede objekter med
 * checksums og scrub/repair, kundeafgrænsede nøgler, dataklassifikation uden
 * nødvendig tilstand på ephemeral disk og relokation med bevarede filer og
 * rettigheder. Validatoren erstatter ikke en målt fejlmodel på et levende lager.
 */
import { buildAjv, validate, SCHEMA_IDS } from "./schemas.mjs";
import { storagePlanProblems } from "../../storage/src/plan.mjs";

function err(path, message) {
  return { path, message };
}

export function validateStoragePlan(data, ajv) {
  const instance = ajv ?? buildAjv().ajv;
  const { ok, errors } = validate(instance, SCHEMA_IDS.storagePlan, data);
  const problems = ok ? [] : errors.map((e) => err(e.path || "/", e.message));
  if (problems.length === 0) problems.push(...storagePlanProblems(data));
  return { ok: problems.length === 0, errors: problems };
}
