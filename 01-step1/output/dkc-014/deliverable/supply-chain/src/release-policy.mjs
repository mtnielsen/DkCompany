/**
 * DKC-014 — releasepolitik: branch protection, CODEOWNERS og artefaktmanifest.
 *
 * Modulet samler de regler der beskytter releasevejen:
 *
 *   - branch protection kræver pull request, CODEOWNERS-review, DCO-sign-off
 *     og kendte statuskontroller og må ikke påstå kryptografisk
 *     commitsignering,
 *   - en ændring i en beskyttet sti kan ikke godkendes af en agent og ikke af
 *     forfatteren selv,
 *   - et artefaktmanifest genereres deterministisk fra containerkataloget og
 *     SBOM'en, og et deployet image skal matche et signeret artefakt.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { isPlaceholderSha256, parseImageRef } from "./digest.mjs";
import { trustAnchorMap, verifyArtifact } from "./signature.mjs";
import { checkContainers } from "./containers.mjs";
import { validateArtifactManifest, validateBranchProtection } from "../../conformance/src/supply-chain.mjs";
import { CHECKS } from "../../tools/baseline/registry.mjs";

export const BRANCH_PROTECTION_PATH = "security/branch-protection.json";
export const CODEOWNERS_PATH = ".github/CODEOWNERS";
export const TRUST_KEYS_PATH = "release/trust/release-keys.json";

/** Roller der aldrig må godkende (jf. DKC-055). */
export const AI_ROLES = new Set(["observer", "planner", "implementer", "verifier", "executor", "auditor", "approver-agent", "ai-approver"]);

export function loadBranchProtection(root) {
  const path = join(root, BRANCH_PROTECTION_PATH);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

export function loadTrustKeys(root) {
  const path = join(root, TRUST_KEYS_PATH);
  if (!existsSync(path)) return { keys: [] };
  return JSON.parse(readFileSync(path, "utf8"));
}

export function readCodeowners(root) {
  const path = join(root, CODEOWNERS_PATH);
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8");
}

/** Parse CODEOWNERS til regler. Sidste matchende regel vinder, som git gør. */
export function parseCodeowners(text) {
  const rules = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const tokens = line.split(/\s+/);
    const pattern = tokens.shift();
    const owners = tokens.filter((t) => t.startsWith("@"));
    rules.push({ pattern, owners });
  }
  return rules;
}

export function patternToRegex(pattern) {
  let p = pattern;
  let anchored = false;
  if (p.startsWith("/")) {
    p = p.slice(1);
    anchored = true;
  }
  const directory = p.endsWith("/");
  if (directory) p = p.slice(0, -1);
  let body = "";
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "*") {
      if (p[i + 1] === "*") {
        body += ".*";
        i += 1;
      } else {
        body += "[^/]*";
      }
    } else if (c === "?") {
      body += ".";
    } else {
      body += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  if (directory) body += "(?:/.*)?";
  const source = anchored || p.includes("/") ? `^${body}$` : `(?:^|/)${body}$`;
  return new RegExp(source);
}

/** Ejere for en sti; tom liste hvis ingen regel matcher. */
export function ownersFor(path, rules) {
  let owners = [];
  for (const rule of rules) {
    if (patternToRegex(rule.pattern).test(path)) owners = rule.owners;
  }
  return owners;
}

/**
 * Kontrollér branch protection, CODEOWNERS-dækning og at ingen agent kan være
 * ejer. Returnerer en liste af problemer.
 */
export function checkReleaseProtection(root, { checkIds = new Set(CHECKS.map((c) => c.id)) } = {}) {
  const problems = [];
  const config = loadBranchProtection(root);
  if (!config) return { ok: false, problems: [`${BRANCH_PROTECTION_PATH} mangler`] };
  const validation = validateBranchProtection(config, undefined, { checkIds });
  for (const e of validation.errors) problems.push(`${BRANCH_PROTECTION_PATH}${e.path}: ${e.message}`);

  const codeownersText = readCodeowners(root);
  if (!codeownersText) {
    problems.push(`${CODEOWNERS_PATH} mangler`);
    return { ok: problems.length === 0, problems };
  }
  const rules = parseCodeowners(codeownersText);
  for (const path of config.protectedPaths ?? []) {
    const owners = ownersFor(path, rules);
    if (owners.length === 0) problems.push(`${CODEOWNERS_PATH}: den beskyttede sti '${path}' har ingen ejere`);
    for (const owner of owners) {
      if (/agent|bot|app/i.test(owner)) problems.push(`${CODEOWNERS_PATH}: '${owner}' ser ud som en agent og må ikke eje en beskyttet sti`);
    }
  }
  return { ok: problems.length === 0, problems, rules, config };
}

/**
 * Afgør om en ændring i beskyttede stier er godkendt forsvarligt.
 *
 *   change.author   = { subject, kind, role }
 *   change.paths    = ["policy/bundles/...", ...]
 *   approvals       = [{ subject, kind, role, handle, verdict }]
 *
 * Regler: en agent må ikke godkende; forfatteren må ikke godkende sin egen
 * ændring; hver beskyttet sti kræver en godkender der er CODEOWNER for stien.
 */
export function evaluateProtectedChange(change, approvals = [], { protectedPaths = [], codeownersRules = [] } = {}) {
  const reasons = [];
  const paths = change?.paths ?? [];
  const isProtected = (path) =>
    (protectedPaths ?? []).some((prefix) => path === prefix || path.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`) || path === prefix.replace(/\/$/, ""));
  const protectedTouched = paths.filter(isProtected);
  const author = change?.author ?? { subject: null, kind: "human", role: null };

  const perPathOwners = new Map();
  for (const path of protectedTouched) {
    const owners = ownersFor(path, codeownersRules);
    perPathOwners.set(path, owners);
    const approved = approvals.some((a) => {
      if (a.verdict !== "approve") return false;
      if (a.subject === author.subject) return false;
      if (a.kind === "agent" || AI_ROLES.has(a.role)) return false;
      return owners.some((owner) => owner === `@${a.handle}` || owner === a.subject);
    });
    if (!approved) reasons.push(`den beskyttede sti '${path}' mangler en godkendelse fra en navngivet CODEOWNER`);
  }

  for (const a of approvals) {
    if (a.verdict !== "approve") continue;
    if (a.kind === "agent" || AI_ROLES.has(a.role)) reasons.push(`godkenderen '${a.subject}' er en agent og må ikke godkende`);
    if (a.subject === author.subject) reasons.push(`godkenderen '${a.subject}' kan ikke godkende sin egen ændring`);
  }

  return {
    ok: reasons.length === 0,
    reasons,
    protectedPaths: protectedTouched,
    requiredOwners: [...new Set([...perPathOwners.values()].flat())],
  };
}

/* -------------------------------------------------------------------------- */
/* Artefaktmanifest                                                           */
/* -------------------------------------------------------------------------- */

export function generateArtifactManifest(root, { sourceCommit, sbomRef, sbomDigest, builtAt = "1970-01-01T00:00:00.000Z" }) {
  const { catalog } = checkContainers(root);
  const trustKeys = loadTrustKeys(root);
  const artifacts = [
    {
      name: "platform-sbom",
      type: "sbom",
      status: "built-unsigned",
      reason: "SBOM'en genereres deterministisk lokalt; releasesignaturnøglen ligger i CI-hemmeligheden og er ikke tilgængelig i dette miljø.",
      builder: "supply-chain/src/sbom.mjs",
      sourceCommit,
      builtAt,
      digest: sbomDigest,
      signature: null,
      sbom: { ref: sbomRef, sha256: sbomDigest },
      provenance: null,
    },
  ];
  for (const entry of catalog.images ?? []) {
    artifacts.push({
      name: entry.repository,
      type: "container-image",
      status: "not-built",
      reason: "Docker er ikke tilgængelig i dette miljø; containerbilledet kan ikke bygges eller signeres her.",
      repository: entry.repository,
      builder: entry.dockerfile,
      sourceCommit,
      digest: null,
      signature: null,
      sbom: null,
      provenance: null,
    });
  }
  return {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "ArtifactManifest",
    metadata: {
      name: "platform-release-artifacts",
      version: "1.0.0",
      description: "Den kanoniske fortegnelse over hvilke artefakter CI har bygget, deres digests og hvilken signatur der dækker dem.",
      accountableHuman: { subject: "oidc|anna.andersen", name: "Anna Andersen", role: "Platform Owner" },
    },
    sourceCommit,
    trustAnchor: { keys: trustKeys.keys ?? [] },
    policy: { requirePinnedDigest: true, requireSignature: true, requireSbom: true, requireProvenance: true },
    artifacts,
  };
}

/**
 * Verificér at hvert deployet image matcher et signeret artefakt. Et
 * pladsholder-digest eller et usigneret image afvises.
 */
export function verifyDeployments(root, manifest) {
  const problems = [];
  const byRepository = new Map();
  for (const artifact of manifest.artifacts ?? []) {
    if (artifact.repository) byRepository.set(artifact.repository, artifact);
  }
  const keys = trustAnchorMap(manifest);
  const manifestsDir = join(root, "gitops", "manifests", "dev");
  if (!existsSync(manifestsDir)) return { ok: false, problems: ["gitops/manifests/dev findes ikke"] };

  const deployed = [];
  for (const file of readdirJson(manifestsDir)) {
    const data = JSON.parse(readFileSync(join(manifestsDir, file), "utf8"));
    for (const container of data.spec?.template?.spec?.containers ?? []) {
      deployed.push({ file, image: container.image, name: container.name });
    }
  }

  for (const { file, image, name } of deployed) {
    let parsed;
    try {
      parsed = parseImageRef(image);
    } catch (err) {
      problems.push(`${file}: container '${name}' har en ugyldig image-referencer (${err.message})`);
      continue;
    }
    if (!parsed.pinned) {
      problems.push(`${file}: container '${name}' er ikke pinnet på digest (${image})`);
      continue;
    }
    if (isPlaceholderSha256(parsed.digest)) {
      problems.push(`${file}: container '${name}' bærer en pladsholder-digest (${image})`);
      continue;
    }
    const artifact = byRepository.get(parsed.repository);
    if (!artifact) continue; // tredjepartsimage med rigtig digest
    if (artifact.status !== "signed") {
      problems.push(`${file}: container '${name}' bruger '${parsed.repository}' der ikke er et signeret artefakt (status '${artifact.status}')`);
      continue;
    }
    if (artifact.digest !== parsed.digest) {
      problems.push(`${file}: container '${name}' digest matcher ikke det byggede artefakt for '${parsed.repository}'`);
      continue;
    }
    const publicKeyPem = keys.get(artifact.signature?.keyId);
    if (!publicKeyPem) {
      problems.push(`${file}: container '${name}' er signeret med en ukendt nøgle`);
      continue;
    }
    const verified = verifyArtifact(publicKeyPem, artifact, artifact.signature);
    if (!verified.ok) problems.push(`${file}: container '${name}' signatur afvises: ${verified.reason}`);
  }
  return { ok: problems.length === 0, problems, deployed: deployed.length };
}

function readdirJson(dir) {
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).sort() : [];
}

export function checkArtifactManifest(root, manifest, { sbomDigest } = {}) {
  const problems = [];
  const validation = validateArtifactManifest(manifest);
  for (const e of validation.errors) problems.push(`release/artifacts.json${e.path}: ${e.message}`);
  if (sbomDigest) {
    const sbom = (manifest?.artifacts ?? []).find((a) => a.type === "sbom");
    if (!sbom) problems.push("release/artifacts.json: der mangler et SBOM-artefakt");
    else if (sbom.digest !== sbomDigest) problems.push("release/artifacts.json: SBOM-digesten matcher ikke den genererede SBOM");
  }
  return { ok: problems.length === 0, problems };
}
