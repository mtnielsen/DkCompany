/**
 * DKC-030 — filbaseret, holdbar CRM-butik.
 *
 * Butikken ligger på disk (ikke i hukommelsen), så en genstart ikke mister
 * poster, aktiviteter, kopier eller idempotensnøgler. Alle mutationer hæver en
 * **epoch**. Aktivitetshistorikken er append-only og uforanderlig. En sletning
 * er en tombstone. Idempotensnøgler og dedup-indekset er tenant-bundne, så en
 * gentaget import hverken skaber en dublet eller lækker på tværs af kunder.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { digestOf, sha256Hex } from "../../runtime/src/digest.mjs";

const FILES = {
  state: "state.json",
  records: "records.json",
  activities: "activities.json",
  idempotency: "idempotency.json",
  index: "index.json",
  copies: "copies.json",
};

function empty() {
  return {
    records: { apiVersion: "contracts.platform/v1alpha1", kind: "CrmRecordStore", records: {} },
    activities: { apiVersion: "contracts.platform/v1alpha1", kind: "CrmActivityStore", activities: [] },
    idempotency: { apiVersion: "contracts.platform/v1alpha1", kind: "CrmIdempotency", keys: {} },
    index: { apiVersion: "contracts.platform/v1alpha1", kind: "CrmIndex", entries: {} },
    copies: { apiVersion: "contracts.platform/v1alpha1", kind: "CrmCopyRegistry", copies: {} },
  };
}

export class FileCrmStore {
  constructor(root) {
    this.root = root;
    this.data = empty();
    this.state = { epoch: 0, updatedAt: null, reason: null };
  }

  static open(root) {
    const store = new FileCrmStore(root);
    store.load();
    return store;
  }

  load() {
    mkdirSync(this.root, { recursive: true });
    const read = (name) => {
      const path = join(this.root, name);
      return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
    };
    const base = empty();
    for (const key of ["records", "activities", "idempotency", "index", "copies"]) {
      this.data[key] = read(FILES[key]) ?? base[key];
    }
    this.state = read(FILES.state) ?? { epoch: 0, updatedAt: null, reason: null };
    return this;
  }

  persist() {
    mkdirSync(this.root, { recursive: true });
    const write = (name, value) => {
      const tmp = join(this.root, `${name}.tmp`);
      writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n");
      renameSync(tmp, join(this.root, name));
    };
    for (const key of ["records", "activities", "idempotency", "index", "copies"]) write(FILES[key], this.data[key]);
    write(FILES.state, this.state);
    return this;
  }

  epoch() {
    return this.state.epoch;
  }

  bump(reason, at = null) {
    this.state = { epoch: this.state.epoch + 1, updatedAt: at ?? new Date().toISOString(), reason };
    return this.state.epoch;
  }

  /* ------------------------------ Poster --------------------------------- */

  upsertRecord(record, { at = null } = {}) {
    const existing = this.data.records.records[record.id] ?? null;
    const changed = !existing || digestOf(existing) !== digestOf(record);
    this.data.records.records[record.id] = record;
    const dedupIndexKey = `${record.tenantId}:${record.entityType}:${record.dedupKey}`;
    this.data.index.entries[`dedup:${dedupIndexKey}`] = { reference: record.id };
    if (changed) this.bump(existing ? "record-update" : "record-create", at);
    this.persist();
    return { changed, created: !existing, dedupIndexKey };
  }

  getRecord(reference) {
    return this.data.records.records[reference] ?? null;
  }

  listRecords({ tenantId = null, entityType = null, includeDeleted = false } = {}) {
    return Object.values(this.data.records.records)
      .filter((r) => (tenantId ? r.tenantId === tenantId : true))
      .filter((r) => (entityType ? r.entityType === entityType : true))
      .filter((r) => (includeDeleted ? true : !r.deletedAt));
  }

  findByDedupKey(tenantId, entityType, dedupKey) {
    const entry = this.data.index.entries[`dedup:${tenantId}:${entityType}:${dedupKey}`];
    if (!entry) return null;
    return this.getRecord(entry.reference);
  }

  tombstoneRecord(reference, { at = null } = {}) {
    const record = this.getRecord(reference);
    if (!record) return null;
    const wasActive = !record.deletedAt;
    record.deletedAt = at ?? new Date().toISOString();
    if (wasActive) this.bump("record-delete", at);
    this.persist();
    return { reference, deletedAt: record.deletedAt };
  }

  /* --------------------------- Idempotens -------------------------------- */

  idempotencyKey(tenantId, key) {
    return `${tenantId}:${key}`;
  }

  findIdempotency(tenantId, key) {
    return this.data.idempotency.keys[this.idempotencyKey(tenantId, key)] ?? null;
  }

  recordIdempotency(tenantId, key, reference) {
    this.data.idempotency.keys[this.idempotencyKey(tenantId, key)] = reference;
    this.persist();
    return reference;
  }

  /* --------------------------- Aktiviteter ------------------------------- */

  appendActivity({ reference, type, subject, actor = null, detail = null, at = null } = {}) {
    if (!reference || !type) throw new Error("appendActivity kræver reference og type");
    const event = { reference, type, subject: subject ?? null, actor, detail, at: at ?? new Date().toISOString() };
    this.data.activities.activities.push(event);
    this.bump(`activity:${type}`, event.at);
    this.persist();
    return event;
  }

  listActivities(reference = null) {
    return this.data.activities.activities.filter((a) => (reference ? a.reference === reference : true));
  }

  /** Fjern alle aktiviteter for en post (bruges ved tværgående sletning). */
  removeActivities(reference) {
    const before = this.data.activities.activities.length;
    this.data.activities.activities = this.data.activities.activities.filter((a) => a.reference !== reference);
    const removed = before - this.data.activities.activities.length;
    if (removed > 0) this.bump("activities-removed");
    this.persist();
    return removed;
  }

  activityDigest() {
    return digestOf(this.data.activities.activities);
  }

  /* ------------------------------ Indeks --------------------------------- */

  indexRecord(reference, { terms = [] } = {}) {
    this.data.index.entries[`term:${reference}`] = { reference, terms: [...new Set(terms)].sort() };
    this.persist();
    return this.data.index.entries[`term:${reference}`];
  }

  getIndexEntry(reference) {
    return this.data.index.entries[`term:${reference}`] ?? null;
  }

  removeIndexEntry(reference) {
    const key = `term:${reference}`;
    const existed = Boolean(this.data.index.entries[key]);
    delete this.data.index.entries[key];
    this.persist();
    return existed;
  }

  /* ------------------------------ Kopier --------------------------------- */

  addCopy(reference, { surface, ref, digest = null } = {}) {
    if (!surface || !ref) throw new Error("addCopy kræver surface og ref");
    this.data.copies.copies[reference] = [...(this.data.copies.copies[reference] ?? []).filter((c) => c.surface !== surface), { surface, ref, digest }];
    this.persist();
    return this.data.copies.copies[reference];
  }

  listCopies(reference) {
    return this.data.copies.copies[reference] ?? [];
  }

  removeCopy(reference, surface) {
    const copies = this.data.copies.copies[reference] ?? [];
    const next = copies.filter((c) => c.surface !== surface);
    const removed = next.length !== copies.length;
    if (next.length) this.data.copies.copies[reference] = next;
    else delete this.data.copies.copies[reference];
    this.persist();
    return removed;
  }

  /** Skriv en kopi af en post til disken og registrér den. */
  putCopyBlob({ reference, surface, content, at = null } = {}) {
    const digest = sha256Hex(typeof content === "string" ? content : JSON.stringify(content));
    const safe = reference.replace(/[^A-Za-z0-9._-]/g, "_");
    const rel = join("copies", surface, `${safe}.json`);
    const path = join(this.root, rel);
    mkdirSync(join(this.root, "copies", surface), { recursive: true });
    writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content, null, 2) + "\n");
    this.bump("copy-added", at);
    this.addCopy(reference, { surface, ref: rel, digest });
    return { reference, surface, ref: rel, digest };
  }

  getCopyBlob(ref) {
    const path = join(this.root, ref);
    return existsSync(path) ? readFileSync(path, "utf8") : null;
  }

  removeCopyBlob(ref) {
    const path = join(this.root, ref);
    if (!existsSync(path)) return false;
    rmSync(path, { force: true });
    return true;
  }

  /* ------------------------- Backup / gendannelse ------------------------ */

  snapshot(destDir) {
    mkdirSync(destDir, { recursive: true });
    cpSync(this.root, destDir, { recursive: true });
    return destDir;
  }

  static restore(srcDir, destDir) {
    mkdirSync(destDir, { recursive: true });
    cpSync(srcDir, destDir, { recursive: true });
    return FileCrmStore.open(destDir);
  }
}
