/**
 * DKC-028 — synkronisering fra en read-only videnskilde ind i indekset.
 *
 * Synkroniseringen læser kilden, mapper sider til dokumenter og opdager
 * ændringer: en ny/ændret side opdateres, en ændret ACL hæver indeksets epoch,
 * og en side der ikke længere findes i kilden (eller er slettet der) fjernes
 * som tombstone. Der skrives aldrig tilbage til kilden.
 */
import { mapPageToDocument, aclDigest } from "./bookstack.mjs";
import { reconcilePermissions } from "./invalidation.mjs";

/**
 * Synkronisér én kilde.
 *
 * @returns `{ sourceId, upserted, removed, changed, total }`.
 */
export async function syncSource({ client, source, index, at = null } = {}) {
  const listing = await client.listPages({ count: 500, offset: 0 });
  const pages = Array.isArray(listing) ? listing : listing?.data ?? [];
  const documents = [];
  for (const page of pages) {
    let permissions = page.permissions ?? null;
    if (!permissions) {
      const result = await client.pagePermissions(page.id);
      permissions = result?.permissions ?? null;
    }
    documents.push(mapPageToDocument(page, { source, permissions }));
  }

  let upserted = 0;
  let changed = 0;
  const seen = new Set();
  for (const doc of documents) {
    seen.add(doc.id);
    const stored = index.get(doc.id);
    const aclChanged = stored ? aclDigest(stored) !== aclDigest(doc) : true;
    const result = index.upsert(doc, { at });
    if (result.changed) changed += 1;
    if (!stored || aclChanged || stored.contentSha256 !== doc.contentSha256) upserted += 1;
  }

  // Sider der er forsvundet eller slettet i kilden fjernes fra indekset.
  const removed = [];
  for (const stored of index.listBySource(source.id)) {
    const current = documents.find((d) => d.id === stored.id);
    if (!current || current.deletedAt) {
      index.remove(stored.id, { at });
      removed.push(stored.id);
    }
  }

  return { sourceId: source.id, upserted, removed: removed.length, changed, total: documents.length };
}

/** Synkronisér flere kilder sekventielt. */
export async function syncAll({ clients, sources, index, at = null } = {}) {
  const results = [];
  for (const source of sources) {
    const client = clients[source.id];
    if (!client) throw new Error(`ingen klient for kilden '${source.id}'`);
    results.push(await syncSource({ client, source, index, at }));
  }
  return results;
}

/**
 * Afstem indekset mod en frisk læsning af kilden uden at skrive nye
 * dokumenter — bruges når en ekstern permission-ændring skal slå igennem på
 * allerede indekseret indhold.
 */
export function reconcileSource({ index, source, documents, at = null }) {
  return reconcilePermissions({ index, sourceDocuments: documents.filter((d) => d.sourceId === source.id), at });
}
