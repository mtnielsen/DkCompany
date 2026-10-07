/**
 * DKC-059 — filbaseret, holdbar butik for providerudskiftning.
 *
 * Butikken ligger på disk, så en genstart ikke mister poster, id-mapping,
 * providernes read-only-tilstand, credentials, godkendelser, kvitteringer eller
 * referencesporet. Alle mutationer hæver en **epoch**. Et snapshot kan tages før
 * cutover, så en rollback kan gendanne både poster, id-mapping og rettigheder.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { digestOf } from "../../runtime/src/digest.mjs";

const FILES = {
  state: "state.json",
  records: "records.json",
  mappings: "mappings.json",
  providers: "providers.json",
  credentials: "credentials.json",
  approvals: "approvals.json",
  receipts: "receipts.json",
  references: "references.json",
};

function empty() {
  return {
    records: { apiVersion: "contracts.platform/v1alpha1", kind: "ProviderRecordStore", records: {} },
    mappings: { apiVersion: "contracts.platform/v1alpha1", kind: "ProviderIdMappings", mappings: {} },
    providers: { apiVersion: "contracts.platform/v1alpha1", kind: "ProviderStates", providers: {} },
    credentials: { apiVersion: "contracts.platform/v1alpha1", kind: "ProviderCredentials", credentials: {} },
    approvals: { apiVersion: "contracts.platform/v1alpha1", kind: "ProviderApprovals", approvals: {} },
    receipts: { apiVersion: "contracts.platform/v1alpha1", kind: "ProviderSwapReceipts", receipts: {} },
    references: { apiVersion: "contracts.platform/v1alpha1", kind: "ProviderReferenceTrace", references: {} },
  };
}

const recordKey = (provider, targetId) => `${provider}|${targetId}`;
const mappingKey = (tenantId, from, to, sourceId) => `${tenantId}|${from}|${to}|${sourceId}`;

export class FileProviderStore {
  constructor(root) {
    this.root = root;
    this.data = empty();
    this.state = { epoch: 0, updatedAt: null, reason: null };
  }

  static open(root) {
    const store = new FileProviderStore(root);
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

  upsertRecord(provider, record, { at = null } = {}) {
    const key = recordKey(provider, record.targetId);
    const existing = this.data.records.records[key] ?? null;
    const changed = !existing || digestOf(existing) !== digestOf(record);
    this.data.records.records[key] = record;
    if (changed) this.bump(existing ? "record-update" : "record-create", at);
    this.persist();
    return { changed, created: !existing, updated: Boolean(existing) };
  }

  getRecord(provider, targetId) {
    return this.data.records.records[recordKey(provider, targetId)] ?? null;
  }

  listRecords({ provider = null, tenantId = null } = {}) {
    return Object.entries(this.data.records.records)
      .filter(([key]) => (provider ? key.startsWith(`${provider}|`) : true))
      .map(([, value]) => value)
      .filter((record) => (tenantId ? record.tenantId === tenantId : true));
  }

  /* --------------------------- Id-mapping ------------------------------- */

  saveMapping(mapping) {
    const key = mappingKey(mapping.tenantId, mapping.from, mapping.to, mapping.sourceId);
    this.data.mappings.mappings[key] = mapping;
    this.data.references.references[mapping.reference] = { targetId: mapping.targetId, provider: mapping.to, tenantId: mapping.tenantId, sourceId: mapping.sourceId };
    this.bump("mapping", mapping.at ?? null);
    this.persist();
    return mapping;
  }

  getMapping({ tenantId, from, to, sourceId }) {
    return this.data.mappings.mappings[mappingKey(tenantId, from, to, sourceId)] ?? null;
  }

  listMappings({ tenantId = null, from = null, to = null } = {}) {
    return Object.values(this.data.mappings.mappings)
      .filter((m) => (tenantId ? m.tenantId === tenantId : true))
      .filter((m) => (from ? m.from === from : true))
      .filter((m) => (to ? m.to === to : true));
  }

  getReferenceTrace(reference) {
    return this.data.references.references[reference] ?? null;
  }

  listReferenceTrace() {
    return this.data.references.references;
  }

  /* --------------------------- Provider state ---------------------------- */

  setProviderReadOnly(provider, { at = null, reason = "cutover" } = {}) {
    this.data.providers.providers[provider] = { readOnly: true, at, reason };
    this.bump("provider-read-only", at);
    this.persist();
    return this.data.providers.providers[provider];
  }

  setProviderActive(provider, { at = null, reason = "rollback" } = {}) {
    this.data.providers.providers[provider] = { readOnly: false, at, reason };
    this.bump("provider-active", at);
    this.persist();
    return this.data.providers.providers[provider];
  }

  isProviderReadOnly(provider) {
    return this.data.providers.providers[provider]?.readOnly === true;
  }

  listProviderStates() {
    return this.data.providers.providers;
  }

  /* ------------------------------ Credentials ---------------------------- */

  addCredential(credential) {
    this.data.credentials.credentials[credential.id] = { ...credential, active: credential.active !== false, revokedAt: null, reason: null };
    this.persist();
    return this.data.credentials.credentials[credential.id];
  }

  revokeCredential(id, { at = null, reason = "provider-offboarding" } = {}) {
    const existing = this.data.credentials.credentials[id];
    if (!existing) throw new Error(`credential '${id}' findes ikke`);
    existing.active = false;
    existing.revokedAt = at;
    existing.reason = reason;
    this.bump("credential-revoked", at);
    this.persist();
    return existing;
  }

  getCredential(id) {
    return this.data.credentials.credentials[id] ?? null;
  }

  listCredentials({ provider = null, tenantId = null, active = null } = {}) {
    return Object.values(this.data.credentials.credentials)
      .filter((c) => (provider ? c.provider === provider : true))
      .filter((c) => (tenantId ? c.tenantId === tenantId : true))
      .filter((c) => (active === null ? true : c.active === active));
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

  /* ---------------------------- Kvitteringer ----------------------------- */

  saveReceipt(receipt) {
    this.data.receipts.receipts[receipt.swapId] = receipt;
    this.bump("receipt", receipt.at ?? null);
    this.persist();
    return receipt;
  }

  getReceipt(swapId) {
    return this.data.receipts.receipts[swapId] ?? null;
  }

  listReceipts() {
    return Object.values(this.data.receipts.receipts);
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
    return FileProviderStore.open(destDir);
  }

  static discard(root) {
    rmSync(root, { recursive: true, force: true });
  }
}
