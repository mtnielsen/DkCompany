/**
 * DKC-056 — kanonisk registry for databaseprofiler, datakilder og bindinger.
 *
 * Registryet er versionsstyrede datafiler under `data-services/`. De valideres
 * mod kontrakterne og de semantiske regler i `conformance/src/data-services.mjs`
 * og krydsrefereres mod de rigtige pilotmoduler og mod hinanden, så en binding
 * ikke kan pege på en ukendt profil eller udvide en kildes scope.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAjv } from "../../conformance/src/schemas.mjs";
import { validateDatabaseProfile, validateDataSource, validateDataServiceBinding } from "../../conformance/src/data-services.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, "..", "..");
export const dataServicesDir = join(repoRoot, "data-services");
export const profilesDir = join(dataServicesDir, "profiles");
export const sourcesDir = join(dataServicesDir, "sources");
export const bindingsDir = join(dataServicesDir, "bindings");
export const modulesDir = join(repoRoot, "modules");

function readDir(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((file) => ({ file, path: join(dir, file), data: JSON.parse(readFileSync(join(dir, file), "utf8")) }));
}

export function loadProfiles(dir = profilesDir) {
  return readDir(dir);
}
export function loadSources(dir = sourcesDir) {
  return readDir(dir);
}
export function loadBindings(dir = bindingsDir) {
  return readDir(dir);
}

/** Pilotmoduler: rigtige moduler, ikke den bevidst brudte fixture. */
export function pilotModules({ exclude = ["dummy-broken"] } = {}) {
  if (!existsSync(modulesDir)) return [];
  return readdirSync(modulesDir)
    .filter((name) => !exclude.includes(name) && existsSync(join(modulesDir, name, "module-manifest.json")))
    .sort()
    .map((name) => ({ name, manifest: JSON.parse(readFileSync(join(modulesDir, name, "module-manifest.json"), "utf8")) }));
}

/**
 * Krydsreference og scope-kontrol. Returnerer en liste af problemer (tom =
 * konsistent). Bruges af `check.mjs`, conformance og installatøren.
 */
export function checkAll({ profiles = loadProfiles(), sources = loadSources(), bindings = loadBindings(), modules = pilotModules() } = {}) {
  const problems = [];
  const ajv = buildAjv().ajv;

  const profileIds = new Set();
  for (const entry of profiles) {
    const { ok, errors } = validateDatabaseProfile(entry.data, ajv);
    for (const error of errors) problems.push(`${entry.file}${error.path} ${error.message}`);
    if (ok) {
      if (profileIds.has(entry.data.metadata.name)) problems.push(`${entry.file}: dubleret profil-id '${entry.data.metadata.name}'`);
      profileIds.add(entry.data.metadata.name);
    }
  }

  const sourceMap = new Map();
  for (const entry of sources) {
    const { ok, errors } = validateDataSource(entry.data, ajv);
    for (const error of errors) problems.push(`${entry.file}${error.path} ${error.message}`);
    if (ok) {
      if (sourceMap.has(entry.data.metadata.name)) problems.push(`${entry.file}: dubleret datakilde-id '${entry.data.metadata.name}'`);
      sourceMap.set(entry.data.metadata.name, entry.data);
    }
  }

  const moduleNames = new Set(modules.map((m) => m.name));
  const seenBindings = new Set();
  for (const entry of bindings) {
    const { ok, errors } = validateDataServiceBinding(entry.data, ajv);
    for (const error of errors) problems.push(`${entry.file}${error.path} ${error.message}`);
    if (!ok) continue;
    if (seenBindings.has(entry.data.metadata.name)) problems.push(`${entry.file}: dubleret binding-id '${entry.data.metadata.name}'`);
    seenBindings.add(entry.data.metadata.name);

    if (!profileIds.has(entry.data.databaseProfileRef)) {
      problems.push(`${entry.file}: databaseProfileRef '${entry.data.databaseProfileRef}' findes ikke`);
    }
    if (!moduleNames.has(entry.data.application.ref)) {
      problems.push(`${entry.file}: applikationen '${entry.data.application.ref}' findes ikke som pilotmodul`);
    }
    for (const ref of entry.data.dataSourceRefs ?? []) {
      const source = sourceMap.get(ref.ref);
      if (!source) {
        problems.push(`${entry.file}: dataSourceRef '${ref.ref}' findes ikke`);
        continue;
      }
      const sourceSchemas = new Set(source.access.allowedSchemas);
      const sourceTables = new Set(source.access.allowedTables);
      for (const schema of ref.scope.allowedSchemas) {
        if (!sourceSchemas.has(schema)) problems.push(`${entry.file}: scopet omfatter schemaet '${schema}', som kilden '${ref.ref}' ikke tillader`);
      }
      for (const table of ref.scope.allowedTables) {
        if (!sourceTables.has(table)) problems.push(`${entry.file}: scopet omfatter tabellen '${table}', som kilden '${ref.ref}' ikke tillader`);
      }
    }
  }

  return problems;
}

export function loadAll() {
  return { profiles: loadProfiles(), sources: loadSources(), bindings: loadBindings(), modules: pilotModules() };
}
