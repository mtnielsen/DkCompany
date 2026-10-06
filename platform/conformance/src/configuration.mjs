/**
 * DKC-054 — semantiske validatorer for konfiguration, host-scope, installer og
 * retentionændringer.
 *
 * JSON Schema håndhæver formen. Denne modul håndhæver beslutningerne: sikre
 * standarder, uforanderligt revisionsspor, WORM/holds i retention, ét scope pr.
 * installation, forbud mod diskformatering/databaseovertagelse/host-OS-ændring,
 * og gyldige signerede installationsplaner.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { buildAjv, validate, SCHEMA_IDS } from "./schemas.mjs";
import { configurationProblems, configurationContentDigest, loadLoggingPolicy, loadGatewayRoutes, effectiveSettings } from "../../configuration/src/model.mjs";
import { installerPlanProblems } from "../../installer/src/plan.mjs";
import { retentionPreviewProblems } from "../../configuration/src/retention-change.mjs";
import { hostSupported } from "../../installer/src/preflight.mjs";

function err(path, message) {
  return { path, message };
}

function schemaErrors(ajv, schemaId, data) {
  if (!schemaId) return [];
  const { ok, errors } = validate(ajv, schemaId, data);
  return ok ? [] : errors.map((e) => err(e.path || "/", e.message));
}

/* -------------------------------------------------------------------------- */
/* Platform configuration                                                     */
/* -------------------------------------------------------------------------- */

export function validatePlatformConfiguration(data, ajv, opts = {}) {
  const instance = ajv ?? buildAjv().ajv;
  const errors = [...schemaErrors(instance, SCHEMA_IDS.platformConfiguration, data)];
  if (errors.length === 0) {
    for (const p of configurationProblems(data, opts)) errors.push(err(p.path, p.message));
    // Autorisationen skal være bundet til dokumentets indhold.
    const digest = data?.authorization?.decisionDigest;
    if (digest && digest !== configurationContentDigest(data)) {
      errors.push(err("/authorization/decisionDigest", "autorisationens digest matcher ikke konfigurationsindholdet"));
    }
  }
  return { ok: errors.length === 0, errors };
}

export function validateConfigurationDir(dir, opts = {}) {
  return validateDir(dir, "platform-configuration", SCHEMA_IDS.platformConfiguration, (data, instance) => validatePlatformConfiguration(data, instance, opts));
}

/* -------------------------------------------------------------------------- */
/* Host scope                                                                 */
/* -------------------------------------------------------------------------- */

export function hostScopeProblems(scope, { platforms = null } = {}) {
  const problems = [];
  const at = (path, message) => problems.push(err(path, message));

  if (!/^[a-z][a-z0-9-]*\|/.test(scope?.ownership?.ownerSubject ?? "")) at("/ownership/ownerSubject", "hosten skal have en navngiven menneskelig ejer");
  if (scope?.privileges?.noRootForAgents !== true) at("/privileges/noRootForAgents", "agenter må ikke have fri root");
  if (scope?.privileges?.executorRole !== "executor") at("/privileges/executorRole", "executorrollen skal være 'executor'");
  if (scope?.diskPolicy?.formatAllowed !== false) at("/diskPolicy/formatAllowed", "diskformatering er ikke tilladt");
  if (scope?.diskPolicy?.existingDataPreserved !== true) at("/diskPolicy/existingDataPreserved", "eksisterende data skal bevares");
  if (scope?.databasePolicy?.adoptExistingSchema !== false) at("/databasePolicy/adoptExistingSchema", "eksisterende databaseskema må ikke overtages");
  if (scope?.hostChangePolicy?.osUpgradeAllowed === true && scope?.hostChangePolicy?.allowedWithExplicitScope !== true) {
    at("/hostChangePolicy", "host-OS-ændring kræver et konkret oplyst scope");
  }

  const allowed = new Set(scope?.allowedOperations ?? []);
  const forbidden = scope?.forbiddenOperations ?? [];
  for (const op of forbidden) if (allowed.has(op)) at("/forbiddenOperations", `den forbudte operation '${op}' er også tilladt`);
  for (const required of ["format-disk", "take-over-database-schema", "change-host-os", "arbitrary-shell", "upload-script", "unsigned-package", "modify-broker-policy", "modify-package-source", "modify-payload"]) {
    if (!forbidden.includes(required)) at("/forbiddenOperations", `det obligatoriske forbud '${required}' mangler`);
  }

  if (scope?.os?.supportTier === "unsupported") at("/os/supportTier", "ikke-understøttede OS-versioner skal afvises");
  if (platforms) {
    const supported = hostSupported(scope, platforms);
    if (!supported.ok) for (const p of supported.problems) at("/os", p);
  }

  if (!/^[a-z][a-z0-9-]*\|/.test(scope?.authorization?.humanSubject ?? "")) at("/authorization/humanSubject", "scopet skal autoriseres af et navngivet menneske");
  return problems;
}

export function validateHostScope(data, ajv, opts = {}) {
  const instance = ajv ?? buildAjv().ajv;
  const errors = [...schemaErrors(instance, SCHEMA_IDS.hostScope, data)];
  if (errors.length === 0) for (const p of hostScopeProblems(data, opts)) errors.push(p);
  return { ok: errors.length === 0, errors };
}

export function validateHostScopeDir(dir, opts = {}) {
  return validateDir(dir, "host-scope", SCHEMA_IDS.hostScope, (data, instance) => validateHostScope(data, instance, opts));
}

/* -------------------------------------------------------------------------- */
/* Installer plan                                                             */
/* -------------------------------------------------------------------------- */

export function validateInstallerPlan(data, ajv, opts = {}) {
  const instance = ajv ?? buildAjv().ajv;
  const errors = [...schemaErrors(instance, SCHEMA_IDS.installerPlan, data)];
  if (errors.length === 0) for (const p of installerPlanProblems(data, opts)) errors.push(p);
  return { ok: errors.length === 0, errors };
}

export function validateInstallerPlanDir(dir, opts = {}) {
  return validateDir(dir, "installer-plan", SCHEMA_IDS.installerPlan, (data, instance) => validateInstallerPlan(data, instance, opts));
}

/* -------------------------------------------------------------------------- */
/* Retention change preview                                                   */
/* -------------------------------------------------------------------------- */

export function validateRetentionChangePreview(data, ajv, opts = {}) {
  const instance = ajv ?? buildAjv().ajv;
  const errors = [...schemaErrors(instance, SCHEMA_IDS.retentionChangePreview, data)];
  if (errors.length === 0) for (const p of retentionPreviewProblems(data, opts)) errors.push(err(p.path, p.message));
  return { ok: errors.length === 0, errors };
}

export function validateRetentionChangePreviewDir(dir, opts = {}) {
  return validateDir(dir, "retention-change-preview", SCHEMA_IDS.retentionChangePreview, (data, instance) => validateRetentionChangePreview(data, instance, opts));
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

export { loadLoggingPolicy, loadGatewayRoutes, effectiveSettings };
