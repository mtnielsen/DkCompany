/**
 * DKC-042 — semantiske validatorer for katastrofegendannelse.
 *
 * Skemaet håndfører formen; denne modul forbinder det med beslutningerne i
 * `backup/src/dr/`:
 *
 *   - DR-planen (3-2-1-1-0, PITR, separat recovery-identitet, isoleret miljø,
 *     kendt rent restorepunkt, slettejournal, failback og det samlede
 *     brugerflows RPO/RTO),
 *   - recovery-adgangsprofilen (adskilt identitet, to-personers, nøgle-/
 *     konfigurations-/katalog-/image-adskillelse),
 *   - PITR-afstemningen (valgt tidspunkt ramt, data og ACL stemmer),
 *   - øvelsesrapporten (primærklynge nede, isoleret miljø, IAM/DNS/secret-store
 *     genoprettet, slettejournal anvendt og målt brugerflow).
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { buildAjv, validate, SCHEMA_IDS } from "./schemas.mjs";
import { disasterRecoveryPlanProblems } from "../../backup/src/dr/plan.mjs";
import { recoveryAccessProblems } from "../../backup/src/dr/access.mjs";
import { pitrReconciliationProblems } from "../../backup/src/dr/pitr.mjs";
import { disasterRecoveryDrillProblems } from "../../backup/src/dr/drill.mjs";

function err(path, message) {
  return { path, message };
}

function readDir(dir) {
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir).sort();
}

function withSchema(schemaId, data, ajv, semantic) {
  const instance = ajv ?? buildAjv().ajv;
  const { ok, errors } = validate(instance, schemaId, data);
  const problems = ok ? [] : errors.map((e) => err(e.path || "/", e.message));
  if (problems.length === 0) problems.push(...semantic(data));
  return { ok: problems.length === 0, errors: problems };
}

export function validateDisasterRecoveryPlan(data, ajv, options = {}) {
  return withSchema(SCHEMA_IDS.disasterRecoveryPlan, data, ajv, (d) => disasterRecoveryPlanProblems(d, options));
}

export function validateRecoveryAccessProfile(data, ajv) {
  return withSchema(SCHEMA_IDS.recoveryAccessProfile, data, ajv, recoveryAccessProblems);
}

export function validatePitrReconciliation(data, ajv) {
  return withSchema(SCHEMA_IDS.pitrReconciliation, data, ajv, pitrReconciliationProblems);
}

export function validateDisasterRecoveryDrill(data, ajv) {
  return withSchema(SCHEMA_IDS.disasterRecoveryDrill, data, ajv, disasterRecoveryDrillProblems);
}

function validateDir(dir, prefix, validator, ajv) {
  const instance = ajv ?? buildAjv().ajv;
  const results = [];
  for (const file of readDir(dir).filter((f) => f.startsWith(prefix) && f.endsWith(".example.json"))) {
    try {
      results.push({ file, ...validator(JSON.parse(readFileSync(join(dir, file), "utf8")), instance) });
    } catch (e) {
      results.push({ file, ok: false, errors: [err("/", `ugyldig JSON: ${e.message}`)] });
    }
  }
  return results;
}

export function validateDisasterRecoveryPlanDir(dir, ajv) {
  return validateDir(dir, "disaster-recovery-plan", validateDisasterRecoveryPlan, ajv);
}

export function validateRecoveryAccessProfileDir(dir, ajv) {
  return validateDir(dir, "recovery-access-profile", validateRecoveryAccessProfile, ajv);
}

export function validatePitrReconciliationDir(dir, ajv) {
  return validateDir(dir, "pitr-reconciliation", validatePitrReconciliation, ajv);
}

export function validateDisasterRecoveryDrillDir(dir, ajv) {
  return validateDir(dir, "disaster-recovery-drill", validateDisasterRecoveryDrill, ajv);
}
