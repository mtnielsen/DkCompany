/**
 * DKC-053 — semantiske validatorer for kataloget: komponentmanifester,
 * installationsprofiler og platformmatrix.
 *
 * JSON Schema håndhæver formen. Denne modul håndhæver de beslutninger, et skema
 * ikke kan udtrykke alene:
 *
 *   - hvert manifest har et navngivet menneske som ejer,
 *   - sikkerhedskernen kan ikke fravælges, og host-styring er aldrig kerne,
 *   - versioner og versionsintervaller er gyldige SemVer,
 *   - en 'implemented'-komponent peger på et modul, en 'catalog-only' gør ikke,
 *   - profilen binder til en DKC-002 deployment-profil, kræver eksplicit
 *     non-HA-accept og ekstern backup for single-server, og har en dateret
 *     migrationsvej med forventet nedetid,
 *   - platformmatricen er navngivet og hver kombination har en testkommando.
 *
 * Validatorerne er rene funktioner og bruges af conformance, distribution og
 * installatøren.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildAjv, validate, SCHEMA_IDS } from "./schemas.mjs";
import { isNamedHuman } from "./architecture.mjs";
import { isValidVersion, isValidRange } from "../../distribution/src/semver.mjs";
import { componentsDir, profilesDir } from "../../distribution/src/catalog.mjs";

function err(path, message) {
  return { path, message };
}

function validateOne(ajv, schemaId, data, rules) {
  const { ok, errors } = validate(ajv, schemaId, data);
  const result = ok ? [] : errors.map((e) => err(e.path || "/", e.message));
  if (result.length === 0) result.push(...rules(data));
  return { ok: result.length === 0, errors: result };
}

/* -------------------------------------------------------------------------- */
/* Component manifests                                                        */
/* -------------------------------------------------------------------------- */

export function componentManifestProblems(data) {
  const problems = [];
  const id = data?.metadata?.name ?? "?";
  if (!isNamedHuman(data?.metadata?.accountableHuman)) {
    problems.push(err("/metadata/accountableHuman", `'${id}' skal have et navngivet menneske som ejer, ikke et team-alias`));
  }
  if (!isValidVersion(data?.metadata?.version)) {
    problems.push(err("/metadata/version", `'${id}' har ugyldig SemVer '${data?.metadata?.version}'`));
  }
  if (data?.componentType === "security-core" && data?.securityCore !== true) {
    problems.push(err("/securityCore", "en security-core-komponent skal have securityCore: true"));
  }
  if (data?.componentType === "host-management" && data?.securityCore === true) {
    problems.push(err("/securityCore", "host-styring er separat opt-in og må ikke være en del af sikkerhedskernen"));
  }
  for (const dep of [...(data?.requires ?? []), ...(data?.optionalRequires ?? []), ...(data?.conflicts ?? []).filter((c) => c.range)]) {
    if (!isValidRange(dep.range)) {
      problems.push(err("/requires", `'${id}' har et ugyldigt versionsinterval '${dep.range}' for '${dep.ref}'`));
    }
  }
  for (const ds of data?.dataServices ?? []) {
    if (typeof ds.reason !== "string" || ds.reason.trim().length < 10) {
      problems.push(err(`/dataServices/${ds.id}/reason`, "en datatjenestekrav skal begrundes hvorfor den er nødvendig"));
    }
  }
  for (const dl of data?.download ?? []) {
    if (dl.verified !== true) problems.push(err("/download", `artefaktet '${dl.artifact}' skal verificeres før brug`));
  }
  if (data?.implementation?.status === "implemented" && !(data?.implementation?.moduleRef ?? "").trim()) {
    problems.push(err("/implementation/moduleRef", "en 'implemented'-komponent skal pege på sit modul"));
  }
  if (data?.implementation?.status === "catalog-only" && (data?.implementation?.moduleRef ?? "").trim()) {
    problems.push(err("/implementation/moduleRef", "en 'catalog-only'-komponent må ikke pege på et modul, den ikke har"));
  }
  return problems;
}

export function validateComponentManifest(data, ajv) {
  const instance = ajv ?? buildAjv().ajv;
  return validateOne(instance, SCHEMA_IDS.componentManifest, data, componentManifestProblems);
}

export function validateComponentDir(dir = componentsDir, { pattern = /\.component\.json$/ } = {}) {
  const results = [];
  if (!dir || !existsSync(dir)) return results;
  const ajv = buildAjv().ajv;
  for (const file of readdirSync(dir).filter((f) => pattern.test(f)).sort()) {
    let data;
    try {
      data = JSON.parse(readFileSync(join(dir, file), "utf8"));
    } catch (e) {
      results.push({ file, ok: false, errors: [err("/", `ugyldig JSON: ${e.message}`)] });
      continue;
    }
    const { ok, errors } = validateComponentManifest(data, ajv);
    results.push({ file, ok, errors });
  }
  return results;
}

/* -------------------------------------------------------------------------- */
/* Installation profiles                                                      */
/* -------------------------------------------------------------------------- */

export function installationProfileProblems(data) {
  const problems = [];
  const name = data?.metadata?.name ?? "?";
  if (!isNamedHuman(data?.metadata?.accountableHuman)) {
    problems.push(err("/metadata/accountableHuman", `profilen '${name}' skal have et navngivet menneske som ejer`));
  }
  if (!isValidVersion(data?.metadata?.version)) {
    problems.push(err("/metadata/version", `profilen '${name}' har ugyldig SemVer`));
  }
  if (data?.hostManagement?.optIn !== true) {
    problems.push(err("/hostManagement/optIn", "host-styring skal være eksplicit opt-in i alle profiler"));
  }
  if (!(data?.securityCore ?? []).length) {
    problems.push(err("/securityCore", "profilen skal navngive sikkerhedskernen"));
  }
  if (!(data?.supportedPlatforms ?? []).length) {
    problems.push(err("/supportedPlatforms", "profilen skal navngive mindst én understøttet platformskombination"));
  }
  const cap = data?.capacity ?? {};
  for (const key of ["cpuMillicores", "memoryMiB", "storageGiB", "nodes"]) {
    if (!(Number(cap[key]) > 0)) problems.push(err(`/capacity/${key}`, "kapacitetsbudgettet skal være positivt"));
  }
  const ha = data?.highAvailability ?? {};
  if (data?.profileType === "single-server") {
    if (ha.enabled === true) problems.push(err("/highAvailability/enabled", "single-server er en non-HA-profil"));
    if (ha.acceptedNonHaServiceClass !== true) {
      problems.push(err("/highAvailability/acceptedNonHaServiceClass", "single-server kræver eksplicit accepteret non-HA-serviceklasse"));
    }
    if (ha.externalBackupRequired !== true) {
      problems.push(err("/highAvailability/externalBackupRequired", "single-server kræver ekstern, offsite backup"));
    }
  }
  if (["multiple-servers", "dedicated-customer"].includes(data?.profileType) && ha.enabled !== true) {
    problems.push(err("/highAvailability/enabled", `profilen '${data.profileType}' er en HA-profil og skal have highAvailability.enabled: true`));
  }
  const migration = data?.migration ?? {};
  if (!(migration.pathRef ?? "").trim()) problems.push(err("/migration/pathRef", "migrationsvejen skal dokumenteres"));
  if (!(Number.isInteger(migration.expectedDowntimeMinutes) && migration.expectedDowntimeMinutes >= 0)) {
    problems.push(err("/migration/expectedDowntimeMinutes", "forventet nedetid skal angives i minutter"));
  }
  if (!(migration.steps ?? []).length) problems.push(err("/migration/steps", "migrationsvejen skal have konkrete trin"));
  return problems;
}

export function validateInstallationProfile(data, ajv) {
  const instance = ajv ?? buildAjv().ajv;
  return validateOne(instance, SCHEMA_IDS.installationProfile, data, installationProfileProblems);
}

export function validateProfileDir(dir = profilesDir, { pattern = /\.profile\.json$/ } = {}) {
  const results = [];
  if (!dir || !existsSync(dir)) return results;
  const ajv = buildAjv().ajv;
  for (const file of readdirSync(dir).filter((f) => pattern.test(f)).sort()) {
    let data;
    try {
      data = JSON.parse(readFileSync(join(dir, file), "utf8"));
    } catch (e) {
      results.push({ file, ok: false, errors: [err("/", `ugyldig JSON: ${e.message}`)] });
      continue;
    }
    const { ok, errors } = validateInstallationProfile(data, ajv);
    results.push({ file, ok, errors });
  }
  return results;
}

/* -------------------------------------------------------------------------- */
/* Platform matrix                                                            */
/* -------------------------------------------------------------------------- */

export function platformMatrixProblems(data) {
  const problems = [];
  if (!isNamedHuman(data?.metadata?.accountableHuman)) {
    problems.push(err("/metadata/accountableHuman", "platformmatricen skal have et navngivet menneske som ejer"));
  }
  const ids = new Set();
  for (const [i, p] of (data?.platforms ?? []).entries()) {
    if (ids.has(p.id)) problems.push(err(`/platforms/${i}/id`, `dubleret platform-id '${p.id}'`));
    ids.add(p.id);
    if (!(p.testCommand ?? "").trim()) problems.push(err(`/platforms/${i}/testCommand`, `platformen '${p.id}' er ikke testbar uden en testkommando`));
  }
  return problems;
}

export function validatePlatformMatrix(data, ajv) {
  const instance = ajv ?? buildAjv().ajv;
  return validateOne(instance, SCHEMA_IDS.platformMatrix, data, platformMatrixProblems);
}
