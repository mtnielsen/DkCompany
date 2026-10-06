/**
 * DKC-041 — replikeret, versionsstyret fil- og objektlager.
 *
 * Modulet er en deterministisk model af den holdbarhedskontrakt som
 * `storage/storage-plan.json` kræver, men den kører over et **rigtigt**
 * filsystem: hver host har sin egen mappe med blobs (chiffertekst) og
 * manifests (versionsmetadata). Det giver:
 *
 *   - versionsstyrede objekter med en sha256-checksum pr. version,
 *   - skrivning til et synkront quorum: en write bekræftes kun når mindst
 *     `writeQuorum` hosts har skrevet den; ellers rulles den tilbage og
 *     afvises (`quorum-loss`) — der er ingen usikre writes,
 *   - læsning med overlappende læse-quorum og checksum-verifikation, så en
 *     korrupt replika opdages og der faldes tilbage til en sund,
 *   - scrub der opdager silent corruption, og repair/rebalance der genskaber
 *     manglende eller korrupte replikaer fra en sund kopi,
 *   - kundeafgrænsede nøgler: hver tenant + dataklasse har sin egen HKDF-afledte
 *     AES-256-GCM-nøgle fra et eksternt nøglemagasin,
 *   - kapacitetsalarmer pr. host ud fra planens tærskler,
 *   - relokation af en workload til en anden host med verificeret samme filer
 *     og rettigheder.
 *
 * Modellen er **ikke** en målt fejlmodel på et levende CSI-/objektlager; en
 * sådan er `integration-storage-live` og er NOT RUN.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeTenantId } from "../../identity/src/tenant.mjs";
import { capacityStatus } from "./plan.mjs";

export class StorageError extends Error {
  constructor(message, code = "storage_error") {
    super(message);
    this.name = "StorageError";
    this.code = code;
  }
}

export function sha256Hex(input) {
  return createHash("sha256").update(input).digest("hex");
}

function safeKey(key) {
  const clean = String(key ?? "").replace(/^\/+/, "");
  if (!clean || clean.split("/").some((part) => part === ".." || part === "")) {
    throw new StorageError(`ugyldig objektnøgle '${key}'`, "bad_key");
  }
  return clean;
}

function safeTenant(tenantIdRaw) {
  return normalizeTenantId(tenantIdRaw);
}

function aadFor(tenantId, classification, key, version, sha256) {
  return Buffer.from(`${tenantId}:${classification}:${key}:${version}:${sha256}`, "utf8");
}

function encrypt(plaintext, key, aad) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { ciphertext, iv: iv.toString("hex"), authTag: cipher.getAuthTag().toString("hex") };
}

function decrypt({ ciphertext, iv, authTag }, key, aad) {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "hex"));
  decipher.setAAD(aad);
  decipher.setAuthTag(Buffer.from(authTag, "hex"));
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function constantTimeEqualHex(a, b) {
  const left = Buffer.from(String(a ?? ""), "hex");
  const right = Buffer.from(String(b ?? ""), "hex");
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

/**
 * @param {object} options
 * @param {object} options.plan       Den kanoniske StoragePlan.
 * @param {string} options.rootDir    Basis-mappe; hver host får sin egen undermappe.
 * @param {object} options.keyRing    `createTenantKeyRing(...)`.
 * @param {Function} [options.clock]
 */
export function createStorageCluster({ plan, rootDir, keyRing, clock = () => Date.now() } = {}) {
  if (!plan) throw new StorageError("createStorageCluster kræver en plan", "missing_plan");
  if (!rootDir) throw new StorageError("createStorageCluster kræver en rootDir", "missing_root");
  if (!keyRing) throw new StorageError("createStorageCluster kræver en nøglering uden for lageret", "missing_key_ring");

  const hostIds = (plan.topology?.hosts ?? []).map((h) => h.id);
  if (hostIds.length < 3) throw new StorageError("lageret kræver mindst tre hosts", "bad_topology");
  const readQuorum = plan.topology?.readQuorum ?? 1;
  const writeQuorum = plan.topology?.writeQuorum ?? 2;
  const replicaFactor = plan.topology?.replicaFactor ?? hostIds.length;
  const classes = new Map((plan.dataClasses ?? []).map((c) => [c.id, c]));

  const reachable = new Set(hostIds);
  const byId = new Map(hostIds.map((id) => [id, plan.topology.hosts.find((h) => h.id === id)]));

  const nodeDir = (hostId) => join(rootDir, hostId);
  const blobsDir = (hostId) => join(nodeDir(hostId), "blobs");
  const metaDir = (hostId, tenantId) => join(nodeDir(hostId), "meta", tenantId);
  const blobPath = (hostId, sha) => join(blobsDir(hostId), sha);
  const metaPath = (hostId, tenantId, keyHash) => join(metaDir(hostId, tenantId), `${keyHash}.json`);

  function assertHost(hostId) {
    if (!byId.has(hostId)) throw new StorageError(`ukendt host '${hostId}'`, "unknown_host");
  }

  function isReachable(hostId) {
    return reachable.has(hostId);
  }

  function reachableHosts() {
    return hostIds.filter((id) => reachable.has(id));
  }

  function readManifest(hostId, tenantId, keyHash) {
    const path = metaPath(hostId, tenantId, keyHash);
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, "utf8"));
    } catch {
      return null;
    }
  }

  function writeManifest(hostId, tenantId, keyHash, manifest, mode) {
    const dir = metaDir(hostId, tenantId);
    mkdirSync(dir, { recursive: true });
    const path = metaPath(hostId, tenantId, keyHash);
    writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n");
    if (typeof mode === "number") chmodSync(path, mode & 0o777);
    return path;
  }

  function readBlob(hostId, sha) {
    const path = blobPath(hostId, sha);
    if (!existsSync(path)) return null;
    return readFileSync(path);
  }

  function writeBlob(hostId, sha, bytes) {
    mkdirSync(blobsDir(hostId), { recursive: true });
    writeFileSync(blobPath(hostId, sha), bytes);
  }

  function verifyVersion(hostId, manifest, version) {
    const entry = manifest.versions.find((v) => v.version === version);
    if (!entry) return { ok: false, reason: "version-missing" };
    const ciphertext = readBlob(hostId, entry.blob);
    if (!ciphertext) return { ok: false, reason: "blob-missing" };
    try {
      const key = keyRing.keyFor(manifest.tenantId, manifest.classification);
      const aad = aadFor(manifest.tenantId, manifest.classification, manifest.key, entry.version, entry.sha256);
      const plaintext = decrypt({ ciphertext, iv: entry.iv, authTag: entry.authTag }, key, aad);
      if (!constantTimeEqualHex(sha256Hex(plaintext), entry.sha256)) return { ok: false, reason: "checksum-mismatch" };
      return { ok: true, plaintext, entry };
    } catch {
      return { ok: false, reason: "auth-failed" };
    }
  }

  function listTenantsOn(hostId) {
    const base = join(nodeDir(hostId), "meta");
    if (!existsSync(base)) return [];
    return readdirSync(base, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  }

  function listKeysFor(hostId, tenantId) {
    const dir = metaDir(hostId, tenantId);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map((f) => {
        try {
          const m = JSON.parse(readFileSync(join(dir, f), "utf8"));
          return { keyHash: f.replace(/\.json$/, ""), key: m.key, classification: m.classification, latest: m.latest };
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  const cluster = {
    kind: "storage-cluster",
    writeQuorum,
    readQuorum,
    replicaFactor,
    hosts() {
      return [...byId.values()].map((h) => ({ id: h.id, failureDomain: h.failureDomain }));
    },

    isReachable,
    reachableHosts,

    /** Skriv en ny version af et objekt. Bekræftes kun ved skrive-quorum. */
    put(tenantIdRaw, keyRaw, buffer, { classification = "authoritative", mode = 0o640, now = clock() } = {}) {
      const tenantId = safeTenant(tenantIdRaw);
      const key = safeKey(keyRaw);
      const cls = classes.get(classification);
      if (!cls) throw new StorageError(`ukendt dataklasse '${classification}'`, "bad_classification");
      const plaintext = Buffer.from(buffer);
      const sha256 = sha256Hex(plaintext);
      const keyHash = sha256Hex(key);
      const targets = reachableHosts();
      const previous = new Map();
      const createdBlobs = [];
      let version = 1;
      for (const hostId of targets) {
        const m = readManifest(hostId, tenantId, keyHash);
        previous.set(hostId, m ? JSON.stringify(m) : null);
        if (m && m.latest >= version) version = m.latest + 1;
      }

      const encryptKey = keyRing.keyFor(tenantId, classification);
      const aad = aadFor(tenantId, classification, key, version, sha256);
      const encrypted = encrypt(plaintext, encryptKey, aad);
      const entry = { version, sha256, bytes: plaintext.length, blob: sha256, createdAt: new Date(now).toISOString(), mode: mode & 0o777, iv: encrypted.iv, authTag: encrypted.authTag };

      const written = [];
      for (const hostId of targets) {
        try {
          const existed = existsSync(blobPath(hostId, sha256));
          writeBlob(hostId, sha256, encrypted.ciphertext);
          if (!existed) createdBlobs.push({ hostId, sha: sha256 });
          const m = previous.get(hostId) ? JSON.parse(previous.get(hostId)) : { tenantId, key, classification, versions: [], latest: 0 };
          m.versions = m.versions.filter((v) => v.version !== version).concat([entry]).sort((a, b) => a.version - b.version);
          m.latest = Math.max(m.latest, version);
          m.updatedAt = new Date(now).toISOString();
          writeManifest(hostId, tenantId, keyHash, m, mode);
          written.push(hostId);
        } catch {
          /* en host der ikke kan skrive tæller ikke som ack */
        }
      }

      if (written.length < writeQuorum) {
        // Rul tilbage: genskab forrige manifest og fjern nye blobs.
        for (const hostId of targets) {
          const snapshot = previous.get(hostId);
          if (snapshot === null) rmSync(metaPath(hostId, tenantId, keyHash), { force: true });
          else writeManifest(hostId, tenantId, keyHash, JSON.parse(snapshot), mode);
        }
        for (const { hostId, sha } of createdBlobs) rmSync(blobPath(hostId, sha), { force: true });
        return { committed: false, reason: "quorum-loss", written: written.length, required: writeQuorum };
      }

      return { committed: true, tenantId, key, classification, version, sha256, bytes: plaintext.length, replicas: written, at: new Date(now).toISOString() };
    },

    /** Læs seneste (eller en valgt) version med overlappende læse-quorum. */
    get(tenantIdRaw, keyRaw, { version = null } = {}) {
      const tenantId = safeTenant(tenantIdRaw);
      const key = safeKey(keyRaw);
      const keyHash = sha256Hex(key);
      const candidates = reachableHosts()
        .map((hostId) => ({ hostId, manifest: readManifest(hostId, tenantId, keyHash) }))
        .filter((c) => c.manifest);
      if (candidates.length === 0) throw new StorageError(`objektet '${key}' findes ikke for tenant '${tenantId}'`, "not_found");

      const effectiveRead = Math.min(readQuorum, candidates.length);
      const versions = new Set(version === null ? candidates.map((c) => c.manifest.latest) : [version]);
      const ranked = [...versions].sort((a, b) => b - a);
      for (const v of ranked) {
        const holders = candidates.filter((c) => c.manifest.versions.some((e) => e.version === v));
        if (holders.length < effectiveRead) continue;
        for (const holder of holders) {
          const verified = verifyVersion(holder.hostId, holder.manifest, v);
          if (verified.ok) {
            return { tenantId, key, classification: holder.manifest.classification, version: v, sha256: verified.entry.sha256, bytes: verified.entry.bytes, mode: verified.entry.mode, buffer: verified.plaintext, host: holder.hostId };
          }
        }
      }
      throw new StorageError(`ingen sund replika af '${key}' for tenant '${tenantId}'`, "all-replicas-corrupt");
    },

    /** Liste over en tenants objekter; tenanten kan ikke se andres nøgler. */
    list(tenantIdRaw) {
      const tenantId = safeTenant(tenantIdRaw);
      const hostId = reachableHosts()[0];
      if (!hostId) throw new StorageError("ingen nåbare hosts", "no-reachable-host");
      return listKeysFor(hostId, tenantId).map((entry) => ({ key: entry.key, classification: entry.classification, latest: entry.latest }));
    },

    /** Alle versioner af et objekt med deres låsemetadata. */
    versions(tenantIdRaw, keyRaw) {
      const tenantId = safeTenant(tenantIdRaw);
      const key = safeKey(keyRaw);
      const keyHash = sha256Hex(key);
      const hostId = reachableHosts()[0];
      if (!hostId) throw new StorageError("ingen nåbare hosts", "no-reachable-host");
      const manifest = readManifest(hostId, tenantId, keyHash);
      if (!manifest) return [];
      return manifest.versions.map((v) => ({ version: v.version, sha256: v.sha256, bytes: v.bytes, createdAt: v.createdAt, lock: v.lock ?? null }));
    },

    /**
     * Læg en WORM-lås på en version. Låsen kan kun forlænges eller opretholdes
     * på COMPLIANCE-niveau — den kan aldrig forkortes eller nedgraderes.
     */
    lockVersion(tenantIdRaw, keyRaw, version, { mode = "COMPLIANCE", retainUntil = null, now = clock() } = {}) {
      if (!["GOVERNANCE", "COMPLIANCE"].includes(mode)) throw new StorageError(`ukendt lock-mode '${mode}'`, "bad_lock_mode");
      const tenantId = safeTenant(tenantIdRaw);
      const key = safeKey(keyRaw);
      const keyHash = sha256Hex(key);
      const until = retainUntil ?? new Date(now + 365 * 24 * 3600 * 1000).toISOString();
      const lockedAt = new Date(now).toISOString();
      const targets = reachableHosts();
      const previous = new Map();
      const written = [];
      let conflict = null;
      for (const hostId of targets) {
        const m = readManifest(hostId, tenantId, keyHash);
        if (!m) continue;
        const entry = m.versions.find((v) => v.version === version);
        if (!entry) continue;
        previous.set(hostId, JSON.stringify(m));
        const existing = entry.lock;
        if (existing) {
          if (new Date(until) < new Date(existing.retainUntil)) { conflict = "retention-shorten"; break; }
          if (existing.mode === "COMPLIANCE" && mode !== "COMPLIANCE") { conflict = "mode-downgrade"; break; }
        }
        const clone = structuredClone(m);
        const target = clone.versions.find((v) => v.version === version);
        target.lock = {
          mode: existing?.mode === "COMPLIANCE" ? "COMPLIANCE" : mode,
          retainUntil: existing && new Date(existing.retainUntil) > new Date(until) ? existing.retainUntil : until,
          lockedAt: existing?.lockedAt ?? lockedAt,
        };
        clone.updatedAt = lockedAt;
        writeManifest(hostId, tenantId, keyHash, clone, target.mode ?? entry.mode);
        written.push(hostId);
      }
      if (conflict) {
        for (const [hostId, snapshot] of previous) writeManifest(hostId, tenantId, keyHash, JSON.parse(snapshot));
        return { committed: false, reason: conflict };
      }
      if (written.length < writeQuorum) {
        for (const [hostId, snapshot] of previous) writeManifest(hostId, tenantId, keyHash, JSON.parse(snapshot));
        return { committed: false, reason: "quorum-loss", written: written.length, required: writeQuorum };
      }
      return { committed: true, tenantId, key, version, lock: { mode, retainUntil: until, lockedAt }, replicas: written };
    },

    /** Låsemetadata for en version (eller null). */
    lockInfo(tenantIdRaw, keyRaw, version) {
      const tenantId = safeTenant(tenantIdRaw);
      const key = safeKey(keyRaw);
      const keyHash = sha256Hex(key);
      for (const hostId of reachableHosts()) {
        const m = readManifest(hostId, tenantId, keyHash);
        const entry = m?.versions.find((v) => v.version === version);
        if (entry) return entry.lock ?? null;
      }
      return null;
    },

    /**
     * Slet en version. Den mekaniske WORM-håndhævelse sker her: en aktiv
     * COMPLIANCE-lås kan ikke brydes, og en GOVERNANCE-lås kun med et eksplicit
     * (menneskeligt, to-personers) bypass-flag fra en kalder der er autoriseret
     * højere oppe.
     */
    deleteVersion(tenantIdRaw, keyRaw, version, { bypassGovernance = false, now = clock() } = {}) {
      const tenantId = safeTenant(tenantIdRaw);
      const key = safeKey(keyRaw);
      const keyHash = sha256Hex(key);
      const iso = new Date(now).toISOString();
      const targets = reachableHosts();
      for (const hostId of targets) {
        const m = readManifest(hostId, tenantId, keyHash);
        const entry = m?.versions.find((v) => v.version === version);
        if (!entry?.lock) continue;
        if (entry.lock.mode === "COMPLIANCE" && new Date(entry.lock.retainUntil) > new Date(now)) return { deleted: false, reason: "compliance-locked", retainUntil: entry.lock.retainUntil };
        if (entry.lock.mode === "GOVERNANCE" && new Date(entry.lock.retainUntil) > new Date(now) && !bypassGovernance) return { deleted: false, reason: "governance-locked", retainUntil: entry.lock.retainUntil };
      }
      const previous = new Map();
      const written = [];
      for (const hostId of targets) {
        const m = readManifest(hostId, tenantId, keyHash);
        if (!m || !m.versions.some((v) => v.version === version)) continue;
        previous.set(hostId, JSON.stringify(m));
        const clone = structuredClone(m);
        clone.versions = clone.versions.filter((v) => v.version !== version);
        clone.latest = clone.versions.reduce((max, v) => Math.max(max, v.version), 0);
        clone.updatedAt = iso;
        writeManifest(hostId, tenantId, keyHash, clone);
        written.push(hostId);
      }
      if (written.length < writeQuorum) {
        for (const [hostId, snapshot] of previous) writeManifest(hostId, tenantId, keyHash, JSON.parse(snapshot));
        return { deleted: false, reason: "quorum-loss", written: written.length, required: writeQuorum };
      }
      return { deleted: true, tenantId, key, version, replicas: written };
    },

    /**
     * Den autoritative version: den låste version hvis der findes en (COMPLIANCE
     * foretrækkes), ellers seneste. En ny version skjuler aldrig den låste.
     */
    authoritative(tenantIdRaw, keyRaw) {
      const tenantId = safeTenant(tenantIdRaw);
      const key = safeKey(keyRaw);
      const keyHash = sha256Hex(key);
      for (const hostId of reachableHosts()) {
        const m = readManifest(hostId, tenantId, keyHash);
        if (!m) continue;
        const locked = m.versions.filter((v) => v.lock);
        if (locked.length) {
          locked.sort((a, b) => {
            if (a.lock.mode !== b.lock.mode) return a.lock.mode === "COMPLIANCE" ? -1 : 1;
            return a.version - b.version;
          });
          return { tenantId, key, version: locked[0].version, sha256: locked[0].sha256, lock: locked[0].lock, latest: m.latest, locked: true };
        }
        return { tenantId, key, version: m.latest, sha256: m.versions.find((v) => v.version === m.latest)?.sha256 ?? null, lock: null, latest: m.latest, locked: false };
      }
      throw new StorageError(`objektet '${key}' findes ikke for tenant '${tenantId}'`, "not_found");
    },

    /** Læs den autoritative (låste) version. */
    getAuthoritative(tenantIdRaw, keyRaw) {
      const meta = cluster.authoritative(tenantIdRaw, keyRaw);
      return cluster.get(tenantIdRaw, keyRaw, { version: meta.version });
    },

    /** Aktive låse på tværs af en tenants objekter (til verifikation/backup). */
    locks(tenantIdRaw = null) {
      const out = [];
      const hostId = reachableHosts()[0];
      if (!hostId) return out;
      const tenants = tenantIdRaw ? [safeTenant(tenantIdRaw)] : listTenantsOn(hostId);
      for (const t of tenants) {
        for (const meta of listKeysFor(hostId, t)) {
          const m = readManifest(hostId, t, meta.keyHash);
          for (const v of m?.versions ?? []) {
            if (v.lock) out.push({ tenantId: t, key: m.key, version: v.version, sha256: v.sha256, lock: v.lock });
          }
        }
      }
      return out.sort((a, b) => `${a.tenantId}/${a.key}/${a.version}`.localeCompare(`${b.tenantId}/${b.key}/${b.version}`));
    },

    /** Scan alle (eller én tenants) versioner og opdag silent corruption. */
    scrub({ tenantId = null } = {}) {
      const corruptions = [];
      let checked = 0;
      for (const hostId of reachableHosts()) {
        const tenants = tenantId ? [safeTenant(tenantId)] : listTenantsOn(hostId);
        for (const t of tenants) {
          for (const meta of listKeysFor(hostId, t)) {
            const manifest = readManifest(hostId, t, meta.keyHash);
            if (!manifest) continue;
            for (const entry of manifest.versions) {
              checked += 1;
              const verified = verifyVersion(hostId, manifest, entry.version);
              if (!verified.ok) {
                corruptions.push({ host: hostId, tenantId: t, key: manifest.key, classification: manifest.classification, version: entry.version, sha256: entry.sha256, reason: verified.reason });
              }
            }
          }
        }
      }
      return { checked, corruptions, ok: corruptions.length === 0 };
    },

    /** Reparér én korrupt/manglende replika fra en sund kopi. */
    repair(corruption, { now = clock() } = {}) {
      const { host: brokenHost, tenantId, key, version } = corruption;
      assertHost(brokenHost);
      const keyHash = sha256Hex(key);
      for (const hostId of reachableHosts()) {
        if (hostId === brokenHost) continue;
        const manifest = readManifest(hostId, tenantId, keyHash);
        if (!manifest || !manifest.versions.some((e) => e.version === version)) continue;
        const verified = verifyVersion(hostId, manifest, version);
        if (!verified.ok) continue;
        // Skriv den sunde chiffertekst til den korrupte host.
        const sourceBlob = readBlob(hostId, verified.entry.blob);
        writeBlob(brokenHost, verified.entry.blob, sourceBlob);
        const target = readManifest(brokenHost, tenantId, keyHash) ?? { tenantId, key, classification: manifest.classification, versions: [], latest: 0 };
        target.versions = target.versions.filter((v) => v.version !== version).concat([verified.entry]).sort((a, b) => a.version - b.version);
        target.latest = Math.max(target.latest, version);
        target.updatedAt = new Date(now).toISOString();
        writeManifest(brokenHost, tenantId, keyHash, target, verified.entry.mode);
        return { repaired: true, host: brokenHost, source: hostId, tenantId, key, version, at: new Date(now).toISOString() };
      }
      return { repaired: false, reason: "no-healthy-source", host: brokenHost, tenantId, key, version };
    },

    /** Reparér alle opdagede korruptioner; returnerer en samlet rapport. */
    repairAll({ now = clock() } = {}) {
      const scan = cluster.scrub();
      const repairs = scan.corruptions.map((c) => cluster.repair(c, { now }));
      const failed = repairs.filter((r) => !r.repaired);
      return { checked: scan.checked, corruptions: scan.corruptions.length, repaired: repairs.filter((r) => r.repaired).length, failed, repairs, ok: failed.length === 0 };
    },

    /** Sørg for at hvert objekt har `replicaFactor` sunde kopier blandt de nåbare hosts. */
    rebalance({ now = clock() } = {}) {
      const moved = [];
      const source = reachableHosts()[0];
      if (!source) return { moved, ok: true };
      const wanted = Math.min(replicaFactor, reachableHosts().length);
      const tenants = listTenantsOn(source);
      for (const t of tenants) {
        for (const meta of listKeysFor(source, t)) {
          const reference = readManifest(source, t, meta.keyHash);
          if (!reference) continue;
          const healthyHosts = reachableHosts().filter((hostId) => {
            const m = readManifest(hostId, t, meta.keyHash);
            return m && m.versions.some((e) => e.version === reference.latest) && verifyVersion(hostId, m, reference.latest).ok;
          });
          for (const hostId of reachableHosts()) {
            if (healthyHosts.length >= wanted) break;
            if (healthyHosts.includes(hostId)) continue;
            const repaired = cluster.repair({ host: hostId, tenantId: t, key: reference.key, version: reference.latest, reason: "rebalance" }, { now });
            if (repaired.repaired) {
              healthyHosts.push(hostId);
              moved.push(repaired);
            }
          }
        }
      }
      return { moved, ok: true };
    },

    /** Kapacitetsstatus pr. host ud fra de faktiske blob-størrelser. */
    capacity() {
      const used = {};
      for (const hostId of hostIds) {
        const dir = blobsDir(hostId);
        let bytes = 0;
        if (existsSync(dir)) {
          for (const file of readdirSync(dir)) bytes += statSync(join(dir, file)).size;
        }
        used[hostId] = bytes;
      }
      return { ...capacityStatus(plan, used), usedBytesByHost: used };
    },

    /**
     * Flyt en workload fra én host til en anden og verificér at den ser samme
     * filer med samme checksums og rettigheder. Selve lageret er delt, så
     * flytningen rører ikke data — det er netop pointen.
     */
    relocateWorkload({ fromHostId, toHostId, tenantId, now = clock() } = {}) {
      assertHost(fromHostId);
      assertHost(toHostId);
      const t = safeTenant(tenantId);
      const fromKeys = listKeysFor(fromHostId, t);
      const mismatches = [];
      for (const meta of fromKeys) {
        const a = readManifest(fromHostId, t, meta.keyHash);
        const b = readManifest(toHostId, t, meta.keyHash);
        if (!a) continue;
        const av = a.versions.find((v) => v.version === a.latest);
        const bv = b?.versions.find((v) => v.version === a.latest);
        if (!bv) {
          mismatches.push({ key: a.key, reason: "missing-on-target" });
          continue;
        }
        if (av.sha256 !== bv.sha256) mismatches.push({ key: a.key, reason: "checksum-mismatch" });
        if ((av.mode & 0o777) !== (bv.mode & 0o777)) mismatches.push({ key: a.key, reason: "mode-mismatch", from: av.mode, to: bv.mode });
      }
      return { fromHostId, toHostId, tenantId: t, files: fromKeys.length, mismatches, sameFiles: mismatches.length === 0, at: new Date(now).toISOString() };
    },

    /** Sæt nåbarheden til de givne grupper; hosts uden for grupperne isoleres. */
    partitionInto(groups) {
      reachable.clear();
      for (const group of groups) {
        for (const hostId of group) {
          assertHost(hostId);
          reachable.add(hostId);
        }
      }
      return { reachable: reachableHosts(), writeQuorum, writesAllowed: reachable.size >= writeQuorum };
    },

    restoreReachability() {
      reachable.clear();
      for (const hostId of hostIds) reachable.add(hostId);
    },

    snapshot() {
      return { hosts: hostIds, reachable: [...reachable], writeQuorum, readQuorum, replicaFactor, keyId: keyRing.keyId, storeContainsKey: keyRing.storeContainsKey };
    },
  };

  return cluster;
}
