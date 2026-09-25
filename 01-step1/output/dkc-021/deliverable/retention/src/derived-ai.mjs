/**
 * DKC-021 — afledt AI-lager (prompts og embeddings).
 *
 * Afledte AI-data er en selvstændig datalag: embeddings og promptkopier kan
 * overleve sletningen af det autoritative objekt, og de kan være sendt videre
 * til en leverandør. Dette lager er platformens lokale kopi; det er
 * tenant-bundet og indekseret på subjektets digest, så en DSAR kan fjerne præcis
 * subjektets afledte data uden at røre andres.
 *
 * Den eksterne leverandørkopi kan ikke slettes herfra. Det rapporteres ærligt af
 * `surfaces.mjs` som en resterende kopi med begrundelse og udløb.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { normalizeTenantId } from "../../identity/src/tenant.mjs";

export class DerivedAiError extends Error {
  constructor(message, code = "derived_ai_error") {
    super(message);
    this.name = "DerivedAiError";
    this.code = code;
  }
}

const DIGEST_RE = /^[a-f0-9]{64}$/;
const keyHash = (key) => createHash("sha256").update(String(key)).digest("hex");

export function createDerivedAiStore({ rootDir } = {}) {
  if (!rootDir) throw new DerivedAiError("createDerivedAiStore kræver en rootDir", "missing_root");
  const dirFor = (tenantId, subjectDigest) => join(rootDir, normalizeTenantId(tenantId), subjectDigest);

  return {
    kind: "derived-ai-store",
    rootDir,

    put(tenantIdRaw, subjectDigest, key, value, { now = Date.now() } = {}) {
      if (!DIGEST_RE.test(String(subjectDigest ?? ""))) throw new DerivedAiError("put kræver subjektets SHA-256-digest", "bad_digest");
      const tenantId = normalizeTenantId(tenantIdRaw);
      const dir = dirFor(tenantId, subjectDigest);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${keyHash(key)}.json`), JSON.stringify({ tenantId, subjectDigest, key, value, derivedAt: new Date(now).toISOString() }));
      return { tenantId, subjectDigest, key };
    },

    list(tenantIdRaw, subjectDigest) {
      const tenantId = normalizeTenantId(tenantIdRaw);
      const dir = dirFor(tenantId, subjectDigest);
      if (!existsSync(dir)) return [];
      return readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .sort()
        .map((f) => {
          try {
            const parsed = JSON.parse(readFileSync(join(dir, f), "utf8"));
            return { key: parsed.key, derivedAt: parsed.derivedAt };
          } catch {
            return { key: f.replace(/\.json$/, ""), derivedAt: null };
          }
        });
    },

    /** Slet alle afledte data for subjektet. Returnerer antallet fjernet. */
    erase(tenantIdRaw, subjectDigest) {
      const tenantId = normalizeTenantId(tenantIdRaw);
      const dir = dirFor(tenantId, subjectDigest);
      if (!existsSync(dir)) return { erased: 0 };
      const count = readdirSync(dir).filter((f) => f.endsWith(".json")).length;
      rmSync(dir, { recursive: true, force: true });
      return { erased: count };
    },
  };
}
