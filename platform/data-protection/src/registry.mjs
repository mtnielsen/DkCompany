/**
 * DKC-047 — indlæsning af beskyttelsespolitik og -register.
 *
 * Registeret er versionsstyrede datafiler; det valideres mod
 * `contracts/protected-data.schema.json` og de semantiske regler i
 * `conformance/src/protected-data.mjs`. Politikken er adgangs- og
 * transitionsreglerne. Modulernes `dataProtection`-blok erklærer hvilke klasser
 * de kan håndtere, og hvor ærligt lagerhåndhævelsen står.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAjv } from "../../conformance/src/schemas.mjs";
import { validateProtectedData, protectedDataProblems } from "../../conformance/src/protected-data.mjs";
import { evaluateProtectedData, guardAdapterCall, authorizeReclassification } from "./guard.mjs";
import { DATA_CLASSES } from "./classes.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, "..", "..");
export const dataProtectionDir = join(repoRoot, "data-protection");
export const policyPath = join(dataProtectionDir, "policy", "access-policy.json");
export const registerPath = join(dataProtectionDir, "records", "register.json");
export const modulesDir = join(repoRoot, "modules");
export const routesPath = join(repoRoot, "gateway", "routes.json");

export function loadPolicy(path = policyPath) {
  if (!existsSync(path)) throw new Error(`Mangler ${path}`);
  const policy = JSON.parse(readFileSync(path, "utf8"));
  const problems = policyProblems(policy);
  if (problems.length) throw new Error(`Beskyttelsespolitikken er ugyldig:\n  - ${problems.join("\n  - ")}`);
  return policy;
}

export function policyProblems(policy) {
  const problems = [];
  if (policy?.kind !== "ProtectedDataPolicy") problems.push("kind skal være ProtectedDataPolicy");
  if (!policy?.metadata?.version) problems.push("metadata.version mangler");
  for (const cls of DATA_CLASSES) {
    if (!Array.isArray(policy?.agentOperationMatrix?.[cls])) problems.push(`agentOperationMatrix mangler klassen '${cls}'`);
  }
  if (policy?.reclassificationHumanOnly !== true) problems.push("reclassificationHumanOnly skal være true");
  if (policy?.noAiAccessDeniesAll !== true) problems.push("noAiAccessDeniesAll skal være true");
  if (!Array.isArray(policy?.aiForbiddenOperations) || !policy.aiForbiddenOperations.includes("reclassify")) {
    problems.push("aiForbiddenOperations skal mindst forbyde 'reclassify' for AI");
  }
  return problems;
}

export function loadRegister(path = registerPath, { ajv = buildAjv().ajv } = {}) {
  if (!existsSync(path)) throw new Error(`Mangler ${path}`);
  const register = JSON.parse(readFileSync(path, "utf8"));
  const { ok, errors } = validateProtectedData(register, ajv);
  if (!ok) {
    throw new Error(
      "protected-data-register matcher ikke kontrakten eller semantikken:\n" +
        errors.map((e) => `  ${(e.path || "/").trim()} ${e.message}`).join("\n")
    );
  }
  const problems = protectedDataProblems(register);
  if (problems.length) throw new Error(`Beskyttelsesregisteret er inkonsistent:\n  - ${problems.map((p) => `${p.path} ${p.message}`).join("\n  - ")}`);
  return register;
}

/**
 * Slå den beskyttelsespost op en target hører til. Rækkefølge: eksakt id,
 * autoritativ pointer (eller barn af den), forbruger-modul og til sidst en
 * normaliseret delstreng. Returnerer null hvis target ikke er beskyttet.
 */
export function resolveRecord(register, target) {
  const t = String(target ?? "").trim();
  if (!t) return null;
  for (const record of register?.records ?? []) {
    if (record.id === t) return record;
    if (record.authoritativePointer && (t === record.authoritativePointer || t.startsWith(`${record.authoritativePointer}/`))) return record;
  }
  const segments = t.split("/");
  for (const record of register?.records ?? []) {
    for (const consumer of record.consumerModules ?? []) {
      if (segments.includes(consumer)) return record;
    }
  }
  for (const record of register?.records ?? []) {
    if (t.includes(record.id)) return record;
  }
  return null;
}

export function createProtectedDataGuard({ register = loadRegister(), policy = loadPolicy() } = {}) {
  return {
    policy,
    register,
    resolve(target) {
      return resolveRecord(register, target);
    },
    /** Evaluer en operation mod en target (eller en eksplicit post). */
    evaluate({ principal, operation, target = null, record = null, destination = null, adapter = null } = {}) {
      const resolved = record ?? (target ? resolveRecord(register, target) : null);
      if (adapter) return guardAdapterCall({ adapter, principal, operation, record: resolved, destination, policy });
      return evaluateProtectedData({ principal, operation, record: resolved, destination, policy });
    },
    reclassify({ principal, record, newClass, newNoAiAccess = null }) {
      return authorizeReclassification({ principal, record, newClass, newNoAiAccess, policy });
    },
  };
}

/** Pilotmoduler: rigtige moduler, ikke den bevidst brudte fixture. */
export function pilotModules({ exclude = ["dummy-broken"] } = {}) {
  if (!existsSync(modulesDir)) return [];
  return readdirSync(modulesDir)
    .filter((name) => !exclude.includes(name) && existsSync(join(modulesDir, name, "module-manifest.json")))
    .sort()
    .map((name) => ({ name, manifest: JSON.parse(readFileSync(join(modulesDir, name, "module-manifest.json"), "utf8")) }));
}

export function loadRoutes(path = routesPath) {
  if (!existsSync(path)) return [];
  return (JSON.parse(readFileSync(path, "utf8")).routes ?? []).filter((r) => r.enabled !== false);
}

/**
 * Krydsreference: hver beskyttelsesposts consumerModules skal findes som et
 * rigtigt pilotmodul (eller en route), og hvert pilotmodul skal ærligt erklære
 * sin dataProtection-capability.
 */
export function checkModuleCoverage({ register = loadRegister(), modules = pilotModules(), routes = loadRoutes() } = {}) {
  const problems = [];
  const known = new Set([...modules.map((m) => m.name), ...routes.map((r) => r.id), ...routes.map((r) => r.agentRef)]);

  for (const record of register.records) {
    for (const ref of record.consumerModules ?? []) {
      if (!known.has(ref)) problems.push(`'${record.id}' peger på ukendt forbruger '${ref}' (hverken modul eller route)`);
    }
  }

  for (const mod of modules) {
    const dp = mod.manifest?.dataProtection;
    if (!dp) {
      problems.push(`pilotmodulet '${mod.name}' mangler en dataProtection-capability`);
      continue;
    }
    if (!Array.isArray(dp.supportedClasses) || dp.supportedClasses.length === 0) {
      problems.push(`'${mod.name}': dataProtection.supportedClasses er tom`);
    }
    if (!dp.storageEnforcement || !dp.storageEnforcement.status || !dp.storageEnforcement.reason) {
      problems.push(`'${mod.name}': dataProtection.storageEnforcement skal ærligt erklære status og begrundelse`);
    } else if (dp.storageEnforcement.status !== "full" && !dp.storageEnforcement.deliveredBy) {
      problems.push(`'${mod.name}': ikke-fuld lagerhåndhævelse skal angive hvem der leverer den (DKC-048)`);
    }
    if (dp.reclassificationRequiresHuman !== true) {
      problems.push(`'${mod.name}': dataProtection.reclassificationRequiresHuman skal være true`);
    }
  }
  return problems;
}

/** Er der stadig uafklaret lagerhåndhævelse? Returnerer de ærlige huller. */
export function storageEnforcementGaps({ register = loadRegister() } = {}) {
  return register.records
    .filter((r) => r.storageEnforcement?.status !== "full")
    .map((r) => ({ id: r.id, status: r.storageEnforcement?.status, deliveredBy: r.storageEnforcement?.deliveredBy ?? null, reason: r.storageEnforcement?.reason }));
}
