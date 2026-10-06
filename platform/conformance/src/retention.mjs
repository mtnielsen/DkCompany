/**
 * DKC-021 — semantiske validatorer for slettepolitik, hold og kvitteringer.
 *
 * JSON Schema håndhæver formen; disse validatorer håndhæver beslutningerne:
 * hold kræver begrundelse og en separat godkender, en kvittering må ikke påstå
 * fuld når ikke alle flader kan slette, en partial/unsupported flade skal have
 * en begrundelse, resterende kopier skal have et udløb, og revisionssporet må
 * kun bære subjektets digest. Validatorerne er rene funktioner.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildAjv, validate, SCHEMA_IDS } from "./schemas.mjs";
import { deletionPolicyProblems } from "../../retention/src/policy.mjs";
import { legalHoldProblems } from "../../retention/src/holds.mjs";
import { assertRedacted } from "../../retention/src/audit.mjs";

function err(path, message) {
  return { path, message };
}

export function validateDeletionPolicy(data, ajv) {
  const instance = ajv ?? buildAjv().ajv;
  const { ok, errors } = validate(instance, SCHEMA_IDS.retentionDeletionPolicy, data);
  const problems = ok ? [] : errors.map((e) => err(e.path || "/", e.message));
  if (problems.length === 0) problems.push(...deletionPolicyProblems(data).map((p) => err(p.path, p.message)));
  return { ok: problems.length === 0, errors: problems };
}

export function validateLegalHold(data, ajv) {
  const instance = ajv ?? buildAjv().ajv;
  const { ok, errors } = validate(instance, SCHEMA_IDS.legalHold, data);
  const problems = ok ? [] : errors.map((e) => err(e.path || "/", e.message));
  if (problems.length === 0) problems.push(...legalHoldProblems(data).map((p) => err(p.path, p.message)));
  return { ok: problems.length === 0, errors: problems };
}

function receiptProblems(receipt) {
  const problems = [];
  if (receipt.status === "blocked-by-hold") {
    if (receipt.hold?.blocked !== true) problems.push(err("/hold/blocked", "en 'blocked-by-hold'-kvittering skal markere holdet som blokerende"));
    if ((receipt.summary?.recordsAffected ?? 0) !== 0) problems.push(err("/summary/recordsAffected", "et blokeret hold må ikke have slettet noget"));
  }
  for (const [i, result] of (receipt.results ?? []).entries()) {
    const base = `/results/${i}`;
    if (result.status === "partial" || result.status === "unsupported" || result.status === "failed") {
      if (!(result.reason ?? "").trim()) problems.push(err(`${base}/reason`, `en '${result.status}'-flade skal have en præcis begrundelse`));
    }
    if (result.status === "partial" && !(result.remainingCopies ?? []).length) {
      problems.push(err(`${base}/remainingCopies`, "en 'partial'-flade skal opgive mindst én resterende kopi med begrundelse og udløb"));
    }
    for (const [j, copy] of (result.remainingCopies ?? []).entries()) {
      if (!(copy.reason ?? "").trim()) problems.push(err(`${base}/remainingCopies/${j}/reason`, "en resterende kopi skal have en begrundelse"));
      if (Number.isNaN(Date.parse(copy.expiresAt ?? ""))) problems.push(err(`${base}/remainingCopies/${j}/expiresAt`, "en resterende kopi skal have et gyldigt forventet udløb"));
    }
  }
  const summary = receipt.summary ?? {};
  const countBy = (status) => (receipt.results ?? []).filter((r) => r.status === status).length;
  if (summary.full !== countBy("full")) problems.push(err("/summary/full", "summary.full stemmer ikke med resultaterne"));
  if (summary.partial !== countBy("partial")) problems.push(err("/summary/partial", "summary.partial stemmer ikke med resultaterne"));
  if (summary.unsupported !== countBy("unsupported")) problems.push(err("/summary/unsupported", "summary.unsupported stemmer ikke med resultaterne"));
  if (summary.surfaces !== (receipt.results ?? []).length) problems.push(err("/summary/surfaces", "summary.surfaces stemmer ikke med resultaterne"));
  if (receipt.audit?.subjectDigest !== receipt.subjectDigest) problems.push(err("/audit/subjectDigest", "revisionssporet skal pege på samme subjekt-digest"));
  for (const p of assertRedacted(receipt)) problems.push(err("/", p));
  return problems;
}

export function validateDeletionReceipt(data, ajv) {
  const instance = ajv ?? buildAjv().ajv;
  const { ok, errors } = validate(instance, SCHEMA_IDS.deletionReceipt, data);
  const problems = ok ? [] : errors.map((e) => err(e.path || "/", e.message));
  if (problems.length === 0) problems.push(...receiptProblems(data));
  return { ok: problems.length === 0, errors: problems };
}

export function validateDeletionPolicyDir(dir, { pattern = /^retention-deletion-policy/ } = {}) {
  return validateDir(dir, pattern, validateDeletionPolicy);
}

export function validateLegalHoldDir(dir, { pattern = /^legal-hold/ } = {}) {
  return validateDir(dir, pattern, validateLegalHold);
}

export function validateDeletionReceiptDir(dir, { pattern = /^deletion-receipt/ } = {}) {
  return validateDir(dir, pattern, validateDeletionReceipt);
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
