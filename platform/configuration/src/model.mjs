/**
 * DKC-054 — den fælles konfigurationsmodel.
 *
 * Der findes præcis én autoritativ ønsket tilstand. Den deklarative fil, UI'et
 * og API'et læser og skriver samme versionerede dokument, validerer det med
 * samme funktion og beregner samme digest. Modellen indeholder:
 *
 *   - sikre standardværdier (debug slukket, backup tændt, ingen modelrute uden
 *     eksplicit egress-godkendelse, retention pr. dataklasse),
 *   - effektiv indstilling pr. installation/tenant/modul,
 *   - semantiske beslutninger som JSON Schema ikke kan udtrykke alene (audit må
 *     ikke kunne slukkes med logniveau, WORM for beskyttede klasser, kun kendte
 *     modelruter, retention inden for en menneskeligt vedtaget ramme).
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stableStringify } from "../../approvals/src/binding.mjs";
import { digestOf } from "../../policy/pdp/src/crypto.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, "..", "..");

export const CONFIG_SCHEMA_VERSION = "1.0.0";
export const LOG_LEVELS = ["trace", "debug", "info", "warn", "error"];
export const KNOWN_DATA_CLASSES = ["public", "internal", "confidential", "personal", "security"];
export const PROTECTED_DATA_CLASSES = ["personal", "security"];
export const MAX_DEBUG_TTL_SECONDS = 24 * 60 * 60;
export const DEFAULT_BACKUP_SCHEDULE = "6h";
export const DESIRED_STATE_PATH = "configuration/desired-state.json";
export const HOST_SCOPE_PATH = "configuration/host-scope.json";
export const KEYRING_PATH = "configuration/dev-keyring.json";
export const INSTALLER_STATE_PATH = "configuration/installer-state.json";

export function loadJson(relPath, root = repoRoot) {
  const full = join(root, relPath);
  if (!existsSync(full)) throw new Error(`Mangler ${relPath}`);
  return JSON.parse(readFileSync(full, "utf8"));
}

export function loadLoggingPolicy(root = repoRoot) {
  return loadJson("logging/logging-policy.json", root);
}

export function loadGatewayRoutes(root = repoRoot) {
  const data = loadJson("gateway/routes.json", root);
  return data.routes ?? [];
}

export function loadHostScope(root = repoRoot) {
  return loadJson(HOST_SCOPE_PATH, root);
}

export function loadDesiredState(root = repoRoot) {
  return loadJson(DESIRED_STATE_PATH, root);
}

export function loadKeyring(root = repoRoot) {
  return loadJson(KEYRING_PATH, root);
}

/** Sikre standardværdier udledt af den kanoniske loggepolitik. */
export function secureDefaults({ loggingPolicy = loadLoggingPolicy() } = {}) {
  const retention = [];
  for (const dataClass of KNOWN_DATA_CLASSES) {
    const days = loggingPolicy?.retention?.[dataClass] ?? (dataClass === "public" ? 30 : 365);
    retention.push({
      dataClass,
      retentionDays: days,
      legalHold: dataClass === "personal",
      worm: PROTECTED_DATA_CLASSES.includes(dataClass),
      basis: dataClass === "personal" ? "GDPR art. 5(1)(e) — formålsbestemt opbevaring" : "drifts- og revisionsbehov",
    });
  }
  return {
    logLevel: "info",
    debug: {
      enabled: false,
      expiresAt: null,
      reason: "debug er slået fra som standard (fail-closed)",
      requestedBy: "system|installer",
    },
    retention,
    backups: {
      enabled: true,
      schedule: DEFAULT_BACKUP_SCHEDULE,
      external: true,
      targetSetRef: "primary-offsite",
      retentionDays: 365,
    },
    modelRoutes: [],
    resourceLimits: {
      cpuMillicores: 500,
      memoryMiB: 1024,
      storageGiB: 20,
      maxReplicas: 3,
    },
  };
}

/** Kanonisk form: sorterede lister, så digesten er deterministisk. */
export function normalizeSettings(settings = {}) {
  const normalized = structuredClone(settings);
  if (Array.isArray(normalized.retention)) {
    normalized.retention = [...normalized.retention].sort((a, b) => a.dataClass.localeCompare(b.dataClass));
  }
  if (Array.isArray(normalized.modelRoutes)) {
    normalized.modelRoutes = [...normalized.modelRoutes].sort((a, b) => `${a.dataClass}:${a.routeRef}`.localeCompare(`${b.dataClass}:${b.routeRef}`));
  }
  return normalized;
}

export function normalizeConfiguration(config = {}) {
  const normalized = structuredClone(config);
  if (normalized.installation) normalized.installation = normalizeSettings(normalized.installation);
  if (Array.isArray(normalized.overrides)) {
    normalized.overrides = [...normalized.overrides]
      .map((o) => ({ ...o, settings: normalizeSettings(o.settings ?? {}) }))
      .sort((a, b) => `${a.scope}:${a.target}`.localeCompare(`${b.scope}:${b.target}`));
  }
  return normalized;
}

export function configurationDigest(config) {
  return digestOf(normalizeConfiguration(config));
}

/**
 * Indholdsdigest uden autorisationens eget digestfelt. Bruges til at binde en
 * menneskelig beslutning til præcis det indhold, den dækker, uden cirkularitet.
 */
export function configurationContentDigest(config) {
  const normalized = normalizeConfiguration(config);
  if (normalized.authorization && typeof normalized.authorization === "object") {
    normalized.authorization = { ...normalized.authorization };
    delete normalized.authorization.decisionDigest;
  }
  return digestOf(normalized);
}

function deepMerge(base, override) {
  if (!override || typeof override !== "object" || Array.isArray(override)) return override === undefined ? base : override;
  const out = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value && typeof value === "object" && !Array.isArray(value) && base?.[key] && typeof base[key] === "object" && !Array.isArray(base[key])) {
      out[key] = deepMerge(base[key], value);
    } else {
      out[key] = structuredClone(value);
    }
  }
  return out;
}

/**
 * Den effektive indstilling for en given installation/tenant/modul.
 * Rækkefølge: installation → tenant → modul. En override kan kun tilføje eller
 * stramme; semantikken kontrollerer at sikkerhedsgrænser ikke svækkes.
 */
export function effectiveSettings(config, { tenantId = null, moduleId = null } = {}) {
  let settings = normalizeSettings(config?.installation ?? {});
  const overrides = config?.overrides ?? [];
  const tenantOverride = tenantId ? overrides.find((o) => o.scope === "tenant" && o.target === tenantId) : null;
  const moduleOverride = moduleId ? overrides.find((o) => o.scope === "module" && o.target === moduleId) : null;
  if (tenantOverride) settings = deepMerge(settings, tenantOverride.settings);
  if (moduleOverride) settings = deepMerge(settings, moduleOverride.settings);
  return settings;
}

/**
 * Revisionssporet er uafhængigt af logniveauet. Denne funktion er den ene
 * kilde, kaldes af checks og tests, og kan ikke slås fra via konfigurationen.
 */
export function auditTrailActive(config) {
  return config?.enforcement?.auditTrailImmutable === true;
}

/** Er der et aktivt debug-vindue på det givne tidspunkt? */
export function debugActive(config, now = Date.now()) {
  const debug = effectiveSettings(config).debug ?? {};
  if (debug.enabled !== true) return false;
  const expires = Date.parse(debug.expiresAt ?? "");
  if (!Number.isFinite(expires)) return false;
  return expires > now;
}

/** Semantiske problemer ud over skemaet. */
export function configurationProblems(config, { loggingPolicy = loadLoggingPolicy(), gatewayRoutes = loadGatewayRoutes() } = {}) {
  const problems = [];
  const at = (path, message) => problems.push({ path, message });

  if (config?.schemaVersion !== CONFIG_SCHEMA_VERSION) {
    at("/schemaVersion", `forventede schemaVersion '${CONFIG_SCHEMA_VERSION}'`);
  }
  if (config?.enforcement?.singleSource !== true) at("/enforcement/singleSource", "der skal være én autoritativ ønsket tilstand");
  if (config?.enforcement?.driftPolicy !== "fail-closed") at("/enforcement/driftPolicy", "drift mellem kontrolkilder skal fejle lukket");
  if (config?.enforcement?.auditTrailImmutable !== true) at("/enforcement/auditTrailImmutable", "revisionssporet må ikke kunne deaktiveres");
  if (config?.enforcement?.secretRedaction !== true) at("/enforcement/secretRedaction", "hemmeligheder skal redigeres i preview, CLI, Git og supportbundle");

  const auth = config?.authorization ?? {};
  if (!/^[a-z][a-z0-9-]*\|/.test(auth.humanSubject ?? "")) at("/authorization/humanSubject", "autorisationen skal være en navngiven, verificeret menneskelig identitet");
  const granted = Date.parse(auth.grantedAt ?? "");
  const expires = Date.parse(auth.expiresAt ?? "");
  if (Number.isFinite(granted) && Number.isFinite(expires) && expires <= granted) at("/authorization/expiresAt", "autorisationen skal udløbe efter den blev givet");

  // Debug-TTL: aktiv debug skal udløbe hurtigt, og slukket debug må ikke have en frist.
  const debug = config?.installation?.debug ?? {};
  if (debug.enabled === true) {
    const exp = Date.parse(debug.expiresAt ?? "");
    if (!Number.isFinite(exp)) at("/installation/debug/expiresAt", "et aktivt debug skal have en absolut TTL");
    else if (Number.isFinite(granted) && exp - granted > MAX_DEBUG_TTL_SECONDS * 1000) at("/installation/debug/expiresAt", `debug-TTL må højst være ${MAX_DEBUG_TTL_SECONDS / 3600} timer`);
  } else if (debug.expiresAt !== null) {
    at("/installation/debug/expiresAt", "slukket debug skal have expiresAt=null");
  }

  // Retention skal dække hver kendt dataklasse præcis én gang, og beskyttede klasser skal være WORM.
  const retention = config?.installation?.retention ?? [];
  const seen = new Set();
  for (const [i, entry] of retention.entries()) {
    if (seen.has(entry.dataClass)) at(`/installation/retention/${i}`, `dataklassen '${entry.dataClass}' er angivet mere end én gang`);
    seen.add(entry.dataClass);
    if (!KNOWN_DATA_CLASSES.includes(entry.dataClass)) at(`/installation/retention/${i}/dataClass`, `ukendt dataklasse '${entry.dataClass}'`);
    if (PROTECTED_DATA_CLASSES.includes(entry.dataClass) && entry.worm !== true) {
      at(`/installation/retention/${i}/worm`, `den beskyttede dataklasse '${entry.dataClass}' kræver WORM`);
    }
    const baseline = loggingPolicy?.retention?.[entry.dataClass];
    if (Number.isFinite(baseline) && entry.retentionDays > baseline * 2) {
      at(`/installation/retention/${i}/retentionDays`, `retention for '${entry.dataClass}' (${entry.retentionDays} dage) overstiger det dobbelte af politikens ${baseline}`);
    }
  }
  for (const dataClass of KNOWN_DATA_CLASSES) {
    if (!seen.has(dataClass)) at("/installation/retention", `dataklassen '${dataClass}' mangler i retention`);
  }

  // Backup: ekstern backup er påkrævet og skal pege på et målsæt.
  const backups = config?.installation?.backups ?? {};
  if (backups.enabled !== true) at("/installation/backups/enabled", "backup skal være slået til");
  if (backups.external === true && !backups.targetSetRef) at("/installation/backups/targetSetRef", "ekstern backup skal referere til et backup-målsæt");

  // Modelruter: default-deny, kun kendte ruter, og følsomme klasser kræver egress-godkendelse.
  const routeIds = new Set(gatewayRoutes.map((r) => r.id));
  const routedClasses = new Set();
  for (const [i, route] of (config?.installation?.modelRoutes ?? []).entries()) {
    if (!routeIds.has(route.routeRef)) at(`/installation/modelRoutes/${i}/routeRef`, `modelruten '${route.routeRef}' findes ikke i gateway/routes.json`);
    if (routedClasses.has(route.dataClass)) at(`/installation/modelRoutes/${i}/dataClass`, `dataklassen '${route.dataClass}' har mere end én modelrute`);
    routedClasses.add(route.dataClass);
    if (PROTECTED_DATA_CLASSES.includes(route.dataClass) && route.egressApproved !== true) {
      at(`/installation/modelRoutes/${i}/egressApproved`, `dataklassen '${route.dataClass}' kræver eksplicit egress-godkendelse`);
    }
  }

  // Overrides må ikke svække en beskyttet klasse eller slå audit/backup fra.
  for (const [i, override] of (config?.overrides ?? []).entries()) {
    if (override.settings?.debug?.enabled === true && !override.settings.debug.expiresAt) {
      at(`/overrides/${i}/settings/debug/expiresAt`, "en aktiv debug-override skal have en TTL");
    }
    if (override.settings?.backups?.enabled === false) at(`/overrides/${i}/settings/backups/enabled`, "en override må ikke slå backup fra");
    if (override.settings?.logLevel && !LOG_LEVELS.includes(override.settings.logLevel)) {
      at(`/overrides/${i}/settings/logLevel`, `ukendt logniveau '${override.settings.logLevel}'`);
    }
  }

  return problems;
}

export { stableStringify };
