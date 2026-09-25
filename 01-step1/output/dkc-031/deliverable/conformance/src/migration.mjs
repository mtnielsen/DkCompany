/**
 * DKC-031 — semantiske validatorer for migrations- og exitværktøjer.
 *
 * Skemaet håndhæver formen. Denne modul håndhæver beslutningerne: ét valgt,
 * dokumenteret kildeformat pr. pilotapp, en fuld dækningsmatrix hvor tabt
 * funktionalitet har en forklaring, en dry-run/import der afstemmer antal og
 * checksums, en selvbeskrivende exit-eksport og en pilotgodkendelse fra et
 * navngivet menneske af både indhold og adgangsrettigheder.
 */
import { buildAjv, validate, SCHEMA_IDS } from "./schemas.mjs";
import {
  migrationSourceProblems,
  migrationPolicyProblems,
  migrationCoverageProblems,
  migrationReconciliationProblems,
  migrationExportProblems,
  migrationApprovalProblems,
} from "../../migration/src/model.mjs";

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

export function validateMigrationSource(data, ajv, options = {}) {
  return validateOne(ajv, SCHEMA_IDS.migrationSource, data, (d) => migrationSourceProblems(d, options));
}

export function validateMigrationCoverage(data, ajv, { sources = [] } = {}) {
  return validateOne(ajv, SCHEMA_IDS.migrationCoverage, data, (d) => migrationCoverageProblems(d, { sources }));
}

export function validateMigrationReconciliation(data, ajv) {
  return validateOne(ajv, SCHEMA_IDS.migrationReconciliation, data, (d) => migrationReconciliationProblems(d));
}

export function validateMigrationExport(data, ajv) {
  return validateOne(ajv, SCHEMA_IDS.migrationExport, data, (d) => migrationExportProblems(d));
}

export function validateMigrationApproval(data, ajv, options = {}) {
  return validateOne(ajv, SCHEMA_IDS.migrationApproval, data, (d) => migrationApprovalProblems(d, options));
}

export function validateMigrationPolicy(data) {
  // Politikken har ingen egen kontrakt; den semantiske kontrol står alene.
  const problems = migrationPolicyProblems(data);
  return { ok: problems.length === 0, errors: problems };
}
