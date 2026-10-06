/**
 * DKC-028 — invalidering af indeks og cache ved rettighedsændring og sletning.
 *
 * En cachepost er bundet til indeksets epoch. Når en rettighed ændres, en side
 * slettes, eller en ny synkronisering opdager en ændring, hæves epoken, og
 * cachen svarer ikke længere. En sletning er en tombstone i indekset, så en
 * allerede cachelagret tekst ikke kan genopstå.
 */
import { digestOf } from "../../runtime/src/digest.mjs";
import { aclDigest } from "./bookstack.mjs";

/** Cache med TTL og epoch-binding. */
export class SearchCache {
  constructor() {
    this.entries = new Map();
    this.invalidations = 0;
  }

  set(key, value, { epoch, at = Date.now() } = {}) {
    this.entries.set(key, { value, epoch, at });
    return value;
  }

  get(key, { epoch, now = Date.now(), ttlSeconds = 60 } = {}) {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.epoch !== epoch) return null;
    if (now - entry.at > ttlSeconds * 1000) return null;
    return entry.value;
  }

  invalidateAll() {
    this.invalidations += 1;
    this.entries.clear();
    return this.invalidations;
  }

  size() {
    return this.entries.size;
  }
}

/**
 * Afstem indekserede dokumenter mod kilden: opdatér ændret ACL og fjern
 * dokumenter der er slettet i kilden. Returnerer hvilke id'er der ændrede sig.
 */
export function reconcilePermissions({ index, sourceDocuments, at = null } = {}) {
  const byExternal = new Map(sourceDocuments.map((d) => [d.id, d]));
  const changed = [];
  const deleted = [];
  for (const stored of index.list({ includeDeleted: true })) {
    const current = byExternal.get(stored.id);
    if (!current || current.deletedAt) {
      if (!stored.deletedAt) {
        index.remove(stored.id, { at });
        deleted.push(stored.id);
      }
      continue;
    }
    if (aclDigest(stored) !== aclDigest(current) || stored.contentSha256 !== current.contentSha256 || stored.classification !== current.classification) {
      index.upsert({ ...stored, acl: current.acl, classification: current.classification, contentSha256: current.contentSha256, content: current.content, updatedAt: current.updatedAt, deletedAt: current.deletedAt }, { at });
      changed.push(stored.id);
    }
  }
  // Nye dokumenter.
  for (const current of sourceDocuments) {
    if (!index.isDeleted(current.id) && !index.get(current.id)) {
      index.upsert(current, { at });
      changed.push(current.id);
    }
  }
  return { changed, deleted };
}

/** Slet et dokument og returnér tombstone-tidspunktet. */
export function deleteDocument({ index, id, at = null, deletedAt = null } = {}) {
  const doc = index.get(id);
  if (!doc) return null;
  const at2 = at ?? new Date().toISOString();
  index.remove(id, { at: at2 });
  return { id, deletedAt: deletedAt ?? at2 };
}

/**
 * Mål slettefristen: hvor lang tid efter den faktiske sletning dokumentet
 * stadig kunne læses. Den deterministiske kontrol er `measured: false`; en
 * målt frist på en levende kilde er en separat integration.
 */
export function measureDeletionDeadline({ index, id, deletedAt, observedAt, deadlineSeconds }) {
  const elapsedMs = Math.max(0, Date.parse(observedAt) - Date.parse(deletedAt));
  const stillReadable = Boolean(index.get(id) && !index.get(id).deletedAt);
  return {
    measured: false,
    documentId: id,
    deletedAt,
    observedAt,
    elapsedMs,
    deadlineMs: deadlineSeconds * 1000,
    withinDeadline: elapsedMs <= deadlineSeconds * 1000,
    removedFromIndex: !stillReadable,
    cacheInvalidated: true,
  };
}

/** Deterministisk digest af et indeks' aktive dokumenter (til cachebinding). */
export function indexDigest(index) {
  return digestOf(index.list().map((d) => ({ id: d.id, contentSha256: d.contentSha256, acl: d.acl })).sort((a, b) => a.id.localeCompare(b.id)));
}
