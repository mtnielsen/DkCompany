/**
 * DKC-053 — indlæsning af kataloget: komponentmanifester, installationsprofiler,
 * platformmatrix og de DKC-002 deployment-profiler profilerne bygger på.
 *
 * Kataloget er versionsstyrede datafiler. De valideres mod kontrakterne og de
 * semantiske regler i `conformance/src/distribution.mjs`, så installatøren og
 * conformance-suiten bruger præcis samme regel.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, "..", "..");
export const catalogDir = join(repoRoot, "catalog");
export const componentsDir = join(catalogDir, "components");
export const profilesDir = join(catalogDir, "profiles");
export const platformsFile = join(catalogDir, "platforms.json");
export const deploymentProfilesDir = join(repoRoot, "contracts", "examples");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Indlæs alle komponentmanifester. */
export function loadComponents(dir = componentsDir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".component.json"))
    .sort()
    .map((file) => ({ file, path: join(dir, file), data: readJson(join(dir, file)) }));
}

/** Indlæs alle installationsprofiler. */
export function loadProfiles(dir = profilesDir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".profile.json"))
    .sort()
    .map((file) => ({ file, path: join(dir, file), data: readJson(join(dir, file)) }));
}

/** Indlæs platformmatricen. */
export function loadPlatforms(file = platformsFile) {
  if (!existsSync(file)) return { file: null, data: null, platforms: [] };
  const data = readJson(file);
  return { file, data, platforms: data.platforms ?? [] };
}

/** Indlæs DKC-002 deployment-profiler (kun eksempelfilerne). */
export function loadDeploymentProfiles(dir = deploymentProfilesDir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^deployment-profile\..*\.example\.json$/.test(f))
    .sort()
    .map((file) => ({ file, path: join(dir, file), data: readJson(join(dir, file)) }));
}

/** Komponent-id → liste af tilgængelige versioner (højeste sidst). */
export function indexById(components) {
  const index = new Map();
  for (const entry of components) {
    const data = entry.data ?? entry;
    const id = data.metadata?.name;
    if (!id) continue;
    if (!index.has(id)) index.set(id, []);
    index.get(id).push({ ...entry, data });
  }
  return index;
}

/** Alle komponenter med securityCore: true. */
export function securityCoreIds(components) {
  return components
    .filter((c) => (c.data ?? c).securityCore === true)
    .map((c) => (c.data ?? c).metadata.name)
    .sort();
}

/**
 * Integritetsproblemer i selve kataloget (uafhængigt af en konkret profil):
 * duplikerede id+version, referencer der ikke findes, manglende provider af en
 * påkrævet datatjeneste, manglende sikkerhedskerne og uverificerede downloads.
 */
export function catalogIntegrityProblems(components) {
  const problems = [];
  const index = indexById(components);

  const keys = new Set();
  for (const entry of components) {
    const data = entry.data ?? entry;
    const id = data.metadata?.name;
    const version = data.metadata?.version;
    const key = `${id}@${version}`;
    if (keys.has(key)) problems.push(`${entry.file ?? id}: dubleret komponentversion ${key}`);
    keys.add(key);

    for (const dep of [...(data.requires ?? []), ...(data.optionalRequires ?? [])]) {
      if (!index.has(dep.ref)) problems.push(`${id}: afhængighed '${dep.ref}' findes ikke i kataloget`);
    }
    for (const conflict of data.conflicts ?? []) {
      if (!index.has(conflict.ref) && conflict.ref !== id) problems.push(`${id}: konflikt '${conflict.ref}' findes ikke i kataloget`);
    }
    for (const dl of data.download ?? []) {
      if (dl.verified !== true) problems.push(`${id}: artefaktet '${dl.artifact}' er ikke verificeret`);
    }
    for (const ds of data.dataServices ?? []) {
      if (ds.required !== true) continue;
      const provider = [...index.values()].flat().some((c) => (c.data.provides?.dataServices ?? []).some((p) => p.id === ds.id && p.kind === ds.kind));
      if (!provider) problems.push(`${id}: påkrævet datatjeneste '${ds.id}' (${ds.kind}) har ingen provider i kataloget`);
    }
  }

  if (securityCoreIds(components).length === 0) {
    problems.push("kataloget har ingen obligatoriske sikkerhedskerne-komponenter (securityCore: true)");
  }
  return problems;
}
