/**
 * DKC-031 — filbaseret, holdbar migrationsbutik.
 *
 * Butikken ligger på disk (ikke i hukommelsen), så en genstart ikke mister
 * poster, idempotensnøgler, checkpoints, fejllister, godkendelser eller
 * cutover-kvitteringer. Alle mutationer hæver en **epoch**. Idempotensnøgler
 * og dedup-indekset er tenant-bundne, og et checkpoint gør en afbrudt import
 * resumable uden at gentage allerede importerede objekter.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { digestOf } from "../../runtime/src/digest.mjs";

const FILES = {
  state: "state.json",
  records: "records.json",
  idempotency: "idempotency.json",
  index: "index.json",
  checkpoints: "checkpoints.json",
  errors: "errors.json",
  approvals: "approvals.json",
  cutovers: "cutovers.json",
};

function empty() {
  return {
    records: { apiVersion: "contracts.platform/v1alpha1", kind: "MigrationRecordStore", records: {} },
    idempotency: { apiVersion: "contracts.platform/v1alpha1", kind: "MigrationIdempotency", keys: {} },
    index: { apiVersion: "contracts.platform/v1alpha1", kind: "MigrationIndex", entries: {} },
    checkpoints: { apiVersion: "contracts.platform/v1alpha1", kind: "MigrationCheckpoints", checkpoints: {} },
    errors: { apiVersion: "contracts.platform/v1alpha1", kind: "MigrationErrors", errors: {} },
    approvals: { apiVersion: "contracts.platform/v1alpha1", kind: "MigrationApprovals", approvals: {} },
    cutovers: { apiVersion: "contracts.platform/v1alpha1", kind: "MigrationCutovers", cutovers: {} },
  };
}

export class FileMigrationStore {
  constructor(root) {
    this.root = root;
    this.data = empty();
    this.state = { epoch: 0, updatedAt: null, reason: null };
  }

  static open(root) {
    const store = new FileMigrationStore(root);
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
    for (const key of Object.keys(base)) this.data[key] = read(FILES[key]) ?? base[key];
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
    for (const key of Object.keys(this.data)) write(FILES[key], this.data[key]);
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
    const existing = this.data.records.records[record.reference] ?? null;
    const changed = !existing || digestOf(existing) !== digestOf(record);
    this.data.records.records[record.reference] = record;
    const dedupIndexKey = `${record.tenantId}:${record.appId}:${record.entityType}:${record.dedupKey}`;
    this.data.index.entries[`dedup:${dedupIndexKey}`] = { reference: record.reference };
    if (changed) this.bump(existing ? "record-update" : "record-create", at);
    this.persist();
    return { changed, created: !existing, updated: Boolean(existing), dedupIndexKey };
  }

  getRecord(reference) {
    return this.data.records.records[reference] ?? null;
  }

  listRecords({ tenantId = null, appId = null, entityType = null } = {}) {
    return Object.values(this.data.records.records)
      .filter((r) => (tenantId ? r.tenantId === tenantId : true))
      .filter((r) => (appId ? r.appId === appId : true))
      .filter((r) => (entityType ? r.entityType === entityType : true));
  }

  findByDedupKey(tenantId, appId, entityType, dedupKey) {
    const entry = this.data.index.entries[`dedup:${tenantId}:${appId}:${entityType}:${dedupKey}`];
    return entry ? this.getRecord(entry.reference) : null;
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

  /* --------------------------- Checkpoints ------------------------------- */

  getCheckpoint(sourceId) {
    return this.data.checkpoints.checkpoints[sourceId] ?? null;
  }

  saveCheckpoint(sourceId, checkpoint) {
    this.data.checkpoints.checkpoints[sourceId] = checkpoint;
    this.bump("checkpoint", checkpoint.at ?? null);
    this.persist();
    return checkpoint;
  }

  clearCheckpoint(sourceId) {
    delete this.data.checkpoints.checkpoints[sourceId];
    this.persist();
  }

  /* --------------------------- Fejlliste --------------------------------- */

  appendError(sourceId, entry) {
    this.data.errors.errors[sourceId] = [...(this.data.errors.errors[sourceId] ?? []), entry];
    this.persist();
    return entry;
  }

  listErrors(sourceId = null) {
    if (sourceId) return this.data.errors.errors[sourceId] ?? [];
    return Object.values(this.data.errors.errors).flat();
  }

  clearErrors(sourceId) {
    delete this.data.errors.errors[sourceId];
    this.persist();
  }

  /* --------------------------- Godkendelser ------------------------------ */

  saveApproval(approval) {
    this.data.approvals.approvals[`${approval.tenantId}:${approval.appId}`] = approval;
    this.bump("approval", approval.approvedAt ?? null);
    this.persist();
    return approval;
  }

  getApproval(tenantId, appId) {
    return this.data.approvals.approvals[`${tenantId}:${appId}`] ?? null;
  }

  listApprovals() {
    return Object.values(this.data.approvals.approvals);
  }

  /* ------------------------------ Cutover -------------------------------- */

  saveCutover(receipt) {
    this.data.cutovers.cutovers[`${receipt.tenantId}:${receipt.appId}`] = receipt;
    this.bump("cutover", receipt.at ?? null);
    this.persist();
    return receipt;
  }

  getCutover(tenantId, appId) {
    return this.data.cutovers.cutovers[`${tenantId}:${appId}`] ?? null;
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
    return FileMigrationStore.open(destDir);
  }
}
