/**
 * DKC-007 — evidensreferencer slås op og bindes til digest/commit.
 *
 * Et bevis er ikke en tekstetikette. `"tests-pass"` i en task er en påstand,
 * som kalderen selv kan skrive. Runtimen kræver derfor en reference
 * (`evidenceIndex`) med en uri og en SHA-256, læser artefaktet og genberegner
 * digesten. Stemmer den ikke — eller mangler referencen — afvises handlingen.
 *
 * `policy-allow` er intrinsisk: det er selve den PDP-beslutning, runtimen
 * netop har valideret og bundet til input-digesten (se boundary.mjs).
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256Hex } from "./digest.mjs";

/** Bevislabels der ikke kan være intrinsiske og derfor kræver en reference. */
export const EXTERNAL_EVIDENCE_LABELS = ["tests-pass", "dry-run-clean", "rollback-tested", "restore-verified", "scan-clean"];

const STATUS_RULES = {
  "tests-pass": ["pass"],
  "dry-run-clean": ["clean", "pass"],
  "rollback-tested": ["pass", "clean"],
  "restore-verified": ["pass", "clean"],
  "scan-clean": ["clean", "pass"],
};

function toPath(uri, baseDir) {
  let p = String(uri);
  if (p.startsWith("file://")) p = fileURLToPath(p);
  if (!isAbsolute(p)) {
    if (!baseDir) throw new Error(`relativ bevis-uri '${uri}' kræver en baseDir`);
    p = resolve(baseDir, p);
  }
  if (baseDir) {
    const root = resolve(baseDir);
    const resolved = resolve(p);
    if (resolved !== root && !resolved.startsWith(root + "/")) {
      throw new Error(`bevis-uri '${uri}' peger uden for baseDir`);
    }
  }
  return p;
}

/** Standardloader: læs artefaktet fra filsystemet med path-traversal-værn. */
export function createFileArtifactLoader({ baseDir = null } = {}) {
  return (uri) => {
    const path = toPath(uri, baseDir);
    if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`bevis-artefaktet '${uri}' findes ikke`);
    return readFileSync(path);
  };
}

function statusOk(label, status) {
  const allowed = STATUS_RULES[label];
  if (!allowed) return true;
  return allowed.includes(status);
}

/**
 * Slå hver krævet bevislabel op i `index` og verificér digesten mod det
 * faktiske artefakt. Returnerer `{ ok, verified, problems }`.
 */
export function verifyEvidenceReferences({ labels = [], index = {}, artifactLoader = null, changeDigest = null } = {}) {
  const verified = {};
  const problems = [];
  for (const label of labels) {
    if (label === "policy-allow") {
      verified[label] = { label, intrinsic: true, source: "pdp-decision" };
      continue;
    }
    const entry = index?.[label];
    if (!entry || typeof entry !== "object") {
      problems.push({ label, problem: `beviset '${label}' er en tekstetikette uden en verificerbar reference` });
      continue;
    }
    if (!/^[a-f0-9]{64}$/.test(entry.sha256 ?? "")) {
      problems.push({ label, problem: `beviset '${label}' mangler en SHA-256` });
      continue;
    }
    if (!statusOk(label, entry.status)) {
      problems.push({ label, problem: `beviset '${label}' har status '${entry.status ?? "?"}' — kræver ${STATUS_RULES[label].join("/")}` });
      continue;
    }
    if (entry.commit !== undefined && !/^[a-f0-9]{40}$/.test(entry.commit)) {
      problems.push({ label, problem: `beviset '${label}' har en ugyldig commit '${entry.commit}'` });
      continue;
    }
    if (changeDigest && entry.digest !== undefined && entry.digest !== changeDigest) {
      problems.push({ label, problem: `beviset '${label}' er bundet til en anden ændring end handlingen` });
      continue;
    }
    if (artifactLoader) {
      let bytes;
      try {
        bytes = artifactLoader(entry.uri);
      } catch (err) {
        problems.push({ label, problem: `beviset '${label}' kunne ikke læses: ${err.message}` });
        continue;
      }
      const actual = sha256Hex(Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes)));
      if (actual !== entry.sha256) {
        problems.push({ label, problem: `bevisets digest matcher ikke (forventet ${entry.sha256.slice(0, 12)}…, fik ${actual.slice(0, 12)}…)` });
        continue;
      }
      verified[label] = { label, uri: entry.uri, sha256: actual, commit: entry.commit ?? null, status: entry.status ?? null };
      continue;
    }
    verified[label] = { label, uri: entry.uri, sha256: entry.sha256, commit: entry.commit ?? null, status: entry.status ?? null };
  }
  return { ok: problems.length === 0, verified, problems };
}
