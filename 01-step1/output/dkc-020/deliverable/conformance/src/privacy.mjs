/**
 * DKC-020 — semantiske validatorer for sikrede eksporter.
 *
 * Skemaet håndhæver formen. Denne modul håndhæver de beslutninger skemaet ikke
 * kan udtrykke:
 *
 *   - udløbet skal ligge efter oprettelsen,
 *   - en indløst/tilbagekaldt eksport skal bære tidspunktet for hændelsen,
 *   - en aktiv eksport må ikke allerede være indløst,
 *   - artefaktets digest skal være en rigtig SHA-256, og
 *   - modtager-bindingen skal være navngivet.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { buildAjv, validate, SCHEMA_IDS } from "./schemas.mjs";

function err(path, message) {
  return { path, message };
}

const SHA256 = /^[a-f0-9]{64}$/;

export function privacyExportProblems(data, { now = Date.now() } = {}) {
  const problems = [];
  if (!data || typeof data !== "object") return [err("/", "eksporten er ikke et objekt")];

  const created = Date.parse(data.createdAt);
  const expires = Date.parse(data.expiresAt);
  if (Number.isFinite(created) && Number.isFinite(expires) && expires <= created) {
    problems.push(err("/expiresAt", "udløbet skal ligge efter oprettelsen"));
  }
  if (data.status === "redeemed" && !data.redeemedAt) problems.push(err("/redeemedAt", "en indløst eksport skal have redeemedAt"));
  if (data.status === "revoked" && !data.revokedAt) problems.push(err("/revokedAt", "en tilbagekaldt eksport skal have revokedAt"));
  if (data.status === "active" && (data.redeemedAt || data.revokedAt)) {
    problems.push(err("/status", "en aktiv eksport må ikke være indløst eller tilbagekaldt"));
  }
  if (!data.recipient || !String(data.recipient).trim()) problems.push(err("/recipient", "modtager-bindingen mangler"));

  // En allerede udløbet aktiv eksport er ikke en fejl i dataene — men hvis
  // `now` er kendt, må en aktiv eksport ikke være ældre end sit udløb.
  if (data.status === "active" && Number.isFinite(expires) && Number.isFinite(now) && expires <= now) {
    problems.push(err("/expiresAt", "en aktiv eksport er udløbet og skulle være markeret expired"));
  }
  if (!SHA256.test(data.artifact?.sha256 ?? "")) problems.push(err("/artifact/sha256", "artefaktets digest er ikke en SHA-256"));
  return problems;
}

export function validatePrivacyExport(data, ajv, opts = {}) {
  const instance = ajv ?? buildAjv().ajv;
  const { ok, errors } = validate(instance, SCHEMA_IDS.privacyExport, data);
  const result = ok ? [] : errors.map((e) => err(e.path || "/", e.message));
  if (result.length === 0) result.push(...privacyExportProblems(data, opts));
  return { ok: result.length === 0, errors: result };
}

/** Læs alle `privacy-export*.example.json` fra en mappe og validér dem. */
export function validatePrivacyExportDir(dir, opts = {}) {
  const ajv = buildAjv().ajv;
  const results = [];
  if (!dir || !existsSync(dir)) return results;
  const files = readdirSync(dir).filter((f) => f.startsWith("privacy-export") && f.endsWith(".example.json")).sort();
  for (const file of files) {
    let data;
    try {
      data = JSON.parse(readFileSync(join(dir, file), "utf8"));
    } catch (e) {
      results.push({ file, ok: false, errors: [err("/", `ugyldig JSON: ${e.message}`)] });
      continue;
    }
    results.push({ file, ...validatePrivacyExport(data, ajv, { now: opts.now ?? Date.parse(data.createdAt) + 1000, ...opts }) });
  }
  return results;
}
