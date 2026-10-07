/**
 * 3.1 — Indsamling af de artefakter OSCAL-emitteren bygger på:
 * konformansrapporten, verbums-beviser, PDP-beslutninger, audit-hændelser,
 * git change loggen og GitOps-gate-resultaterne.
 *
 * Indsamlingen er adskilt fra builderen, så testene kan injicere kendte
 * artefakter og få et deterministisk dokument.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { declaredVerbs, resolveEvidencePath, readJson } from "../../conformance/src/manifest.mjs";
import { runVerify } from "../../gitops/src/verify.mjs";
import { generateChangelog } from "../../gitops/src/changelog.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, "..", "..");

/** Relativ, POSIX-venlig sti fra repo-roden — den form en OSCAL href bruger. */
function repoRef(root, path) {
  return relative(root, path).split("\\").join("/");
}

export function loadConformanceReport(root = repoRoot, path = ".conformance-out/report.json") {
  const full = join(root, path);
  if (!existsSync(full)) {
    throw new Error(`Konformansrapporten mangler: ${path}. Kør 'make conform-all' først.`);
  }
  return readJson(full);
}

/** 3.4 — Den normaliserede sikkerhedspakke, hvis den findes. */
export function loadSecurityFindings(root = repoRoot) {
  const path = join(root, "security", "generated", "security-findings.json");
  return existsSync(path) ? readJson(path) : null;
}

function readEvents(dir) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => join(dir, f));
}

function collectModule(root, report) {
  const moduleDir = join(root, "modules", report.module);
  const manifestPath = join(moduleDir, "module-manifest.json");
  const manifest = existsSync(manifestPath) ? readJson(manifestPath) : null;

  const evidence = [];
  if (manifest) {
    for (const { verb, block } of declaredVerbs(manifest)) {
      if (block.conformance !== "full" || block.evidence?.kind !== "fixture") continue;
      try {
        const path = resolveEvidencePath(moduleDir, block.evidence.ref);
        if (!existsSync(path)) continue;
        evidence.push({ verb, ref: repoRef(root, path), data: readJson(path) });
      } catch {
        // C-004 fanger manglende/ugyldige beviser; emitteren springer dem over.
      }
    }
  }

  const events = readEvents(join(moduleDir, "conformance", "events")).map((path) => ({
    ref: repoRef(root, path),
    data: readJson(path),
  }));

  let decision = null;
  const ref = manifest?.policy?.evidence;
  if (ref?.kind === "fixture") {
    try {
      const path = resolveEvidencePath(moduleDir, ref.ref);
      if (existsSync(path)) decision = { ref: repoRef(root, path), data: readJson(path) };
    } catch {
      // Uden en læsbar PDP-beslutning udelader vi observationen frem for at gætte.
    }
  }

  return { name: report.module, version: report.version, manifest, report, evidence, events, decision };
}

/**
 * Læser alle artefakter fra repoet. Kaster hvis konformansrapporten mangler,
 * for et evidensdokument uden konformansresultater er værre end ingen.
 */
export function collect({ root = repoRoot, generatedAt = new Date().toISOString() } = {}) {
  const conformance = loadConformanceReport(root);
  const modules = conformance.reports.map((report) => collectModule(root, report));
  const gitops = runVerify(root, { excludeModules: ["dummy-broken"] });
  const changelog = generateChangelog({ cwd: root });
  return { modules, gitops, changelog, security: loadSecurityFindings(root), generatedAt, conformance };
}
