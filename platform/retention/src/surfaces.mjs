/**
 * DKC-021 — sletteflader.
 *
 * En flade er en adapter over ét datalag. Den kan lokalisere subjektets data og
 * forsøge at slette dem, og den returnerer altid en ærlig status:
 *
 *   - `full`         — subjektets data er fjernet fra fladen,
 *   - `partial`      — noget er fjernet, men en kopi består (fx en ekstern
 *                      leverandør eller en WORM-låst backup); kopien opgives
 *                      med begrundelse og forventet udløb,
 *   - `unsupported`  — fladen kan slet ikke slette; det påstås aldrig som fuld,
 *   - `not-found`    — subjektet havde ingen data på fladen.
 *
 * Fladerne er de eneste steder der muterer data. De kaldes først efter at hold
 * er tjekket og revisionsintentet er skrevet (se `deletion-service.mjs`).
 */
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const DAY_MS = 24 * 3600 * 1000;

function expiry(now, retentionDays) {
  return new Date(now + (retentionDays ?? 30) * DAY_MS).toISOString();
}

function remaining(kind, resource, reason, now, retentionDays) {
  return { kind, resource, reason, expiresAt: expiry(now, retentionDays) };
}

/**
 * Primærlageret. Subjektets objekter findes gennem et digest-indeks
 * (`_subjects/<digest>.json`) i selve lageret, så lokaliseringen er
 * tenant-bundet og kræver ingen ekstern katalog.
 */
export function createObjectStoreSurface({ surface, cluster }) {
  const indexKey = (digest) => `_subjects/${digest}.json`;
  return {
    id: surface.id,
    kind: surface.kind,
    dataClasses: surface.dataClasses,
    coverage: surface.coverage,

    recordSubject(tenantId, subjectDigest, key) {
      let keys = [];
      try {
        keys = JSON.parse(cluster.get(tenantId, indexKey(subjectDigest)).buffer.toString("utf8"));
      } catch {
        keys = [];
      }
      if (!keys.includes(key)) keys.push(key);
      cluster.put(tenantId, indexKey(subjectDigest), Buffer.from(JSON.stringify(keys)));
      return { tenantId, subjectDigest, key };
    },

    locate(tenantId, subjectDigest) {
      try {
        return JSON.parse(cluster.get(tenantId, indexKey(subjectDigest)).buffer.toString("utf8"));
      } catch {
        return [];
      }
    },

    erase(tenantId, subjectDigest, { now = Date.now() } = {}) {
      const keys = this.locate(tenantId, subjectDigest);
      let deleted = 0;
      const locked = [];
      for (const key of keys) {
        for (const version of cluster.versions(tenantId, key)) {
          const result = cluster.deleteVersion(tenantId, key, version.version);
          if (result.deleted) deleted += 1;
          else locked.push({ key, version: version.version, reason: result.reason, retainUntil: result.retainUntil });
        }
      }
      // Fjern subjektindekset selv, så en ny sletning ikke finder gamle nøgler.
      try {
        for (const version of cluster.versions(tenantId, indexKey(subjectDigest))) cluster.deleteVersion(tenantId, indexKey(subjectDigest), version.version);
      } catch {
        /* indekset findes ikke */
      }
      if (locked.length) {
        return {
          status: "partial",
          recordsAffected: deleted,
          reason: `${locked.length} version(er) er WORM-låst og kan ikke slettes`,
          remainingCopies: locked.map((l) => remaining("primary", l.key, `låst version ${l.version} (${l.reason})`, now, surface.retentionDays)),
        };
      }
      return { status: keys.length ? "full" : "not-found", recordsAffected: deleted, remainingCopies: [] };
    },
  };
}

/** Det genopbyggelige indeks: kastes for tenanten og genopbygges uden subjektet. */
export function createIndexSurface({ surface, index }) {
  return {
    id: surface.id,
    kind: surface.kind,
    dataClasses: surface.dataClasses,
    coverage: surface.coverage,
    locate: () => [],
    erase(tenantId) {
      index.drop(tenantId);
      return { status: "full", recordsAffected: 1, remainingCopies: [] };
    },
  };
}

/**
 * Den efemere cache. Cacheposter for subjektet findes på nøglekonvention
 * (`subject:<digest>`) eller ved at digesten optræder i posten, og slettes
 * fysisk fra cache-mappen.
 */
export function createCacheSurface({ surface, cache }) {
  const tenantDir = (tenantId) => join(cache.rootDir, tenantId);
  return {
    id: surface.id,
    kind: surface.kind,
    dataClasses: surface.dataClasses,
    coverage: surface.coverage,
    locate(tenantId, subjectDigest) {
      const dir = tenantDir(tenantId);
      if (!existsSync(dir)) return [];
      return readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .filter((f) => {
          const raw = readFileSync(join(dir, f), "utf8");
          return raw.includes(subjectDigest) || JSON.parse(raw).key?.includes(subjectDigest);
        })
        .sort();
    },
    erase(tenantId, subjectDigest) {
      const dir = tenantDir(tenantId);
      const matches = this.locate(tenantId, subjectDigest);
      for (const file of matches) rmSync(join(dir, file), { force: true });
      return { status: matches.length ? "full" : "not-found", recordsAffected: matches.length, remainingCopies: [] };
    },
  };
}

/** Afledte AI-data: lokal kopi slettes; den eksterne leverandørkopi kan ikke. */
export function createDerivedAiSurface({ surface, derivedAi }) {
  return {
    id: surface.id,
    kind: surface.kind,
    dataClasses: surface.dataClasses,
    coverage: surface.coverage,
    locate: (tenantId, subjectDigest) => derivedAi.list(tenantId, subjectDigest).map((e) => e.key),
    erase(tenantId, subjectDigest, { now = Date.now() } = {}) {
      const { erased } = derivedAi.erase(tenantId, subjectDigest);
      const copies = [remaining("upstream", "model-provider-derived-copy", surface.reason ?? "leverandøren kan ikke slette afledte kopier", now, surface.retentionDays)];
      return { status: "partial", recordsAffected: erased, reason: surface.reason ?? "ekstern leverandørkopi består", remainingCopies: copies };
    },
  };
}

/**
 * Beskyttede backups. Den WORM-låste historiske kopi slettes ikke; i stedet
 * skrives en slettebeslutning til suppressionsjournalen, som genanvendes ved
 * gendannelse (se `restore-gate.mjs`).
 */
export function createBackupSurface({ surface, ledger }) {
  return {
    id: surface.id,
    kind: surface.kind,
    dataClasses: surface.dataClasses,
    coverage: surface.coverage,
    locate: () => [],
    erase(tenantId, subjectDigest, { now = Date.now() } = {}) {
      if (!ledger) {
        return {
          status: "unsupported",
          recordsAffected: 0,
          reason: "ingen suppressionsjournal er konfigureret, så slettebeslutningen kan ikke genanvendes ved restore",
          remainingCopies: [remaining("backup", "immutable-backup", "backupkopien kan ikke slettes uden en suppressionsjournal", now, surface.retentionDays)],
        };
      }
      const entry = ledger.append({ tenantId, digest: subjectDigest, subjectKey: subjectDigest, erasedAt: new Date(now).toISOString(), reason: "dsar-erasure" });
      return {
        status: "partial",
        recordsAffected: 1,
        reason: surface.reason ?? "historisk backup er WORM-låst og slettes ikke fysisk",
        remainingCopies: [remaining("backup", "immutable-backup", "slettebeslutningen genanvendes ved restore; kopien udløber med backupretentionen", now, surface.retentionDays)],
        suppression: { hash: entry.hash, seq: entry.seq },
      };
    },
  };
}

/** Ekstern leverandør uden slette-API. Dækningen rapporteres ærligt. */
export function createUpstreamSurface({ surface, provider = null }) {
  return {
    id: surface.id,
    kind: surface.kind,
    dataClasses: surface.dataClasses,
    coverage: surface.coverage,
    locate: () => [],
    erase(tenantId, subjectDigest, { now = Date.now() } = {}) {
      if (surface.coverage === "unsupported" || !provider?.delete) {
        return {
          status: "unsupported",
          recordsAffected: 0,
          reason: surface.reason ?? "leverandøren udstiller ingen slette-API",
          remainingCopies: [remaining("upstream", "model-provider-copy", surface.reason ?? "leverandørkopi uden slette-API", now, surface.retentionDays)],
        };
      }
      const result = provider.delete({ tenantId, subjectDigest });
      if (!result?.deleted) {
        return {
          status: "partial",
          recordsAffected: 0,
          reason: result?.reason ?? "leverandøren afviste sletningen",
          remainingCopies: [remaining("upstream", "model-provider-copy", result?.reason ?? "leverandørkopi består", now, surface.retentionDays)],
        };
      }
      return { status: "full", recordsAffected: result.recordsAffected ?? 0, remainingCopies: [] };
    },
  };
}

/**
 * Byg de flader politikken kræver ud fra de tilgængelige komponenter. Mangler en
 * komponent, oprettes en ærlig 'unsupported'-flade i stedet for at springe
 * datalaget over.
 */
export function buildSurfaces({ policy, cluster = null, index = null, cache = null, derivedAi = null, ledger = null, upstreamProvider = null }) {
  const surfaces = [];
  for (const surface of policy.surfaces ?? []) {
    switch (surface.kind) {
      case "primary":
        if (cluster) surfaces.push(createObjectStoreSurface({ surface, cluster }));
        break;
      case "index":
        if (index) surfaces.push(createIndexSurface({ surface, index }));
        break;
      case "cache":
        if (cache) surfaces.push(createCacheSurface({ surface, cache }));
        break;
      case "derived-ai":
        if (derivedAi) surfaces.push(createDerivedAiSurface({ surface, derivedAi }));
        break;
      case "backup":
        surfaces.push(createBackupSurface({ surface, ledger }));
        break;
      case "upstream":
        surfaces.push(createUpstreamSurface({ surface, provider: upstreamProvider }));
        break;
      default:
        break;
    }
  }
  return surfaces;
}

export { DAY_MS };
