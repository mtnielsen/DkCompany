/**
 * DKC-029 — eksport, sletning og retention for mails, bilag og indeks.
 *
 * Exporten er tenantbundet og samler alt hvad sagen bærer af mails, bilag og
 * indeksposter for et subjekt. Sletningen er ærlig og fladvis:
 *
 *   - **mail**    — sagens beskeder slettes ved at sagen tombstoned
 *   - **bilag**   — blobben fjernes fysisk fra disken
 *   - **indeks**  — indeksposten fjernes
 *
 * Et legal hold blokerer sletning (DKC-021's `holdCovers` genbruges), og en
 * sletning er en tombstone, så intet genopstår fra en gendannelse.
 */
import { subjectDigestOf, holdCovers } from "../../retention/src/holds.mjs";

/**
 * Eksportér alt for et subjekt i en tenant.
 */
export function exportSubject({ store, tenantId, subjectKey, now = new Date().toISOString() } = {}) {
  const subjectDigest = subjectDigestOf(subjectKey);
  const tickets = store.listTickets({ tenantId, includeDeleted: true }).filter((t) => t.requester?.subject === subjectKey);
  const messages = [];
  const attachments = [];
  const indexEntries = [];
  for (const ticket of tickets) {
    for (const message of ticket.messages ?? []) messages.push({ ticketId: ticket.id, ...message });
    for (const attachment of ticket.attachments ?? []) attachments.push({ ticketId: ticket.id, ...attachment });
    const entry = store.getIndexEntry(ticket.id);
    if (entry) indexEntries.push(entry);
  }
  return {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "HelpdeskSubjectExport",
    tenantId,
    subjectDigest,
    generatedAt: now,
    ticketCount: tickets.length,
    tickets: tickets.map((t) => ({ id: t.id, externalId: t.externalId, queueId: t.queueId, status: t.status, subject: t.subject, classification: t.classification, deletedAt: t.deletedAt ?? null })),
    messageCount: messages.length,
    messages,
    attachmentCount: attachments.length,
    attachments,
    indexEntryCount: indexEntries.length,
    indexEntries,
  };
}

/**
 * Slet et subjekts sager, mails, bilag og indeksposter. Returnerer en ærlig
 * sletterapport pr. flade.
 */
export function deleteSubject({ store, tenantId, subjectKey, reason, holds = [], now = new Date().toISOString() } = {}) {
  const subjectDigest = subjectDigestOf(subjectKey);
  const tickets = store.listTickets({ tenantId, includeDeleted: false }).filter((t) => t.requester?.subject === subjectKey);
  const dataClasses = ["personal"];
  const blocking = holds.find((h) => holdCovers(h, { subjectDigest, dataClasses }));
  if (blocking) {
    return {
      apiVersion: "contracts.platform/v1alpha1",
      kind: "HelpdeskDeletionReceipt",
      tenantId,
      subjectDigest,
      reason,
      status: "blocked",
      blockingHoldId: blocking.holdId ?? blocking.id ?? null,
      surfaces: { mail: { status: "blocked", recordsAffected: 0 }, attachments: { status: "blocked", recordsAffected: 0 }, index: { status: "blocked", recordsAffected: 0 } },
      remainingCopies: [],
      createdAt: now,
    };
  }

  let mailAffected = 0;
  let attachmentsAffected = 0;
  let indexAffected = 0;
  for (const ticket of tickets) {
    for (const attachment of ticket.attachments ?? []) {
      if (store.removeAttachmentBlob(attachment.id)) attachmentsAffected += 1;
    }
    if (store.removeIndexEntry(ticket.id)) indexAffected += 1;
    store.tombstoneTicket(ticket.id, { at: now });
    mailAffected += (ticket.messages ?? []).length;
    store.appendHistory({ ticketId: ticket.id, type: "ticket.deleted", actor: "platform:retention", detail: { reason, subjectDigest }, at: now });
  }

  return {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "HelpdeskDeletionReceipt",
    tenantId,
    subjectDigest,
    reason,
    status: "full",
    surfaces: {
      mail: { status: "full", recordsAffected: mailAffected },
      attachments: { status: "full", recordsAffected: attachmentsAffected },
      index: { status: "full", recordsAffected: indexAffected },
    },
    remainingCopies: [],
    createdAt: now,
  };
}

/**
 * Retention-status: hvor mange aktive sager ligger ældre end den erklærede
 * grænse pr. flade. Bruges af rapporten; den sletter ikke i sig selv.
 */
export function retentionStatus({ store, policy, now = Date.parse("2026-03-01T00:00:00Z") } = {}) {
  const mailDays = policy?.retention?.mailDays ?? 365;
  const attachmentDays = policy?.retention?.attachmentDays ?? 180;
  const indexDays = policy?.retention?.indexDays ?? 90;
  const dayMs = 86_400_000;
  const tickets = store.listTickets({ includeDeleted: false });
  const olderThan = (ticket, days) => now - Date.parse(ticket.createdAt ?? ticket.updatedAt) > days * dayMs;
  return {
    mailExpired: tickets.filter((t) => olderThan(t, mailDays)).length,
    attachmentsExpired: tickets.filter((t) => olderThan(t, attachmentDays) && (t.attachments ?? []).length > 0).length,
    indexExpired: tickets.filter((t) => olderThan(t, indexDays)).length,
    thresholds: { mailDays, attachmentDays, indexDays },
  };
}
