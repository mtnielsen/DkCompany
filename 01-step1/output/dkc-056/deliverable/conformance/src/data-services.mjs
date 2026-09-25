/**
 * DKC-056 — semantiske validatorer for databaseprofiler, datakilder og
 * applikationsbindinger.
 *
 * JSON Schema håndhæver formen. Denne modul håndhæver de beslutninger, et skema
 * ikke kan udtrykke alene:
 *
 *   - hver profil, datakilde og binding har et navngivet menneske som ejer,
 *   - en administreret profil og en BYO-profil har forskellige ansvarsmatricer:
 *     BYO kræver at motorens patching/backup/restore/nøgler/kostnader ejes af
 *     kunden (eller deles), og at platformen aldrig migrerer fremmede skemaer,
 *   - read-only er standard og kan ikke fravælges for en ekstern kilde,
 *   - en HR-kilde (eller enhver ekstern kilde) må ikke give generelt læseadgang:
 *     scopet skal være eksplicitte schema.tabel-par, ikke «alle tabeller»,
 *   - en ekstern kilde er ikke platformens egen database og må ikke migreres
 *     eller sikkerhedskopieres automatisk,
 *   - secretreferencer er referencer, ikke rå hemmeligheder,
 *   - bindings må ikke udvide scopet ud over datakildens aftalte scope.
 *
 * Validatorerne er rene funktioner og bruges af conformance, data-services og
 * installatøren.
 */
import { buildAjv, validate, SCHEMA_IDS } from "./schemas.mjs";
import { isNamedHuman } from "./architecture.mjs";
import { isValidRange } from "../../distribution/src/semver.mjs";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

function err(path, message) {
  return { path, message };
}

/** De ansvarsområder en databaseprofil og en binding skal dække. */
export const DATABASE_RESPONSIBILITIES = ["patching", "backup", "restore", "keys", "costs", "monitoring", "migration"];
export const BINDING_RESPONSIBILITIES = ["applicationData", "secrets", "migration", "backup", "restore"];

/** Connector-events der altid skal være tændt for et revisionsspor. */
export const REQUIRED_AUDIT_EVENTS = ["connect", "query", "denied"];

const SECRET_PROVIDERS = new Set(["vault", "k8s", "env", "file", "kms"]);

/** Ser referencen ud som en rå hemmelighed i stedet for en reference? */
export function looksLikeRawSecret(value) {
  if (typeof value !== "string") return false;
  const lower = value.toLowerCase();
  if (/(password|passwd|pwd|secret|token|apikey|api_key|privatekey)\s*[=:]/.test(lower)) return true;
  // En lang base64/hex-blob uden provider-præfiks er en hemmelighed, ikke en reference.
  return /^[A-Za-z0-9+/=_-]{40,}$/.test(value) && !SECRET_PROVIDERS.has(value.split(":")[0]);
}

/** Valider et ansvarsområde: navngivet menneske og en kendt ejer. */
function accountabilityProblems(path, entry) {
  const problems = [];
  if (!entry) {
    problems.push(err(path, "ansvarsområdet mangler"));
    return problems;
  }
  if (!isNamedHuman(entry.accountableHuman)) {
    problems.push(err(`${path}/accountableHuman`, "ansvarsområdet skal have et navngivet menneske, ikke et team-alias"));
  }
  return problems;
}

/* -------------------------------------------------------------------------- */
/* Databaseprofiler                                                           */
/* -------------------------------------------------------------------------- */

export function databaseProfileProblems(data) {
  const problems = [];
  const id = data?.metadata?.name ?? "?";

  if (!isNamedHuman(data?.metadata?.accountableHuman)) {
    problems.push(err("/metadata/accountableHuman", `'${id}' skal have et navngivet menneske som ejer`));
  }
  if (data?.engine?.noOwnEngine !== true) {
    problems.push(err("/engine/noOwnEngine", "platformen må ikke erklære sin egen databaseengine; noOwnEngine skal være true"));
  }
  if (!isNamedHuman(data?.engine?.engineOwner)) {
    problems.push(err("/engine/engineOwner", "motorens ejer skal være et navngivet menneske"));
  }

  const versions = data?.engine?.supportedVersions ?? [];
  for (const [i, v] of versions.entries()) {
    if (!isValidRange(v.range)) problems.push(err(`/engine/supportedVersions/${i}/range`, `ugyldigt SemVer-interval '${v.range}'`));
  }
  if (!versions.some((v) => v.tested === true)) {
    problems.push(err("/engine/supportedVersions", "mindst én understøttet motorversion skal være efterprøvet (tested: true)"));
  }

  if (data?.profileType === "managed") {
    if (!data?.managed) problems.push(err("/managed", "en administreret profil skal have et managed-blok"));
    if (data?.secureDefaults?.encryptionAtRest?.required !== true) {
      problems.push(err("/secureDefaults/encryptionAtRest/required", "en administreret profil skal kræve kryptering ved hvile"));
    }
    if (data?.backup?.enabled !== true) problems.push(err("/backup/enabled", "en administreret profil skal have backup slået til"));
    if (data?.backup?.verifiedRestore !== true) {
      problems.push(err("/backup/verifiedRestore", "en administreret profil skal have verificeret gendannelse; en uafprøvet backup er ikke en backup"));
    }
  }

  if (data?.profileType === "byo") {
    if (!data?.byo) {
      problems.push(err("/byo", "en BYO-profil skal have et byo-blok"));
    } else {
      if (!isNamedHuman(data.byo.customer)) problems.push(err("/byo/customer", "BYO-kunden skal være et navngivet menneske"));
      if (!isNamedHuman(data.byo.responsibilityAcceptedBy)) {
        problems.push(err("/byo/responsibilityAcceptedBy", "ansvaret skal være eksplicit accepteret af et navngivet menneske"));
      }
    }
  }

  for (const key of DATABASE_RESPONSIBILITIES) {
    problems.push(...accountabilityProblems(`/responsibilityMatrix/${key}`, data?.responsibilityMatrix?.[key]));
  }

  if (data?.profileType === "byo" && data?.responsibilityMatrix) {
    // Ved BYO må platformen ikke påtage sig motordriften alene.
    for (const key of ["patching", "backup", "restore", "keys", "costs"]) {
      const owner = data.responsibilityMatrix[key]?.owner;
      if (owner === "platform") {
        problems.push(err(`/responsibilityMatrix/${key}/owner`, `BYO: '${key}' kan ikke være platformens aleneansvar; det er kundens motor`));
      }
    }
  }

  if (data?.migrations?.foreignSchemaPolicy !== "never") {
    problems.push(err("/migrations/foreignSchemaPolicy", "foreignSchemaPolicy skal være 'never': migrationer må ikke ændre fremmede skemaer"));
  }
  if (data?.migrations && data.migrations.strategy !== "none" && !(data.migrations.ownedSchemas ?? []).length) {
    problems.push(err("/migrations/ownedSchemas", "en migrerende profil skal eje mindst ét schema"));
  }
  if (data?.migrations && data.migrations.strategy !== "none" && data.migrations.destructiveChangesRequireApproval !== true) {
    problems.push(err("/migrations/destructiveChangesRequireApproval", "destruktive migrationer skal kræve godkendelse"));
  }

  if (data?.tenantIsolation?.separateIdentity !== true) {
    problems.push(err("/tenantIsolation/separateIdentity", "tenant-isolationen skal bruge en adskilt databaseidentitet"));
  }

  return problems;
}

export function validateDatabaseProfile(data, ajv) {
  const instance = ajv ?? buildAjv().ajv;
  const { ok, errors } = validate(instance, SCHEMA_IDS.databaseProfile, data);
  const result = ok ? [] : errors.map((e) => err(e.path || "/", e.message));
  if (result.length === 0) result.push(...databaseProfileProblems(data));
  return { ok: result.length === 0, errors: result };
}

/* -------------------------------------------------------------------------- */
/* Datakilder / connectorer                                                   */
/* -------------------------------------------------------------------------- */

export function dataSourceProblems(data) {
  const problems = [];
  const id = data?.metadata?.name ?? "?";

  if (!isNamedHuman(data?.metadata?.dataOwner)) {
    problems.push(err("/metadata/dataOwner", `'${id}' skal have et navngivet menneske som dataejer`));
  }
  if (!isNamedHuman(data?.dataOwnership?.owner)) {
    problems.push(err("/dataOwnership/owner", "dataejerskabet skal være et navngivet menneske"));
  }

  const secretRef = data?.connection?.secretRef;
  if (looksLikeRawSecret(secretRef)) {
    problems.push(err("/connection/secretRef", "secretRef ser ud som en rå hemmelighed; brug en provider-reference (vault:, k8s:, env:, file:, kms:)"));
  }
  if (!SECRET_PROVIDERS.has((secretRef ?? "").split(":")[0])) {
    problems.push(err("/connection/secretRef", `ukendt secret-provider i '${secretRef}'`));
  }

  if (data?.access?.readOnly !== true) problems.push(err("/access/readOnly", "en datakilde skal være read-only"));
  if (data?.access?.denyWrites !== true) problems.push(err("/access/denyWrites", "skrivninger skal være forbudt"));
  if (data?.access?.denyDdl !== true) problems.push(err("/access/denyDdl", "DDL skal være forbudt mod en ekstern kilde"));

  const schemas = data?.access?.allowedSchemas ?? [];
  const tables = data?.access?.allowedTables ?? [];
  if (schemas.includes("*")) problems.push(err("/access/allowedSchemas", "et scope må ikke være '*' (generelt læseadgang)"));
  if (tables.some((t) => t === "*" || t.endsWith(".*"))) {
    problems.push(err("/access/allowedTables", "et scope må ikke bruge jokertegn; angiv eksplicitte schema.tabel-par"));
  }
  if (tables.length === 0) {
    problems.push(err("/access/allowedTables", "en connector uden eksplicitte tabeller ville give generelt læseadgang; angiv mindst én tabel"));
  }
  const schemaSet = new Set(schemas);
  for (const [i, table] of tables.entries()) {
    const schema = table.split(".")[0];
    if (!schemaSet.has(schema)) {
      problems.push(err(`/access/allowedTables/${i}`, `tabellen '${table}' ligger i schemaet '${schema}', som ikke er i allowedSchemas`));
    }
  }

  if (data?.sourceType === "hr" && (tables.length === 0 || tables.some((t) => t.toLowerCase().includes("all")))) {
    problems.push(err("/access/allowedTables", "en HR-kilde må ikke give generelt læseadgang til alle tabeller"));
  }

  if (data?.externalPolicy?.treatAsOwnDatabase !== false) {
    problems.push(err("/externalPolicy/treatAsOwnDatabase", "en ekstern kilde må ikke behandles som platformens egen database"));
  }
  if (data?.externalPolicy?.autoMigrate !== false) {
    problems.push(err("/externalPolicy/autoMigrate", "en ekstern kilde må ikke migreres automatisk"));
  }
  if (data?.externalPolicy?.autoBackup !== false) {
    problems.push(err("/externalPolicy/autoBackup", "en ekstern kilde må ikke sikkerhedskopieres automatisk uden scope"));
  }
  if (!(data?.externalPolicy?.scopeAgreementRef ?? "").trim()) {
    problems.push(err("/externalPolicy/scopeAgreementRef", "en ekstern kilde skal have en scope-aftale"));
  }

  if (data?.tenantBinding?.required !== true) {
    problems.push(err("/tenantBinding/required", "en connector skal være tenantbunden"));
  }
  if (data?.tenantBinding?.source !== "principal") {
    problems.push(err("/tenantBinding/source", "tenant skal udledes af den verificerede principal"));
  }

  const auditEvents = new Set(data?.auditTrail?.events ?? []);
  for (const event of REQUIRED_AUDIT_EVENTS) {
    if (!auditEvents.has(event)) problems.push(err("/auditTrail/events", `revisionssporet mangler eventet '${event}'`));
  }
  if (data?.auditTrail?.enabled !== true) problems.push(err("/auditTrail/enabled", "revisionssporet skal være slået til"));

  const discoverySchemas = data?.schemaDiscovery?.includeSchemas ?? [];
  for (const [i, schema] of discoverySchemas.entries()) {
    if (!schemaSet.has(schema)) {
      problems.push(err(`/schemaDiscovery/includeSchemas/${i}`, `schema-discovery omfatter '${schema}', som ikke er i access.allowedSchemas`));
    }
  }

  if (data?.connection?.tls?.mode === "disable") {
    problems.push(err("/connection/tls/mode", "en ekstern datakilde skal bruge TLS"));
  }

  return problems;
}

export function validateDataSource(data, ajv) {
  const instance = ajv ?? buildAjv().ajv;
  const { ok, errors } = validate(instance, SCHEMA_IDS.dataSource, data);
  const result = ok ? [] : errors.map((e) => err(e.path || "/", e.message));
  if (result.length === 0) result.push(...dataSourceProblems(data));
  return { ok: result.length === 0, errors: result };
}

/* -------------------------------------------------------------------------- */
/* Applikationsbindinger                                                      */
/* -------------------------------------------------------------------------- */

export function dataServiceBindingProblems(data) {
  const problems = [];
  if (!isNamedHuman(data?.application?.accountableHuman)) {
    problems.push(err("/application/accountableHuman", "applikationen skal have et navngivet menneske som ansvarlig"));
  }
  if (data?.tenantScope?.mode === "per-tenant" && data?.tenantScope?.separateIdentityPerTenant !== true) {
    problems.push(err("/tenantScope/separateIdentityPerTenant", "per-tenant binding kræver en adskilt identitet pr. tenant"));
  }
  if (data?.externalDataHandling?.treatAsOwnDatabase !== false) {
    problems.push(err("/externalDataHandling/treatAsOwnDatabase", "en binding må ikke behandle eksterne kilder som egne databaser"));
  }
  if (data?.externalDataHandling?.migrationsAllowed !== false) {
    problems.push(err("/externalDataHandling/migrationsAllowed", "en binding må ikke tillade migration af eksterne kilder"));
  }
  if (data?.externalDataHandling?.backupsAllowed !== false) {
    problems.push(err("/externalDataHandling/backupsAllowed", "en binding må ikke tillade backup af eksterne kilder uden scope"));
  }
  for (const key of BINDING_RESPONSIBILITIES) {
    problems.push(...accountabilityProblems(`/responsibilities/${key}`, data?.responsibilities?.[key]));
  }
  for (const [i, entry] of (data?.dataSourceRefs ?? []).entries()) {
    if (entry?.scope?.readOnly !== true) problems.push(err(`/dataSourceRefs/${i}/scope/readOnly`, "et datakildescope skal være read-only"));
    if ((entry?.scope?.allowedTables ?? []).length === 0) {
      problems.push(err(`/dataSourceRefs/${i}/scope/allowedTables`, "et datakildescope skal angive eksplicitte tabeller"));
    }
  }
  return problems;
}

export function validateDataServiceBinding(data, ajv) {
  const instance = ajv ?? buildAjv().ajv;
  const { ok, errors } = validate(instance, SCHEMA_IDS.dataServiceBinding, data);
  const result = ok ? [] : errors.map((e) => err(e.path || "/", e.message));
  if (result.length === 0) result.push(...dataServiceBindingProblems(data));
  return { ok: result.length === 0, errors: result };
}

/* -------------------------------------------------------------------------- */
/* Mappe-helpers (til validate-schemas)                                       */
/* -------------------------------------------------------------------------- */

function validateDir(dir, pattern, validator) {
  const results = [];
  if (!dir || !existsSync(dir)) return results;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json") && pattern.test(f)).sort()) {
    let data;
    try {
      data = JSON.parse(readFileSync(join(dir, file), "utf8"));
    } catch (e) {
      results.push({ file, ok: false, errors: [err("/", `ugyldig JSON: ${e.message}`)] });
      continue;
    }
    const { ok, errors } = validator(data);
    results.push({ file, ok, errors });
  }
  return results;
}

export function validateDatabaseProfileDir(dir, { pattern = /^database-profile/ } = {}) {
  return validateDir(dir, pattern, (d) => validateDatabaseProfile(d));
}
export function validateDataSourceDir(dir, { pattern = /^data-source/ } = {}) {
  return validateDir(dir, pattern, (d) => validateDataSource(d));
}
export function validateDataServiceBindingDir(dir, { pattern = /^data-service-binding/ } = {}) {
  return validateDir(dir, pattern, (d) => validateDataServiceBinding(d));
}
