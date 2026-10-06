/**
 * DKC-058 — semantiske validatorer for host-enrollment, host-profil og
 * host-operationer.
 *
 * JSON Schema håndhæver formen. Denne modul håndhæver beslutningerne: at
 * host-styring er slået fra som standard, at ikke-understøttede OS afvises, at
 * kun et navngivet menneske kan slå styring til, at operationen er lukket
 * (ingen arbitrær shell/uploadet script/usigneret pakke/brokerændring), at en
 * SSH-/firewallændring ikke kan lukke den eneste recoveryvej, og at en
 * operation ikke kan røre det separate sikkerhedsdomæne.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { buildAjv, validate, SCHEMA_IDS, repoRoot } from "./schemas.mjs";
import { enrollmentProblems, profileProblems, operationProblems, knownHostRunbooks, loadPlatforms } from "../../host-management/src/model.mjs";
import { securityDomainProblems, guardSecurityDomain, loadImmutablePolicy } from "../../host-management/src/security-domain.mjs";

function err(path, message) {
  return { path, message };
}

function schemaErrors(ajv, schemaId, data) {
  if (!schemaId) return [];
  const { ok, errors } = validate(ajv, schemaId, data);
  return ok ? [] : errors.map((e) => err(e.path || "/", e.message));
}

/* -------------------------------------------------------------------------- */
/* Host enrollment                                                            */
/* -------------------------------------------------------------------------- */

export function validateHostEnrollment(data, ajv, opts = {}) {
  const instance = ajv ?? buildAjv().ajv;
  const errors = [...schemaErrors(instance, SCHEMA_IDS.hostEnrollment, data)];
  if (errors.length === 0) {
    for (const p of enrollmentProblems(data, opts)) errors.push(err(p.path, p.message));
    const immutablePolicy = opts.immutablePolicy ?? loadImmutablePolicy(opts.root ?? repoRoot);
    for (const p of securityDomainProblems({ enrollment: data, immutablePolicy })) errors.push(err(p.path, p.message));
  }
  return { ok: errors.length === 0, errors };
}

export function validateHostEnrollmentDir(dir, opts = {}) {
  return validateDir(dir, "host-enrollment", SCHEMA_IDS.hostEnrollment, (data, instance) => validateHostEnrollment(data, instance, opts));
}

/* -------------------------------------------------------------------------- */
/* Host profile                                                               */
/* -------------------------------------------------------------------------- */

export function validateHostProfile(data, ajv, opts = {}) {
  const instance = ajv ?? buildAjv().ajv;
  const errors = [...schemaErrors(instance, SCHEMA_IDS.hostProfile, data)];
  if (errors.length === 0) for (const p of profileProblems(data, opts)) errors.push(err(p.path, p.message));
  return { ok: errors.length === 0, errors };
}

export function validateHostProfileDir(dir, opts = {}) {
  return validateDir(dir, "host-profile", SCHEMA_IDS.hostProfile, (data, instance) => validateHostProfile(data, instance, opts));
}

/* -------------------------------------------------------------------------- */
/* Host operation                                                             */
/* -------------------------------------------------------------------------- */

export function validateHostOperation(data, ajv, opts = {}) {
  const instance = ajv ?? buildAjv().ajv;
  const errors = [...schemaErrors(instance, SCHEMA_IDS.hostOperation, data)];
  if (errors.length === 0) {
    for (const p of operationProblems(data, opts)) errors.push(err(p.path, p.message));
    const enrollment = opts.enrollment ?? null;
    if (enrollment) {
      const guard = guardSecurityDomain({ operation: data, enrollment });
      for (const reason of guard.reasons) errors.push(err("/operation/target", reason));
    }
  }
  return { ok: errors.length === 0, errors };
}

export function validateHostOperationDir(dir, opts = {}) {
  return validateDir(dir, "host-operation", SCHEMA_IDS.hostOperation, (data, instance) => validateHostOperation(data, instance, opts));
}

/* -------------------------------------------------------------------------- */
/* Hjælpere                                                                   */
/* -------------------------------------------------------------------------- */

function validateDir(dir, prefix, schemaId, run) {
  const results = [];
  if (!dir || !existsSync(dir)) return results;
  const ajv = buildAjv().ajv;
  for (const file of readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith(".json")).sort()) {
    let data;
    try {
      data = JSON.parse(readFileSync(join(dir, file), "utf8"));
    } catch (e) {
      results.push({ file, ok: false, errors: [err("/", `ugyldig JSON: ${e.message}`)] });
      continue;
    }
    results.push({ file, ...run(data, ajv) });
  }
  return results;
}

export { knownHostRunbooks, loadPlatforms, loadImmutablePolicy };
