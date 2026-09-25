/**
 * DKC-049 — semantiske validatorer for logposter, loggepolitik og logadgang.
 *
 * JSON Schema håndhæver formen; disse validatorer håndhæver beslutningerne:
 * provenance-klasserne må ikke blandes, en muterende handling skal bære en
 * holdbar kvittering, tenant og ressource skal stemme, hemmeligheder og skjult
 * modelræsonnering er forbudt, og politikken skal kræve WORM-arkiv i flere
 * fejldomæner for de beskyttede klasser. Validatorerne er rene funktioner.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildAjv, validate, SCHEMA_IDS } from "./schemas.mjs";
import { recordProblems } from "../../logging/src/record.mjs";
import { policyProblems } from "../../logging/src/policy.mjs";

function err(path, message) {
  return { path, message };
}

function fromAjv(errors, fallbackPath = "/") {
  return errors.map((e) => err(e.path || fallbackPath, e.message));
}

export function validateLogRecord(data, ajv, { policy = null } = {}) {
  const instance = ajv ?? buildAjv().ajv;
  const { ok, errors } = validate(instance, SCHEMA_IDS.logRecord, data);
  const problems = ok ? [] : fromAjv(errors);
  if (problems.length === 0) problems.push(...recordProblems(data, { policy }));
  return { ok: problems.length === 0, errors: problems };
}

export function validateLoggingPolicy(data, ajv) {
  const instance = ajv ?? buildAjv().ajv;
  const { ok, errors } = validate(instance, SCHEMA_IDS.loggingPolicy, data);
  const problems = ok ? [] : fromAjv(errors);
  if (problems.length === 0) problems.push(...policyProblems(data));
  return { ok: problems.length === 0, errors: problems };
}

export function validateLogAccessDecision(data, ajv) {
  const instance = ajv ?? buildAjv().ajv;
  const { ok, errors } = validate(instance, SCHEMA_IDS.logAccessDecision, data);
  const problems = ok ? [] : fromAjv(errors);
  if (problems.length === 0) {
    if (data.decision === "deny" && data.recordsReturned !== 0) {
      problems.push(err("/recordsReturned", "en nægtet logadgang må ikke returnere poster"));
    }
    if (data.decision === "allow" && !data.retentionClass) {
      problems.push(err("/retentionClass", "en tilladt logadgang skal angive retention-klassen for de læste poster"));
    }
  }
  return { ok: problems.length === 0, errors: problems };
}

function validateDir(dir, pattern, validator) {
  const results = [];
  if (!dir) return results;
  const ajv = buildAjv().ajv;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json") && pattern.test(f)).sort()) {
    let data;
    try {
      data = JSON.parse(readFileSync(join(dir, file), "utf8"));
    } catch (e) {
      results.push({ file, ok: false, errors: [err("/", `ugyldig JSON: ${e.message}`)] });
      continue;
    }
    const { ok, errors } = validator(data, ajv);
    results.push({ file, ok, errors });
  }
  return results;
}

export function validateLogRecordDir(dir, { pattern = /^log-record/ } = {}) {
  return validateDir(dir, pattern, validateLogRecord);
}

export function validateLoggingPolicyDir(dir, { pattern = /^logging-policy/ } = {}) {
  return validateDir(dir, pattern, validateLoggingPolicy);
}

export function validateLogAccessDecisionDir(dir, { pattern = /^log-access-decision/ } = {}) {
  return validateDir(dir, pattern, validateLogAccessDecision);
}
