/**
 * DKC-043 — indholdsadresseret chunk-lager med referencekæde, retention-aware
 * garbage collection og single-writer lease.
 *
 * Lageret er opdelt i dedup-domæner (tenant + krypteringsdomæne +
 * retentionklasse + datakategori). Hvert domæne har sin egen chunk-namespace,
 * sin egen nøgle og sit eget indeks, så der aldrig deduplikeres på tværs af
 * kunder. En snapshots referencekæde er en ordnet liste af chunk-id'er plus
 * digesten af det fulde indhold; en chunk må først fjernes når ingen snapshots
 * refererer til den.
 *
 * Holdbarhedsmodel:
 *   - en chunk skrives som chiffertekst (`iv || authTag || ciphertext`) under
 *     `chunks/<domain>/<chunkId>.bin`; adressen er `sha256(domainId + ":" +
 *     chunkSha256)`, så identisk klartekst i to domæner får forskellige
 *     adresser,
 *   - indekset skrives atomisk (temp + rename),
 *   - enhver mutation journalføres før indekset ændres, så et crash midt i et
 *     put eller en prune kan genoprettes (`recover()`),
 *   - prune kræver en gyldig single-writer lease med et fencing-token; en
 *     udløbet eller fremmed lease afvises.
 *
 * Modulet kører over et rigtigt filsystem. En målt fejlmodel på et levende
 * objektlager er `integration-dedup-live` og er NOT RUN.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { normalizeTenantId } from "../../identity/src/tenant.mjs";
import { chunkBuffer, DEFAULT_CHUNKER, sha256Hex } from "./chunker.mjs";

export class DedupError extends Error {
  constructor(message, code = "dedup_error") {
    super(message);
    this.name = "DedupError";
    this.code = code;
  }
}

export const DEDUP_CATEGORIES = Object.freeze(["backup-blocks", "primary-objects", "job-events", "business-records"]);

function token(value, name) {
  const clean = String(value ?? "").trim();
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(clean)) {
    throw new DedupError(`${name} '${value}' er ugyldig (forventer [a-z0-9-])`, "bad_domain");
  }
  return clean;
}

/** Kanonisk, tenant-afgrænset domæne-id. Aldrig tomt og aldrig globalt. */
export function normalizeDedupDomain({ tenantId, encryptionDomain, retentionClass, category } = {}) {
  const tenant = normalizeTenantId(tenantId);
  const enc = token(encryptionDomain, "encryptionDomain");
  const retention = token(retentionClass, "retentionClass");
  if (!DEDUP_CATEGORIES.includes(category)) {
    throw new DedupError(`ukendt dedup-kategori '${category}'`, "bad_category");
  }
  return {
    tenantId: tenant,
    encryptionDomain: enc,
    retentionClass: retention,
    category,
    id: `${tenant}/${enc}/${retention}/${category}`,
  };
}

function domainHash(domain) {
  return sha256Hex(Buffer.from(domain.id, "utf8"));
}

/** Chunk-adresse: bundet til domænet, så der ikke deduplikeres på tværs af kunder. */
export function chunkIdFor(domain, chunkSha256) {
  return sha256Hex(Buffer.from(`${domain.id}:${chunkSha256}`, "utf8"));
}

function encryptChunk(plaintext, key, aad) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

function decryptChunk(blob, key, aad) {
  if (blob.length < 28) throw new DedupError("chunk-filen er for kort til at være en gyldig chiffertekst", "chunk_truncated");
  const iv = blob.subarray(0, 12);
  const authTag = blob.subarray(12, 28);
  const ciphertext = blob.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n");
  renameSync(tmp, path);
}

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

/**
 * @param {object} options
 * @param {string} options.rootDir   Dedup-lagerets rod.
 * @param {object} options.keyRing   `createDedupKeyRing(...)`.
 * @param {Function} [options.clock]
 * @param {Function} [options.failpoint] Fejl-injektion til crash-tests; modtager (navn, kontekst).
 */
export function createDedupStore({ rootDir, keyRing, clock = () => Date.now(), failpoint = null } = {}) {
  if (!rootDir) throw new DedupError("createDedupStore kræver en rootDir", "missing_root");
  if (!keyRing) throw new DedupError("createDedupStore kræver en nøglering uden for lageret", "missing_key_ring");

  const chunksRoot = join(rootDir, "chunks");
  const indexRoot = join(rootDir, "index");
  const leaseRoot = join(rootDir, "lease");

  const indexFile = (domain) => join(indexRoot, `${domainHash(domain)}.json`);
  const journalFile = (domain) => join(indexRoot, `${domainHash(domain)}.journal`);
  const leaseFile = (domain) => join(leaseRoot, `${domainHash(domain)}.json`);
  const domainChunksDir = (domain) => join(chunksRoot, domainHash(domain));

  const chunkPath = (domain, chunkId) => join(domainChunksDir(domain), `${chunkId}.bin`);
  const fail = (name, context = {}) => {
    if (typeof failpoint === "function") failpoint(name, context);
  };

  function emptyIndex(domain) {
    return { apiVersion: "contracts.platform/v1alpha1", kind: "DedupIndex", domain, chunks: {}, snapshots: {}, updatedAt: null };
  }

  function readIndex(domain) {
    const loaded = readJson(indexFile(domain), null);
    if (!loaded) return emptyIndex(domain);
    if (loaded.domain?.id !== domain.id) throw new DedupError("indeksets domæne matcher ikke den forespurgte domæne", "index_domain_mismatch");
    loaded.chunks ??= {};
    loaded.snapshots ??= {};
    return loaded;
  }

  function writeIndex(domain, index) {
    index.updatedAt = new Date(clock()).toISOString();
    writeJsonAtomic(indexFile(domain), index);
  }

  function appendJournal(domain, entry) {
    mkdirSync(indexRoot, { recursive: true });
    writeFileSync(journalFile(domain), JSON.stringify({ ...entry, at: new Date(clock()).toISOString() }) + "\n", { flag: "a" });
  }

  function readJournal(domain) {
    if (!existsSync(journalFile(domain))) return [];
    return readFileSync(journalFile(domain), "utf8")
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  function clearJournal(domain) {
    rmSync(journalFile(domain), { force: true });
  }

  function readLease(domain) {
    return readJson(leaseFile(domain), null);
  }

  function referenceChunk(domain, index, chunk) {
    const id = chunkIdFor(domain, chunk.sha256);
    const existing = index.chunks[id];
    if (existing) {
      existing.refs += 1;
      return { id, created: false };
    }
    const key = keyRing.keyFor(domain.id);
    const aad = `${domain.id}:${id}`;
    const blob = encryptChunk(chunk.buffer, key, aad);
    mkdirSync(domainChunksDir(domain), { recursive: true });
    writeFileSync(chunkPath(domain, id), blob);
    index.chunks[id] = { sha256: chunk.sha256, bytes: blob.length, plaintextBytes: chunk.length, refs: 1, createdAt: new Date(clock()).toISOString() };
    return { id, created: true };
  }

  function dereferenceChunk(index, chunkId) {
    const chunk = index.chunks[chunkId];
    if (!chunk) return;
    chunk.refs = Math.max(0, chunk.refs - 1);
  }

  function snapshotsReferencing(index, chunkId) {
    return Object.values(index.snapshots)
      .filter((snapshot) => snapshot.chunkIds.includes(chunkId))
      .map((snapshot) => snapshot.id)
      .sort();
  }

  function decodeChunk(domain, chunkId) {
    const path = chunkPath(domain, chunkId);
    if (!existsSync(path)) return { ok: false, reason: "chunk-missing" };
    try {
      const blob = readFileSync(path);
      const key = keyRing.keyFor(domain.id);
      const plaintext = decryptChunk(blob, key, `${domain.id}:${chunkId}`);
      const sha256 = sha256Hex(plaintext);
      return { ok: true, plaintext, sha256, bytes: blob.length };
    } catch {
      return { ok: false, reason: "auth-failed" };
    }
  }

  const store = {
    kind: "dedup-store",
    rootDir,
    keyId: keyRing.keyId,
    storeContainsKey: keyRing.storeContainsKey,
    chunker: { ...DEFAULT_CHUNKER },

    chunkPath,

    /** Tilføj (eller erstat) et snapshot og opbyg/opdater referencekæden. */
    putSnapshot({ domain: domainRaw, snapshotId, buffer, protected: protectedFlag = false, retentionUntil = null, now = clock() } = {}) {
      const domain = normalizeDedupDomain(domainRaw);
      if (typeof snapshotId !== "string" || snapshotId.trim() === "") throw new DedupError("putSnapshot kræver et snapshotId", "missing_snapshot_id");
      const index = readIndex(domain);
      if (index.snapshots[snapshotId]) {
        for (const chunkId of index.snapshots[snapshotId].chunkIds) dereferenceChunk(index, chunkId);
        delete index.snapshots[snapshotId];
      }
      const chunks = chunkBuffer(buffer, store.chunker);
      const chunkIds = chunks.map((chunk) => chunkIdFor(domain, chunk.sha256));
      const snapshot = {
        id: snapshotId,
        chunkIds,
        logicalBytes: Buffer.byteLength(buffer),
        digest: sha256Hex(buffer),
        protected: Boolean(protectedFlag),
        retentionUntil,
        createdAt: new Date(now).toISOString(),
      };
      // Journalfør intentionen FØR chunks skrives, så et crash midt i put'et kan
      // genoprettes: enten genopbygges snapshotet, eller de delvise chunks ryddes.
      appendJournal(domain, { op: "putSnapshot", snapshot });
      fail("after-journal", { domain, snapshotId, op: "putSnapshot" });
      let createdChunks = 0;
      for (const chunk of chunks) {
        const { created } = referenceChunk(domain, index, chunk);
        if (created) createdChunks += 1;
      }
      fail("after-chunks-written", { domain, snapshotId, chunkIds });
      fail("before-index-write", { domain, snapshotId, op: "putSnapshot" });
      index.snapshots[snapshotId] = snapshot;
      writeIndex(domain, index);
      fail("after-index-write", { domain, snapshotId, op: "putSnapshot" });
      clearJournal(domain);
      return { domain, snapshotId, chunks: chunkIds.length, uniqueChunks: createdChunks, logicalBytes: snapshot.logicalBytes, digest: snapshot.digest };
    },

    /** Fjern et snapshot fra referencekæden. Beskyttede snapshots afvises. */
    removeSnapshot({ domain: domainRaw, snapshotId, force = false } = {}) {
      const domain = normalizeDedupDomain(domainRaw);
      const index = readIndex(domain);
      const snapshot = index.snapshots[snapshotId];
      if (!snapshot) return { removed: false, reason: "not-found" };
      if (snapshot.protected && !force) return { removed: false, reason: "protected", snapshotId };
      for (const chunkId of snapshot.chunkIds) dereferenceChunk(index, chunkId);
      delete index.snapshots[snapshotId];
      writeIndex(domain, index);
      return { removed: true, snapshotId };
    },

    /** Beskyt et snapshot (fx en WORM-kopi) så prune aldrig må fjerne det. */
    protectSnapshot({ domain: domainRaw, snapshotId, retentionUntil = null } = {}) {
      const domain = normalizeDedupDomain(domainRaw);
      const index = readIndex(domain);
      const snapshot = index.snapshots[snapshotId];
      if (!snapshot) return { protected: false, reason: "not-found" };
      snapshot.protected = true;
      if (retentionUntil) snapshot.retentionUntil = retentionUntil;
      writeIndex(domain, index);
      return { protected: true, snapshotId, retentionUntil: snapshot.retentionUntil };
    },

    info({ domain: domainRaw, snapshotId } = {}) {
      const domain = normalizeDedupDomain(domainRaw);
      const index = readIndex(domain);
      const snapshot = index.snapshots[snapshotId];
      if (!snapshot) return null;
      return { ...structuredClone(snapshot), domain };
    },

    listSnapshots({ domain: domainRaw } = {}) {
      const domain = normalizeDedupDomain(domainRaw);
      const index = readIndex(domain);
      return Object.values(index.snapshots).map((snapshot) => ({ id: snapshot.id, logicalBytes: snapshot.logicalBytes, protected: snapshot.protected, retentionUntil: snapshot.retentionUntil, digest: snapshot.digest }));
    },

    /** Gendan et snapshots fulde bytes og verificér referencekæden undervejs. */
    readSnapshot({ domain: domainRaw, snapshotId } = {}) {
      const domain = normalizeDedupDomain(domainRaw);
      const index = readIndex(domain);
      const snapshot = index.snapshots[snapshotId];
      if (!snapshot) throw new DedupError(`snapshot '${snapshotId}' findes ikke i domænet`, "snapshot_not_found");
      const parts = [];
      for (const chunkId of snapshot.chunkIds) {
        const decoded = decodeChunk(domain, chunkId);
        if (!decoded.ok) throw new DedupError(`chunk '${chunkId}' kunne ikke læses (${decoded.reason})`, decoded.reason);
        if (decoded.sha256 !== index.chunks[chunkId]?.sha256) {
          throw new DedupError(`chunk '${chunkId}' matcher ikke indeksets digest`, "chunk_digest_mismatch");
        }
        parts.push(decoded.plaintext);
      }
      const buffer = Buffer.concat(parts);
      if (sha256Hex(buffer) !== snapshot.digest) throw new DedupError(`snapshot '${snapshotId}' matcher ikke sin manifestdigest`, "snapshot_digest_mismatch");
      return buffer;
    },

    /** Opdag korrupte eller manglende chunks og vis hvilke snapshots de rammer. */
    scrub({ domain: domainRaw = null } = {}) {
      const domains = domainRaw ? [normalizeDedupDomain(domainRaw)] : store.listDomains();
      const corruptions = [];
      let checked = 0;
      for (const domain of domains) {
        const index = readIndex(domain);
        for (const [chunkId, chunk] of Object.entries(index.chunks)) {
          checked += 1;
          const decoded = decodeChunk(domain, chunkId);
          if (!decoded.ok || decoded.sha256 !== chunk.sha256) {
            corruptions.push({ domain: domain.id, chunkId, reason: decoded.ok ? "checksum-mismatch" : decoded.reason, snapshots: snapshotsReferencing(index, chunkId) });
          }
        }
      }
      return { checked, corruptions, affectedSnapshots: [...new Set(corruptions.flatMap((c) => c.snapshots))].sort(), ok: corruptions.length === 0 };
    },

    /** Retention-aware mark-and-sweep. Kræver en gyldig single-writer lease. */
    prune({ domain: domainRaw, owner, fencingToken, now = clock() } = {}) {
      const domain = normalizeDedupDomain(domainRaw);
      const lease = readLease(domain);
      const validLease = lease && lease.owner === owner && lease.fencingToken === fencingToken && new Date(lease.until).getTime() > now;
      if (!validLease) return { pruned: false, reason: "lease-not-held", domain: domain.id };
      const index = readIndex(domain);
      const expiredSnapshots = [];
      for (const snapshot of Object.values(index.snapshots)) {
        const expired = !snapshot.protected && snapshot.retentionUntil && new Date(snapshot.retentionUntil).getTime() <= now;
        if (expired) {
          for (const chunkId of snapshot.chunkIds) dereferenceChunk(index, chunkId);
          delete index.snapshots[snapshot.id];
          expiredSnapshots.push(snapshot.id);
        }
      }
      const referenced = new Set();
      for (const snapshot of Object.values(index.snapshots)) for (const chunkId of snapshot.chunkIds) referenced.add(chunkId);
      const collect = Object.keys(index.chunks).filter((chunkId) => index.chunks[chunkId].refs <= 0 && !referenced.has(chunkId)).sort();
      const reclaimedBytes = collect.reduce((sum, chunkId) => sum + (index.chunks[chunkId]?.bytes ?? 0), 0);
      appendJournal(domain, { op: "prune", collect, expiredSnapshots });
      fail("before-prune-index-write", { domain, collect });
      for (const chunkId of collect) delete index.chunks[chunkId];
      writeIndex(domain, index);
      fail("before-chunk-delete", { domain, collect });
      for (const chunkId of collect) rmSync(chunkPath(domain, chunkId), { force: true });
      clearJournal(domain);
      return { pruned: true, domain: domain.id, expiredSnapshots, removedChunks: collect.length, reclaimedBytes };
    },

    /** Tag single-writer leasen for prune. Hæver fencing-token ved hver overtagelse. */
    acquireLease({ domain: domainRaw, owner, leaseMs = 120_000, now = clock() } = {}) {
      const domain = normalizeDedupDomain(domainRaw);
      if (typeof owner !== "string" || owner.trim() === "") throw new DedupError("acquireLease kræver en owner", "missing_owner");
      const existing = readLease(domain);
      const expired = !existing || !existing.until || new Date(existing.until).getTime() <= now;
      if (existing && !expired && existing.owner !== owner) return { acquired: false, reason: "lease-held", lease: existing };
      const fencingToken = (existing?.fencingToken ?? 0) + 1;
      const lease = { domain: domain.id, owner, fencingToken, acquiredAt: new Date(now).toISOString(), until: new Date(now + leaseMs).toISOString() };
      writeJsonAtomic(leaseFile(domain), lease);
      return { acquired: true, lease };
    },

    releaseLease({ domain: domainRaw, owner, fencingToken } = {}) {
      const domain = normalizeDedupDomain(domainRaw);
      const lease = readLease(domain);
      if (!lease || lease.owner !== owner || lease.fencingToken !== fencingToken) return { released: false, reason: "not-holder" };
      rmSync(leaseFile(domain), { force: true });
      return { released: true };
    },

    leaseInfo({ domain: domainRaw } = {}) {
      return readLease(normalizeDedupDomain(domainRaw));
    },

    /** Genopret efter et crash midt i et put eller en prune via journalen. */
    recover() {
      let recovered = 0;
      let droppedSnapshots = 0;
      let orphanChunks = 0;
      for (const domain of store.listDomains()) {
        const entries = readJournal(domain);
        const index = readIndex(domain);
        for (const entry of entries) {
          if (entry.op === "putSnapshot" && entry.snapshot && !index.snapshots[entry.snapshot.id]) {
            const snapshot = entry.snapshot;
            const allPresent = snapshot.chunkIds.every((chunkId) => existsSync(chunkPath(domain, chunkId)));
            if (allPresent) {
              for (const chunkId of snapshot.chunkIds) {
                if (!index.chunks[chunkId]) {
                  const decoded = decodeChunk(domain, chunkId);
                  if (decoded.ok) index.chunks[chunkId] = { sha256: decoded.sha256, bytes: decoded.bytes, plaintextBytes: decoded.plaintext.length, refs: 0, createdAt: entry.at ?? new Date(clock()).toISOString() };
                }
                if (index.chunks[chunkId]) index.chunks[chunkId].refs += 1;
              }
              index.snapshots[snapshot.id] = snapshot;
              recovered += 1;
            } else {
              // Delvist skrevet put: snapshotet blev aldrig committet.
              droppedSnapshots += 1;
            }
          }
          if (entry.op === "prune") {
            for (const chunkId of entry.collect ?? []) {
              const referenced = Object.values(index.snapshots).some((snapshot) => snapshot.chunkIds.includes(chunkId));
              if (referenced) continue;
              delete index.chunks[chunkId];
              rmSync(chunkPath(domain, chunkId), { force: true });
            }
            recovered += 1;
          }
        }
        // Ryd forældreløse chunk-filer (skrevet men aldrig refereret i indekset).
        const dir = domainChunksDir(domain);
        if (existsSync(dir)) {
          for (const file of readdirSync(dir)) {
            const chunkId = file.replace(/\.bin$/, "");
            if (!index.chunks[chunkId]) {
              rmSync(join(dir, file), { force: true });
              orphanChunks += 1;
            }
          }
        }
        writeIndex(domain, index);
        clearJournal(domain);
      }
      return { recovered, droppedSnapshots, orphanChunks };
    },

    /** Mål logiske vs. fysiske bytes og dedup-effekten for ét eller alle domæner. */
    measure({ domain: domainRaw = null } = {}) {
      const domains = domainRaw ? [normalizeDedupDomain(domainRaw)] : store.listDomains();
      let logicalBytes = 0;
      let physicalBytes = 0;
      let snapshots = 0;
      let uniqueChunks = 0;
      let references = 0;
      const byDomain = [];
      for (const domain of domains) {
        const index = readIndex(domain);
        let domainLogical = 0;
        for (const snapshot of Object.values(index.snapshots)) domainLogical += snapshot.logicalBytes;
        let domainPhysical = 0;
        const dir = domainChunksDir(domain);
        if (existsSync(dir)) for (const file of readdirSync(dir)) domainPhysical += statSync(join(dir, file)).size;
        logicalBytes += domainLogical;
        physicalBytes += domainPhysical;
        snapshots += Object.keys(index.snapshots).length;
        uniqueChunks += Object.keys(index.chunks).length;
        references += Object.values(index.chunks).reduce((sum, chunk) => sum + chunk.refs, 0);
        byDomain.push({ domain: domain.id, logicalBytes: domainLogical, physicalBytes: domainPhysical, snapshots: Object.keys(index.snapshots).length, uniqueChunks: Object.keys(index.chunks).length });
      }
      const savedBytes = Math.max(0, logicalBytes - physicalBytes);
      return {
        logicalBytes,
        physicalBytes,
        savedBytes,
        physicalToLogicalRatio: logicalBytes === 0 ? 1 : physicalBytes / logicalBytes,
        snapshots,
        uniqueChunks,
        references,
        byDomain: byDomain.sort((a, b) => a.domain.localeCompare(b.domain)),
      };
    },

    listDomains() {
      if (!existsSync(indexRoot)) return [];
      const domains = [];
      for (const file of readdirSync(indexRoot)) {
        if (!file.endsWith(".json")) continue;
        const loaded = readJson(join(indexRoot, file), null);
        if (loaded?.domain?.id) domains.push(loaded.domain);
      }
      return domains.sort((a, b) => a.id.localeCompare(b.id));
    },
  };

  return store;
}
