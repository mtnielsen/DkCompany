/**
 * DKC-028 — filbaseret, holdbart vidensindeks.
 *
 * Indekset ligger på disk (ikke i hukommelsen), så en genstart ikke mister
 * tenant, klassifikation eller kilde-ACL. Hver mutation (upsert, sletning,
 * ACL-ændring) hæver en **epoch**, som cachen og den afledte AI-visning
 * invalideres på. Sletning er en tombstone, så et allerede indekseret dokument
 * ikke kan genopstå fra cachen.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { digestOf } from "../../runtime/src/digest.mjs";

const INDEX_FILE = "index.json";
const STATE_FILE = "state.json";

function emptyIndex() {
  return { apiVersion: "contracts.platform/v1alpha1", kind: "KnowledgeIndex", documents: {}, deleted: {} };
}

export class FileKnowledgeIndex {
  constructor(root) {
    this.root = root;
    this.data = emptyIndex();
    this.state = { epoch: 0, updatedAt: null };
  }

  static open(root) {
    const index = new FileKnowledgeIndex(root);
    index.load();
    return index;
  }

  load() {
    mkdirSync(this.root, { recursive: true });
    const indexPath = join(this.root, INDEX_FILE);
    const statePath = join(this.root, STATE_FILE);
    this.data = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, "utf8")) : emptyIndex();
    this.state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : { epoch: 0, updatedAt: null };
    return this;
  }

  persist() {
    mkdirSync(this.root, { recursive: true });
    // Atomisk skrivning: skriv til temp og omdøb, så et afbrudt skriv ikke
    // efterlader et halvt indeks.
    const write = (name, value) => {
      const tmp = join(this.root, `${name}.tmp`);
      writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n");
      renameSync(tmp, join(this.root, name));
    };
    write(INDEX_FILE, this.data);
    write(STATE_FILE, this.state);
    return this;
  }

  epoch() {
    return this.state.epoch;
  }

  bump(reason, at = null) {
    this.state = { epoch: this.state.epoch + 1, updatedAt: at ?? new Date().toISOString(), reason };
    return this.state.epoch;
  }

  /** Antal aktive (ikke-slettede) dokumenter. */
  size() {
    return Object.keys(this.data.documents).length;
  }

  get(id) {
    return this.data.documents[id] ?? null;
  }

  isDeleted(id) {
    return Boolean(this.data.deleted[id]);
  }

  list({ tenantId = null, includeDeleted = false } = {}) {
    return Object.values(this.data.documents)
      .filter((d) => (tenantId ? d.tenantId === tenantId : true))
      .filter((d) => (includeDeleted ? true : !d.deletedAt));
  }

  /** Læg eller opdatér et dokument. Returnerer `{ changed, aclChanged }`. */
  upsert(doc, { at = null } = {}) {
    const existing = this.data.documents[doc.id] ?? null;
    const existingAcl = existing ? digestOf(existing.acl ?? {}) : null;
    const nextAcl = digestOf(doc.acl ?? {});
    const contentChanged = !existing || existing.contentSha256 !== doc.contentSha256 || existing.deletedAt !== doc.deletedAt;
    const aclChanged = !existing || existingAcl !== nextAcl;
    const changed = contentChanged || aclChanged;
    this.data.documents[doc.id] = doc;
    if (doc.deletedAt) this.data.deleted[doc.id] = { deletedAt: doc.deletedAt };
    else delete this.data.deleted[doc.id];
    if (changed) this.bump(aclChanged && !contentChanged ? "acl-change" : "content-change", at);
    this.persist();
    return { changed, aclChanged };
  }

  /** Slet et dokument (tombstone). Returnerer `true` hvis det var aktivt. */
  remove(id, { at = null } = {}) {
    const existing = this.data.documents[id];
    if (!existing) return false;
    const wasActive = !existing.deletedAt;
    existing.deletedAt = at ?? new Date().toISOString();
    this.data.deleted[id] = { deletedAt: existing.deletedAt };
    if (wasActive) this.bump("delete", at);
    this.persist();
    return wasActive;
  }

  /** Alle aktive dokumenter for en kilde. */
  listBySource(sourceId) {
    return Object.values(this.data.documents).filter((d) => d.sourceId === sourceId && !d.deletedAt);
  }
}
