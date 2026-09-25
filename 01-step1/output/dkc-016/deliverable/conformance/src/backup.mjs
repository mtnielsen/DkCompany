/**
 * DKC-016 — semantiske validatorer for backup og gendannelse.
 *
 * Skemaet håndhæver formen. Denne modul håndhæver de beslutninger skemaet ikke
 * kan udtrykke:
 *
 *   - krypteringsnøglen skal være adskilt fra backup-lageret, og lageret må
 *     ikke indeholde nøglen,
 *   - der skal være en databasekomponent, entydige komponentnavne og en
 *     suppressionsjournal med et digest,
 *   - gendannelsen skal være isoleret, checksums verificeret og databasen intakt
 *     for at gaten kan passere,
 *   - en `pass`-gate må ikke bære afvigelser: RTO/RPO, funktionelle checks,
 *     tenant-afgrænsning, audit-kæden og suppressionsresultatet skal stemme,
 *   - en `blocked`-gate skal forklare sig med mindst én begrundelse.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { buildAjv, validate, SCHEMA_IDS } from "./schemas.mjs";

function err(path, message) {
  return { path, message };
}

const SHA256 = /^[a-f0-9]{64}$/;

export function backupManifestProblems(data) {
  const problems = [];
  if (!data || typeof data !== "object") return [err("/", "manifestet er ikke et objekt")];

  if (data.encryption?.keySeparated !== true) problems.push(err("/encryption/keySeparated", "krypteringsnøglen skal være adskilt fra backup-lageret"));
  if (data.encryption?.storeContainsKey !== false) problems.push(err("/encryption/storeContainsKey", "backup-lageret må ikke indeholde krypteringsnøglen"));
  if (data.encryption?.algorithm !== "aes-256-gcm") problems.push(err("/encryption/algorithm", "kun autentificeret kryptering (aes-256-gcm) er tilladt"));

  const components = Array.isArray(data.components) ? data.components : [];
  if (!components.some((c) => c.kind === "database")) problems.push(err("/components", "backupen skal indeholde en databasekomponent"));
  const names = new Set();
  for (const [i, c] of components.entries()) {
    if (names.has(c.name)) problems.push(err(`/components/${i}/name`, `dubleret komponentnavn '${c.name}'`));
    names.add(c.name);
    if (!SHA256.test(c.sha256 ?? "")) problems.push(err(`/components/${i}/sha256`, "komponentens digest er ikke en SHA-256"));
    if (!SHA256.test(c.ciphertextSha256 ?? "")) problems.push(err(`/components/${i}/ciphertextSha256`, "chiffertekst-digesten er ikke en SHA-256"));
  }

  const order = data.objectives?.restoreOrder ?? [];
  if (!order.includes("database")) problems.push(err("/objectives/restoreOrder", "gendannelsesrækkefølgen skal indeholde 'database'"));

  if (!data.suppression?.ledgerRef) problems.push(err("/suppression/ledgerRef", "suppressionsjournalen mangler en reference"));
  if (!SHA256.test(data.suppression?.ledgerDigest ?? "")) problems.push(err("/suppression/ledgerDigest", "suppressionsjournalens digest er ikke en SHA-256"));

  if (!Number.isFinite(data.objectives?.rpoTargetMinutes)) problems.push(err("/objectives/rpoTargetMinutes", "RPO-målet mangler"));
  if (!Number.isFinite(data.objectives?.rtoTargetMinutes)) problems.push(err("/objectives/rtoTargetMinutes", "RTO-målet mangler"));

  if (Number.isFinite(Date.parse(data.createdAt)) === false) problems.push(err("/createdAt", "oprettelsestidspunktet er ikke en dato"));
  return problems;
}

export function restoreDrillProblems(data) {
  const problems = [];
  if (!data || typeof data !== "object") return [err("/", "rapporten er ikke et objekt")];

  const started = Date.parse(data.startedAt);
  const finished = Date.parse(data.finishedAt);
  if (Number.isFinite(started) && Number.isFinite(finished) && finished < started) {
    problems.push(err("/finishedAt", "øvelsen kan ikke slutte før den starter"));
  }

  if (data.isolated !== true) problems.push(err("/isolated", "gendannelsen skal være gennemført i et isoleret miljø"));

  const m = data.measurements ?? {};
  const derivedRto = Number(m.restoreDurationMs) / 60000;
  if (Number.isFinite(derivedRto) && Math.abs(derivedRto - Number(m.measuredRtoMinutes)) > 0.002) {
    problems.push(err("/measurements/measuredRtoMinutes", "den målte RTO stemmer ikke med den målte varighed"));
  }
  if (Number(m.measuredRpoMinutes) !== Number(m.dataLossMinutes)) {
    problems.push(err("/measurements/measuredRpoMinutes", "det målte RPO skal være lig det målte datatab"));
  }

  const checks = Array.isArray(data.functionalChecks) ? data.functionalChecks : [];
  const failedChecks = checks.filter((c) => c.status !== "pass");
  const gatePass = data.gate?.status === "pass";
  const reasons = data.gate?.reasons ?? [];

  if (gatePass) {
    if (reasons.length) problems.push(err("/gate/reasons", "en 'pass'-gate må ikke have afvigelser"));
    if (data.integrity?.databaseOk !== true) problems.push(err("/integrity/databaseOk", "databasen skal være intakt for en 'pass'-gate"));
    if (data.integrity?.checksumsVerified !== true) problems.push(err("/integrity/checksumsVerified", "checksums skal være verificeret for en 'pass'-gate"));
    if (failedChecks.length) problems.push(err("/functionalChecks", `en 'pass'-gate kræver at alle funktionelle checks består (fejlede: ${failedChecks.map((c) => c.name).join(", ")})`));
    if (data.suppression?.applied !== true) problems.push(err("/suppression/applied", "suppressionsjournalen skal være anvendt for en 'pass'-gate"));
    if (data.tenantIsolation?.ok !== true) problems.push(err("/tenantIsolation/ok", "tenant-afgrænsningen skal være bekræftet for en 'pass'-gate"));
    if (data.audit?.chainOk !== true) problems.push(err("/audit/chainOk", "audit-kæden skal være intakt for en 'pass'-gate"));
    if (data.audit?.checkpointOk === false) problems.push(err("/audit/checkpointOk", "et brudt checkpoint må ikke give en 'pass'-gate"));
    if (Number(m.measuredRtoMinutes) > Number(m.rtoTargetMinutes)) problems.push(err("/measurements/measuredRtoMinutes", "målt RTO overstiger målet og må ikke give 'pass'"));
    if (Number(m.dataLossMinutes) > Number(m.rpoTargetMinutes)) problems.push(err("/measurements/dataLossMinutes", "målt datatab overstiger RPO-målet og må ikke give 'pass'"));
  } else {
    if (reasons.length === 0) problems.push(err("/gate/reasons", "en 'blocked'-gate skal forklare hvorfor"));
  }
  return problems;
}

export function validateBackupManifest(data, ajv) {
  const instance = ajv ?? buildAjv().ajv;
  const { ok, errors } = validate(instance, SCHEMA_IDS.backupManifest, data);
  const result = ok ? [] : errors.map((e) => err(e.path || "/", e.message));
  if (result.length === 0) result.push(...backupManifestProblems(data));
  return { ok: result.length === 0, errors: result };
}

export function validateRestoreDrill(data, ajv) {
  const instance = ajv ?? buildAjv().ajv;
  const { ok, errors } = validate(instance, SCHEMA_IDS.restoreDrill, data);
  const result = ok ? [] : errors.map((e) => err(e.path || "/", e.message));
  if (result.length === 0) result.push(...restoreDrillProblems(data));
  return { ok: result.length === 0, errors: result };
}

function readDir(dir) {
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir).sort();
}

export function validateBackupManifestDir(dir, ajv) {
  const instance = ajv ?? buildAjv().ajv;
  const results = [];
  for (const file of readDir(dir).filter((f) => f.startsWith("backup-manifest") && f.endsWith(".example.json"))) {
    try {
      results.push({ file, ...validateBackupManifest(JSON.parse(readFileSync(join(dir, file), "utf8")), instance) });
    } catch (e) {
      results.push({ file, ok: false, errors: [err("/", `ugyldig JSON: ${e.message}`)] });
    }
  }
  return results;
}

export function validateRestoreDrillDir(dir, ajv) {
  const instance = ajv ?? buildAjv().ajv;
  const results = [];
  for (const file of readDir(dir).filter((f) => f.startsWith("restore-drill") && f.endsWith(".example.json"))) {
    try {
      results.push({ file, ...validateRestoreDrill(JSON.parse(readFileSync(join(dir, file), "utf8")), instance) });
    } catch (e) {
      results.push({ file, ok: false, errors: [err("/", `ugyldig JSON: ${e.message}`)] });
    }
  }
  return results;
}
