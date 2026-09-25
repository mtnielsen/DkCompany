/**
 * DKC-024 — semantiske validatorer for live-mål og opgraderingsplaner.
 *
 * Skemaet håndhæver formen på en opgraderingsplan. Denne modul håndhæver de
 * beslutninger skemaet ikke kan udtrykke:
 *
 *   - målversionen skal ligge i en understøttet serie og editionen være
 *     understøttet; ellers kræver opgraderingen en ny kandidat,
 *   - backup og en navngiven rollback-strategi er obligatoriske, og kandidaten
 *     skal have dokumenteret en afprøvet gendannelse,
 *   - live-målene skal være pinnet til præcis den version/edition releaseprofilen
 *     godkender, og hvert privacy-verbum med et endpoint skal have en prøve,
 *   - et `partial`-verbum må ikke prøves som `full`.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { buildAjv, validate, SCHEMA_IDS } from "./schemas.mjs";
import { loadLiveTargets, liveTargetsProblems, targetProblems } from "../../adapter-sdk/src/live.mjs";
import { upgradePlanProblems } from "../../adapter-sdk/src/upgrade.mjs";

function err(path, message) {
  return { path, message };
}

function schemaErrors(ajv, schemaId, data) {
  const { ok, errors } = validate(ajv, schemaId, data);
  return ok ? [] : errors.map((e) => err(e.path || "/", e.message));
}

export function validateAdapterUpgradePlan(data, ajv, opts = {}) {
  const instance = ajv ?? buildAjv().ajv;
  const errors = [...schemaErrors(instance, SCHEMA_IDS.upstreamUpgradePlan, data)];
  if (errors.length === 0) errors.push(...upgradePlanProblems(data, opts));
  return { ok: errors.length === 0, errors };
}

/**
 * Læs alle `upstream-upgrade-plan.*.example.json` fra en mappe og validér dem
 * mod den tilhørende releaseprofil og kandidat.
 */
export function validateAdapterUpgradePlanDir(dir, { manifestDir = null } = {}) {
  const ajv = buildAjv().ajv;
  const results = [];
  if (!dir || !existsSync(dir)) return results;
  const files = readdirSync(dir).filter((f) => f.startsWith("upstream-upgrade-plan.") && f.endsWith(".example.json")).sort();
  for (const file of files) {
    let data;
    try {
      data = JSON.parse(readFileSync(join(dir, file), "utf8"));
    } catch (e) {
      results.push({ file, ok: false, errors: [err("/", `ugyldig JSON: ${e.message}`)] });
      continue;
    }
    const suffix = file.replace(/^upstream-upgrade-plan\./, "").replace(/\.example\.json$/, "");
    const profileFile = `upstream-release-profile.${suffix}.example.json`;
    const candidateFile = `integration-candidate.${suffix}.example.json`;
    const readIf = (name) => {
      if (!existsSync(join(dir, name))) return null;
      try {
        return JSON.parse(readFileSync(join(dir, name), "utf8"));
      } catch {
        return null;
      }
    };
    const releaseProfile = readIf(profileFile);
    const candidate = readIf(candidateFile);
    const { ok, errors } = validateAdapterUpgradePlan(data, ajv, { releaseProfile, candidate });
    results.push({ file, ok, errors, releaseProfile, candidate });
  }
  return results;
}

/**
 * Validér `adapter-sdk/live-targets.json` i repo-roden. Returnerer en liste af
 * menneskelæsbare problemer (tom = alt pinnet og konsistent).
 */
export function validateLiveTargets(root) {
  const problems = [];
  let manifest;
  try {
    manifest = loadLiveTargets(root);
  } catch (e) {
    return [e.message];
  }
  const load = (target) => {
    const profile = JSON.parse(readFileSync(join(root, target.releaseProfile), "utf8"));
    const candidate = JSON.parse(readFileSync(join(root, target.candidate), "utf8"));
    const manifest = JSON.parse(readFileSync(join(root, "modules", target.module, "module-manifest.json"), "utf8"));
    return { profile, candidate, manifest };
  };
  problems.push(...liveTargetsProblems(manifest, { load }));
  for (const target of manifest.targets ?? []) {
    if (!target.upgrade?.to?.version) problems.push(`${target.id}: mangler upgrade.to.version (opgraderingsplanen kan ikke udledes)`);
  }
  return problems;
}

export { targetProblems };
