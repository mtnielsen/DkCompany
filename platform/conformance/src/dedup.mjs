/**
 * DKC-043 — semantiske validatorer for dedup-politik og dedup-receipts.
 *
 * Skemaet håndhæver formen; denne modul forbinder den med beslutningerne i
 * `dedup/src/`:
 *
 *   - politikken (fire separate domæner, tenant-/krypteringsdomæne-/
 *     retentiongrænse, ingen tværkundededuplikering, backupblokke som
 *     gennemprøvet design, primær dedup valgfrit med egen validering,
 *     jobhændelser kun på idempotency-nøgle, forretningsposter aldrig flettet),
 *   - receiptet (målt logisk/fysisk størrelse, referencekæde, integritets- og
 *     restore-resultat og en besparelsesgate der ikke kan være aktiv uden
 *     bestået kontrol).
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { buildAjv, validate, SCHEMA_IDS } from "./schemas.mjs";
import { dedupPolicyProblems } from "../../dedup/src/policy.mjs";

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

export function validateDedupPolicy(data, ajv) {
  return withSchema(SCHEMA_IDS.dedupPolicy, data, ajv, dedupPolicyProblems);
}

/** Et receipt må ikke hævde en aktiv besparelse uden bestået integritet og restore. */
export function dedupReceiptProblems(data) {
  const problems = [];
  if (!data || typeof data !== "object") return [err("/", "receipt mangler")];
  const integrityOk = data.integrity?.ok === true;
  const restoreOk = data.restore?.ok === true;
  if (data.savingsActive === true && !(integrityOk && restoreOk)) {
    problems.push(err("/savingsActive", "besparelsen må kun være aktiv når både integritet og restore bestod"));
  }
  if (data.savingsActive === true && (data.integrity?.corruptions?.length ?? 0) > 0) {
    problems.push(err("/integrity/corruptions", "et receipt med korruptioner må ikke aktivere en besparelse"));
  }
  if (data.savingsActive === true && data.savedBytes <= 0) {
    problems.push(err("/savedBytes", "en aktiv besparelse skal vise en positiv besparelse"));
  }
  if (data.physicalBytes > data.logicalBytes) {
    problems.push(err("/physicalBytes", "fysiske bytes kan ikke overstige logiske bytes"));
  }
  const failedRestores = (data.restore?.snapshots ?? []).filter((s) => s.ok !== true);
  if (data.restore?.ok === true && failedRestores.length > 0) {
    problems.push(err("/restore/snapshots", "restore kan ikke være ok når et snapshot fejlede"));
  }
  return problems;
}

export function validateDedupReceipt(data, ajv) {
  return withSchema(SCHEMA_IDS.dedupReceipt, data, ajv, dedupReceiptProblems);
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

export function validateDedupPolicyDir(dir, ajv) {
  return validateDir(dir, "dedup-policy", validateDedupPolicy, ajv);
}

export function validateDedupReceiptDir(dir, ajv) {
  return validateDir(dir, "dedup-receipt", validateDedupReceipt, ajv);
}
