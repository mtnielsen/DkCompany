/**
 * DKC-048 — semantiske validatorer for håndhævelsen af immutable data.
 *
 * Skemaet håndhæver formen. Denne modul håndhæver beslutningerne: et
 * verificeret storage-produkt med object-lock i GOVERNANCE og COMPLIANCE, en
 * rollematrix hvor AI/app-konti er nægtet alle muterende operationer og
 * indirekte adminveje, append-only audit-ingest, beskyttede KMS-/backup-/
 * serviceaccount-/trust-ressourcer og to-personers kontrol. Validatoren
 * erstatter ikke en målt verifikation på et levende storage-produkt.
 */
import { buildAjv, validate, SCHEMA_IDS } from "./schemas.mjs";
import { immutablePolicyProblems } from "../../data-protection/src/enforcement.mjs";

function err(path, message) {
  return { path, message };
}

export function validateImmutableEnforcement(data, ajv) {
  const instance = ajv ?? buildAjv().ajv;
  const { ok, errors } = validate(instance, SCHEMA_IDS.immutableEnforcement, data);
  const problems = ok ? [] : errors.map((e) => err(e.path || "/", e.message));
  if (problems.length === 0) problems.push(...immutablePolicyProblems(data).map((p) => err(p.path, p.message)));
  return { ok: problems.length === 0, errors: problems };
}
