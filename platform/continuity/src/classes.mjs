/**
 * DKC-037 — indlæsning og validering af serviceklasser.
 *
 * Serviceklasserne er versionsstyrede datafiler under
 * `continuity/service-classes/`. De valideres mod `service-class.schema.json`
 * og de semantiske regler i `conformance/src/service-classes.mjs`, så modulet,
 * conformance-suiten og installeren bruger præcis samme regel.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateServiceClass } from "../../conformance/src/service-classes.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, "..", "..");
export const serviceClassesDir = join(repoRoot, "continuity", "service-classes");
export const modulesDir = join(repoRoot, "modules");
export const deploymentProfilesDir = join(repoRoot, "contracts", "examples");

/** Pilotmoduler: rigtige moduler, ikke den bevidst brudte fixture. */
export function pilotModules({ exclude = ["dummy-broken"] } = {}) {
  if (!existsSync(modulesDir)) return [];
  return readdirSync(modulesDir)
    .filter((name) => !exclude.includes(name) && existsSync(join(modulesDir, name, "module-manifest.json")))
    .sort()
    .map((name) => ({ name, manifestPath: join(modulesDir, name, "module-manifest.json"), manifest: JSON.parse(readFileSync(join(modulesDir, name, "module-manifest.json"), "utf8")) }));
}

export function loadServiceClasses(dir = serviceClassesDir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".service-class.json"))
    .sort()
    .map((file) => {
      const path = join(dir, file);
      return { file, path, data: JSON.parse(readFileSync(path, "utf8")) };
    });
}

export function validateServiceClasses(dir = serviceClassesDir) {
  return loadServiceClasses(dir).map(({ file, data }) => {
    const { ok, errors } = validateServiceClass(data);
    return { file, moduleRef: data?.moduleRef ?? null, ok, errors };
  });
}

/**
 * Bind hvert pilotmodul til en serviceklasse. Et modul kan referere til sin
 * klasse med `serviceClassRef`; ellers matches på `moduleRef`.
 */
export function checkModuleCoverage({ modules = pilotModules(), serviceClasses = loadServiceClasses() } = {}) {
  const problems = [];
  const byModule = new Map();
  for (const sc of serviceClasses) {
    const ref = sc.data?.moduleRef;
    if (!ref) continue;
    if (byModule.has(ref)) problems.push(`${sc.file}: flere serviceklasser peger på modulet '${ref}'`);
    byModule.set(ref, sc);
  }

  for (const mod of modules) {
    const sc = byModule.get(mod.name);
    if (!sc) {
      problems.push(`${mod.name}: pilotmodul uden serviceklasse — serviceklassen kan ikke udledes implicit`);
      continue;
    }
    const declaredRef = mod.manifest?.serviceClassRef;
    if (declaredRef && !declaredRef.endsWith(sc.file) && !declaredRef.endsWith(`${mod.name}.service-class.json`)) {
      problems.push(`${mod.name}: serviceClassRef '${declaredRef}' peger ikke på '${sc.file}'`);
    }
    if (sc.data?.deploymentProfileCompatibility?.profiles?.length === 0) {
      problems.push(`${sc.file}: mangler kompatible deployment-profiler`);
    }
  }

  for (const [ref, sc] of byModule) {
    if (!modules.some((m) => m.name === ref)) {
      problems.push(`${sc.file}: moduleRef '${ref}' matcher ikke et pilotmodul`);
    }
  }
  return problems;
}
