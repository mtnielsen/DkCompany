import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve, isAbsolute } from "node:path";

export class ManifestError extends Error {}

/** Find den relative sti til et modul, uanset om der gives modulnavn eller sti. */
export function resolveModuleDir(repoRoot, ref) {
  const candidates = [
    isAbsolute(ref) ? ref : null,
    join(repoRoot, "modules", ref),
    join(repoRoot, ref),
  ].filter(Boolean);
  for (const c of candidates) {
    if (existsSync(join(c, "module-manifest.json"))) return c;
  }
  throw new ManifestError(
    `Kunne ikke finde module-manifest.json for '${ref}'. Prøvede:\n` +
      candidates.map((c) => `  - ${join(c, "module-manifest.json")}`).join("\n")
  );
}

export function loadModule(moduleDir) {
  const manifestPath = join(moduleDir, "module-manifest.json");
  if (!existsSync(manifestPath)) throw new ManifestError(`Mangler ${manifestPath}`);
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (err) {
    throw new ManifestError(`${manifestPath} er ikke gyldig JSON: ${err.message}`);
  }
  return { dir: resolve(moduleDir), manifestPath, manifest };
}

/** Løs en evidence-ref relativt til modulmappen, med værn mod path traversal. */
export function resolveEvidencePath(moduleDir, ref) {
  const p = resolve(moduleDir, ref);
  const root = resolve(moduleDir);
  if (p !== root && !p.startsWith(root + "/")) {
    throw new ManifestError(`Evidence-ref '${ref}' peger uden for modulet`);
  }
  return p;
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

const OPS_VERBS = [
  "backup",
  "restore",
  "verify-restore",
  "drain",
  "upgrade.dry-run",
  "upgrade",
  "migrate",
  "rollback",
  "health",
  "slo",
];

const PRIVACY_VERBS = [
  "subject.locate",
  "subject.export",
  "subject.erase",
  "subject.legal_hold",
  "retention.policy",
];

export const VERB_GROUPS = { ops: OPS_VERBS, privacy: PRIVACY_VERBS };

/** Flad liste af {verb, group, block} for alle deklarerede verber. */
export function declaredVerbs(manifest) {
  const out = [];
  for (const verb of OPS_VERBS) {
    const block = manifest?.verbs?.[verb];
    if (block) out.push({ verb, group: "ops", block });
  }
  for (const verb of PRIVACY_VERBS) {
    const block = manifest?.privacy?.[verb];
    if (block) out.push({ verb, group: "privacy", block });
  }
  return out;
}

/** Find CloudEvent-eksempler i modulets conformance/events-mappe. */
export function findEventExamples(moduleDir) {
  const dir = join(moduleDir, "conformance", "events");
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => ({ name: f, path: join(dir, f) }));
}

/** Find agent-manifester i modulets agents-mappe (hvis nogen). */
export function findAgentManifests(moduleDir) {
  const dir = join(moduleDir, "agents");
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => ({ name: f, path: join(dir, f) }));
}
