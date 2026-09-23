import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { digestOf } from "../../policy/pdp/src/crypto.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, "..", "..");

const REQUIRED_LABELS = [
  "app.kubernetes.io/name",
  "app.kubernetes.io/managed-by",
  "platform.example.org/module",
  "platform.example.org/environment",
];
const ALLOWED_NAMESPACES = new Set(["platform", "argocd"]);
const IMAGE_DIGEST = /@sha256:[a-f0-9]{64}$/;

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function loadJsonDir(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => ({ file: f, path: join(dir, f), data: readJson(join(dir, f)) }));
}

export function loadManifests(root = repoRoot, env = "dev") {
  return loadJsonDir(join(root, "gitops", "manifests", env));
}

export function loadApplications(root = repoRoot) {
  return loadJsonDir(join(root, "gitops", "apps"));
}

function isDeployment(r) {
  return r.kind === "Deployment";
}

export function runVerify(root = repoRoot, { excludeModules = [] } = {}) {
  const manifests = loadManifests(root);
  const applications = loadApplications(root);
  const resources = manifests.map((m) => m.data);
  const checks = [];
  const add = (id, title, status, detail, messages = []) => checks.push({ id, title, status, detail, messages });

  // G-001 — hvert rigtigt modul skal have en Application og en Deployment i git.
  {
    const modulesDir = join(root, "modules");
    const modules = existsSync(modulesDir)
      ? readdirSync(modulesDir).filter((d) => existsSync(join(modulesDir, d, "module-manifest.json")) && !excludeModules.includes(d))
      : [];
    const messages = [];
    for (const mod of modules) {
      const app = applications.find((a) => a.data.metadata?.labels?.["platform.example.org/module"] === mod);
      if (!app) messages.push(`${mod}: ingen Argo CD Application i gitops/apps`);
      const dep = resources.find((r) => r.metadata?.labels?.["platform.example.org/module"] === mod && isDeployment(r));
      if (!dep) messages.push(`${mod}: ingen Deployment i gitops/manifests`);
    }
    add("G-001", "Alle moduler er GitOps-styret", messages.length ? "fail" : "pass", `${modules.length} moduler`, messages);
  }

  // G-002 — images pinnet på digest.
  {
    const messages = [];
    for (const m of manifests) {
      for (const c of m.data.spec?.template?.spec?.containers ?? []) {
        if (/:latest$/.test(c.image) || !IMAGE_DIGEST.test(c.image)) {
          messages.push(`${m.file}: container '${c.name}' image er ikke pinnet på digest (${c.image})`);
        }
      }
    }
    add("G-002", "Alle container-images er pinnet på digest", messages.length ? "fail" : "pass", `${manifests.length} manifester`, messages);
  }

  // G-003 — obligatoriske labels.
  {
    const messages = [];
    for (const m of manifests) {
      for (const label of REQUIRED_LABELS) {
        if (!m.data.metadata?.labels?.[label]) messages.push(`${m.file}: mangler label '${label}'`);
      }
    }
    add("G-003", "Obligatoriske labels på alle ressourcer", messages.length ? "fail" : "pass", `${REQUIRED_LABELS.length} labels`, messages);
  }

  // G-004 — Argo CD skal selvhele og prune.
  {
    const messages = [];
    for (const a of applications) {
      const auto = a.data.spec?.syncPolicy?.automated;
      if (!auto) messages.push(`${a.file}: mangler automated syncPolicy`);
      else {
        if (auto.selfHeal !== true) messages.push(`${a.file}: selfHeal er ikke slået til`);
        if (auto.prune !== true) messages.push(`${a.file}: prune er ikke slået til`);
        if (auto.allowEmpty !== false) messages.push(`${a.file}: allowEmpty skal være false`);
      }
    }
    add("G-004", "Argo CD selfHeal + prune (drift fjernes)", messages.length ? "fail" : "pass", `${applications.length} applikationer`, messages);
  }

  // G-005 — containerhardening.
  {
    const messages = [];
    for (const m of manifests) {
      if (!isDeployment(m.data)) continue;
      const pod = m.data.spec?.template?.spec;
      if (pod?.securityContext?.runAsNonRoot !== true) messages.push(`${m.file}: pod securityContext.runAsNonRoot mangler`);
      for (const c of pod?.containers ?? []) {
        const sc = c.securityContext ?? {};
        if (sc.allowPrivilegeEscalation !== false) messages.push(`${m.file}/${c.name}: allowPrivilegeEscalation skal være false`);
        if (sc.readOnlyRootFilesystem !== true) messages.push(`${m.file}/${c.name}: readOnlyRootFilesystem skal være true`);
        if (!sc.capabilities?.drop?.includes("ALL")) messages.push(`${m.file}/${c.name}: capabilities.drop skal indeholde ALL`);
      }
    }
    add("G-005", "Containere er hærdet (non-root, read-only, drop ALL)", messages.length ? "fail" : "pass", "", messages);
  }

  // G-006 — PDP'ens bundne bundle og fail-closed skal matche den signerede bundle.
  {
    const messages = [];
    const cm = resources.find((r) => r.kind === "ConfigMap" && r.metadata?.name === "pdp-bundle");
    if (!cm) messages.push("ConfigMap 'pdp-bundle' mangler");
    else {
      if (cm.data?.failMode !== "closed") messages.push("pdp-bundle.failMode skal være 'closed'");
      const bundlePath = join(root, "policy", "bundles", cm.data?.bundleName ?? "platform", cm.data?.bundleVersion ?? "1.0.0", "bundle.json");
      if (!existsSync(bundlePath)) messages.push(`bundle findes ikke: ${bundlePath}`);
      else {
        const digest = digestOf(readJson(bundlePath));
        if (cm.data?.bundleSha256 !== digest) messages.push("pdp-bundle.bundleSha256 matcher ikke den signerede bundle");
      }
    }
    add("G-006", "PDP kører fail-closed på signeret bundle", messages.length ? "fail" : "pass", "", messages);
  }

  // G-007 — ingen privilegerede namespaces.
  {
    const messages = [];
    for (const m of manifests) {
      const ns = m.data.metadata?.namespace;
      if (ns && !ALLOWED_NAMESPACES.has(ns)) messages.push(`${m.file}: namespace '${ns}' er ikke tilladt`);
    }
    add("G-007", "Ingen ressourcer i privilegerede namespaces", messages.length ? "fail" : "pass", `tilladte: ${[...ALLOWED_NAMESPACES].join(", ")}`, messages);
  }

  // G-008 — Application-stier skal findes.
  {
    const messages = [];
    for (const a of applications) {
      const p = a.data.spec?.source?.path;
      if (p && !existsSync(join(root, p))) messages.push(`${a.file}: source.path '${p}' findes ikke`);
      if (!a.data.spec?.source?.targetRevision) messages.push(`${a.file}: targetRevision mangler`);
    }
    add("G-008", "Application-kilder peger på eksisterende stier", messages.length ? "fail" : "pass", "", messages);
  }

  const failed = checks.filter((c) => c.status === "fail");
  return { status: failed.length ? "fail" : "pass", checks, summary: { pass: checks.length - failed.length, fail: failed.length, total: checks.length } };
}
