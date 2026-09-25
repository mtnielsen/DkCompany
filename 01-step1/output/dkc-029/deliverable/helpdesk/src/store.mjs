/**
 * DKC-029 — filbaseret, holdbar sagsbehandlingsbutik.
 *
 * Butikken ligger på disk (ikke i hukommelsen), så en genstart ikke mister
 * sager, historik, udkast, godkendelser eller vedhæftninger. Alle mutationer
 * hæver en **epoch**. Historikken er append-only og uforanderlig: en post
 * tilføjes, aldrig omskrives. Idempotensnøgler (fx en mailmessage-id) binder en
 * gentaget indgang til den samme sag, så et retry ikke skaber en dublet.
 *
 * En sletning er en tombstone; selve blobben fjernes, men et spor af
 * sletningen bevares, så en gendannelse kan afvise at genoplive slettet
 * indhold.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { digestOf } from "../../runtime/src/digest.mjs";

const FILES = {
  state: "state.json",
  tickets: "tickets.json",
  history: "history.json",
  drafts: "drafts.json",
  approvals: "approvals.json",
  messages: "messages.json",
  index: "index.json",
};

function empty() {
  return {
    tickets: { apiVersion: "contracts.platform/v1alpha1", kind: "HelpdeskTicketStore", tickets: {} },
    history: { apiVersion: "contracts.platform/v1alpha1", kind: "HelpdeskHistory", events: [] },
    drafts: { apiVersion: "contracts.platform/v1alpha1", kind: "HelpdeskDraftStore", drafts: {} },
    approvals: { apiVersion: "contracts.platform/v1alpha1", kind: "HelpdeskApprovalStore", approvals: {} },
    messages: { apiVersion: "contracts.platform/v1alpha1", kind: "HelpdeskMessageIndex", messages: {} },
    index: { apiVersion: "contracts.platform/v1alpha1", kind: "HelpdeskIndex", entries: {} },
  };
}

export class FileHelpdeskStore {
  constructor(root) {
    this.root = root;
    this.data = empty();
    this.state = { epoch: 0, updatedAt: null, reason: null };
  }

  static open(root) {
    const store = new FileHelpdeskStore(root);
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
    for (const key of ["tickets", "history", "drafts", "approvals", "messages", "index"]) {
      this.data[key] = read(FILES[key]) ?? base[key];
    }
    this.state = read(FILES.state) ?? { epoch: 0, updatedAt: null, reason: null };
    mkdirSync(join(this.root, "attachments"), { recursive: true });
    return this;
  }

  persist() {
    mkdirSync(this.root, { recursive: true });
    const write = (name, value) => {
      const tmp = join(this.root, `${name}.tmp`);
      writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n");
      renameSync(tmp, join(this.root, name));
    };
    for (const key of ["tickets", "history", "drafts", "approvals", "messages", "index"]) write(FILES[key], this.data[key]);
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

  /* ------------------------------ Sager ---------------------------------- */

  upsertTicket(ticket, { at = null } = {}) {
    const existing = this.data.tickets.tickets[ticket.id] ?? null;
    const changed = !existing || digestOf(existing) !== digestOf(ticket);
    this.data.tickets.tickets[ticket.id] = ticket;
    if (changed) this.bump(existing ? "ticket-update" : "ticket-create", at);
    this.persist();
    return { changed, created: !existing };
  }

  getTicket(id) {
    return this.data.tickets.tickets[id] ?? null;
  }

  listTickets({ tenantId = null, includeDeleted = false } = {}) {
    return Object.values(this.data.tickets.tickets)
      .filter((t) => (tenantId ? t.tenantId === tenantId : true))
      .filter((t) => (includeDeleted ? true : !t.deletedAt));
  }

  tombstoneTicket(id, { at = null } = {}) {
    const ticket = this.getTicket(id);
    if (!ticket) return null;
    const wasActive = !ticket.deletedAt;
    ticket.deletedAt = at ?? new Date().toISOString();
    if (wasActive) this.bump("ticket-delete", at);
    this.persist();
    return { id, deletedAt: ticket.deletedAt };
  }

  /* ----------------------------- Historik -------------------------------- */

  appendHistory({ ticketId, type, actor = null, detail = null, at = null } = {}) {
    if (!ticketId || !type) throw new Error("appendHistory kræver ticketId og type");
    const event = { ticketId, type, actor, detail, at: at ?? new Date().toISOString() };
    this.data.history.events.push(event);
    this.bump(`history:${type}`, event.at);
    this.persist();
    return event;
  }

  listHistory(ticketId = null) {
    return this.data.history.events.filter((e) => (ticketId ? e.ticketId === ticketId : true));
  }

  historyDigest() {
    return digestOf(this.data.history.events);
  }

  /* ------------------------------ Udkast --------------------------------- */

  saveDraft(draft, { at = null } = {}) {
    this.data.drafts.drafts[draft.id] = draft;
    this.bump("draft-save", at);
    this.persist();
    return draft;
  }

  getDraft(id) {
    return this.data.drafts.drafts[id] ?? null;
  }

  listDrafts({ tenantId = null } = {}) {
    return Object.values(this.data.drafts.drafts).filter((d) => (tenantId ? d.tenantId === tenantId : true));
  }

  /* --------------------------- Godkendelser ------------------------------ */

  saveApproval(approval, { at = null } = {}) {
    this.data.approvals.approvals[approval.id] = approval;
    this.bump("approval-save", at);
    this.persist();
    return approval;
  }

  getApproval(id) {
    return this.data.approvals.approvals[id] ?? null;
  }

  /* --------------------------- Idempotens -------------------------------- */

  messageKey(tenantId, messageId) {
    return `${tenantId}:${messageId}`;
  }

  findByMessageId(tenantId, messageId) {
    const ticketId = this.data.messages.messages[this.messageKey(tenantId, messageId)];
    return ticketId ? this.getTicket(ticketId) : null;
  }

  recordMessage(tenantId, messageId, ticketId) {
    this.data.messages.messages[this.messageKey(tenantId, messageId)] = ticketId;
    this.persist();
    return ticketId;
  }

  /* ------------------------------ Indeks --------------------------------- */

  indexTicket(ticket, { terms = [] } = {}) {
    this.data.index.entries[ticket.id] = { ticketId: ticket.id, tenantId: ticket.tenantId, terms: [...new Set(terms)].sort() };
    this.persist();
    return this.data.index.entries[ticket.id];
  }

  getIndexEntry(ticketId) {
    return this.data.index.entries[ticketId] ?? null;
  }

  removeIndexEntry(ticketId) {
    const existed = Boolean(this.data.index.entries[ticketId]);
    delete this.data.index.entries[ticketId];
    this.persist();
    return existed;
  }

  /* --------------------------- Vedhæftninger ----------------------------- */

  putAttachmentBlob(attachment) {
    mkdirSync(join(this.root, "attachments"), { recursive: true });
    const path = join(this.root, "attachments", `${attachment.id.replace(/[^A-Za-z0-9._-]/g, "_")}.txt`);
    writeFileSync(path, attachment.content ?? "");
    return path;
  }

  getAttachmentBlob(id) {
    const path = join(this.root, "attachments", `${id.replace(/[^A-Za-z0-9._-]/g, "_")}.txt`);
    return existsSync(path) ? readFileSync(path, "utf8") : null;
  }

  removeAttachmentBlob(id) {
    const path = join(this.root, "attachments", `${id.replace(/[^A-Za-z0-9._-]/g, "_")}.txt`);
    if (!existsSync(path)) return false;
    rmSync(path, { force: true });
    return true;
  }

  /* ------------------------- Backup / gendannelse ------------------------ */

  /** Tag et konsistent snapshot af butikken. */
  snapshot(destDir) {
    mkdirSync(destDir, { recursive: true });
    cpSync(this.root, destDir, { recursive: true });
    return destDir;
  }

  /** Gendan et snapshot til en (ny) butiksmappe. */
  static restore(srcDir, destDir) {
    mkdirSync(destDir, { recursive: true });
    cpSync(srcDir, destDir, { recursive: true });
    return FileHelpdeskStore.open(destDir);
  }
}
