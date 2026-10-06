/**
 * DKC-014 — deterministisk SBOM-emitter fra filsystemet.
 *
 * SBOM'en læses fra de faktiske `package-lock.json`-filer og de faktiske
 * `package.json`-filer i træet. Den er deterministisk:
 *
 *   - komponenter sorteres på purl,
 *   - hash-værdier oversættes fra lockfilens `integrity` (base64) til hex,
 *   - tidsstemplet kommer fra `SOURCE_DATE_EPOCH` (default epoch), ikke fra
 *     vægurets tid,
 *   - serienummeret udledes af indholdet, så samme trægiver samme SBOM.
 *
 * Det er med vilje ikke en fuld CycloneDX-implementering; det er den delmængde
 * kontrakten `contracts/sbom.schema.json` kræver, så et artefakts indhold kan
 * genskabes og bindes til en digest.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { canonicalize, digestOfCanonical } from "./digest.mjs";

const SKIP_DIRS = new Set(["node_modules", ".git", ".conformance-out", "dist", "coverage"]);
const ROOT_COMPONENT = { name: "dkcompany-platform", version: "1.0.0" };

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** Konvertér en lockfil-`integrity` (`sha512-<base64>`) til et hex-hash. */
export function integrityToHash(integrity) {
  if (typeof integrity !== "string") return null;
  const match = /^(sha512|sha256)-(.+)$/.exec(integrity);
  if (!match) return null;
  const [, alg, base64] = match;
  const content = Buffer.from(base64, "base64").toString("hex");
  return { alg: alg === "sha512" ? "SHA-512" : "SHA-256", content };
}

/** Udled pakkenavnet fra en `node_modules/...`-nøgle i en lockfil. */
export function packageNameFromLockKey(key) {
  const marker = "node_modules/";
  const idx = key.lastIndexOf(marker);
  if (idx === -1) return null;
  const rest = key.slice(idx + marker.length);
  if (rest.startsWith("@")) {
    const [scope, name] = rest.split("/");
    return `${scope}/${name}`;
  }
  return rest.split("/")[0];
}

/** Førstepartskomponenter: hver `package.json` uden for node_modules. */
export function collectFirstPartyComponents(root) {
  const components = [];
  for (const file of walk(root)) {
    if (!file.endsWith("package.json")) continue;
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    if (!pkg.name || !pkg.version) continue;
    components.push({
      type: "application",
      name: pkg.name,
      group: "platform",
      version: pkg.version,
      "bom-ref": `pkg:platform/${pkg.name}@${pkg.version}`,
      purl: `pkg:platform/${pkg.name}@${pkg.version}`,
      source: relative(root, file),
    });
  }
  return components;
}

/** Tredjepartskomponenter fra samtlige lockfiler. */
export function collectLockComponents(root) {
  const components = [];
  for (const file of walk(root)) {
    if (!file.endsWith("package-lock.json")) continue;
    let lock;
    try {
      lock = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    for (const [key, entry] of Object.entries(lock.packages ?? {})) {
      if (key === "") continue;
      if (!key.includes("node_modules/")) continue;
      const name = entry.name ?? packageNameFromLockKey(key);
      const version = entry.version;
      if (!name || !version) continue;
      const component = {
        type: "library",
        name,
        group: "npm",
        version,
        "bom-ref": `pkg:npm/${name}@${version}`,
        purl: `pkg:npm/${name}@${version}`,
      };
      const hash = integrityToHash(entry.integrity);
      if (hash) component.hashes = [hash];
      components.push(component);
    }
  }
  return components;
}

function componentKey(component) {
  return `${component.purl ?? component["bom-ref"]}::${component.version}`;
}

function dedupe(components) {
  const byKey = new Map();
  for (const component of components) {
    const key = componentKey(component);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...component });
      continue;
    }
    if (!existing.hashes && component.hashes) existing.hashes = component.hashes;
    if (existing.source && !component.source) delete existing.source;
  }
  return [...byKey.values()];
}

/** Deterministisk UUID (version 5-format) udledt af SBOM-indholdet. */
export function serialNumberFor(components) {
  const hex = digestOfCanonical(components);
  const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  return `urn:uuid:${uuid}`;
}

function timestampFromEnv(env = process.env) {
  const epoch = Number(env.SOURCE_DATE_EPOCH ?? 0);
  const ms = Number.isFinite(epoch) && epoch > 0 ? epoch * 1000 : 0;
  return new Date(ms).toISOString();
}

/**
 * Byg SBOM'en. `timestamp` kan injiceres for tests; ellers bruges
 * `SOURCE_DATE_EPOCH` eller epoch, så resultatet er reproducerbart.
 */
export function emitSbom(root, { timestamp, rootComponent = ROOT_COMPONENT } = {}) {
  const components = dedupe([...collectFirstPartyComponents(root), ...collectLockComponents(root)])
    .map(({ source, ...rest }) => rest)
    .sort((a, b) => (a.purl ?? a["bom-ref"]).localeCompare(b.purl ?? b["bom-ref"]));
  const dependencies = components.map((c) => ({ ref: c["bom-ref"], dependsOn: [] }));
  return {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "Sbom",
    specVersion: "1.5",
    serialNumber: serialNumberFor(components),
    metadata: {
      timestamp: timestamp ?? timestampFromEnv(),
      component: {
        type: "application",
        name: rootComponent.name,
        version: rootComponent.version,
        "bom-ref": `pkg:platform/${rootComponent.name}@${rootComponent.version}`,
      },
      tools: [{ name: "dkcompany-supply-chain", version: "1.0.0" }],
    },
    components,
    dependencies,
  };
}

export function sbomDigest(sbom) {
  return digestOfCanonical(sbom);
}

export function loadSbom(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

export function readSbomPackageCount(sbom) {
  return (sbom?.components ?? []).length;
}

export function verifySbomSync(root, committed, { timestamp } = {}) {
  const expected = emitSbom(root, { timestamp });
  const problems = [];
  if (!committed) {
    problems.push("committed SBOM mangler");
    return { ok: false, problems, expected };
  }
  if (canonicalize(committed) !== canonicalize(expected)) {
    problems.push("committed SBOM er ude af trit med filsystemet; kør 'make supply-chain-sbom'");
  }
  return { ok: problems.length === 0, problems, expected };
}
