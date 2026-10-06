/**
 * DKC-029 — indgående testmail/webformular.
 *
 * En indgående besked (mail eller webformular) bliver én sag:
 *
 *   1. idempotens: samme message-id giver samme sag (et retry skaber ingen
 *      dublet),
 *   2. kø-routing: en kø skal være erklæret for kilden, ellers afvises posten,
 *   3. klassifikation (AI) og prioritering,
 *   4. oprettelse i Zammad gennem adapteren (system-of-record),
 *   5. sikker vedhæftning: hvert bilag pakkes som ubetroet, scannes og kan
 *      aldrig ændre sagens rettigheder,
 *   6. spejling i den holdbare butik med en append-only historik.
 */
import { mapZammadTicket } from "./zammad.mjs";
import { ingestAttachment, attachToTicket } from "./attachments.mjs";
import { classifyTicket, ticketTerms } from "./classification.mjs";
import { findQueue } from "./permissions.mjs";

/** Afvis en besked der peger på en ukendt kø. */
export class IntakeError extends Error {
  constructor(message, code, status = 400) {
    super(message);
    this.name = "IntakeError";
    this.code = code;
    this.status = status;
  }
}

function buildInitialTicket({ source, queue, payload, at }) {
  return {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "SupportTicket",
    id: `${source.id}:pending`,
    sourceId: source.id,
    tenantId: source.tenantId,
    queueId: queue.id,
    queue,
    subject: payload.subject ?? "Indgående henvendelse",
    requester: {
      subject: payload.from?.subject ?? null,
      name: payload.from?.name ?? null,
      email: payload.from?.email ?? null,
      tenantId: source.tenantId,
    },
    channel: payload.channel ?? "email",
    priority: "normal",
    status: "new",
    classification: queue.classification,
    acl: queue.acl,
    messages: [{ id: "inbound-0", direction: "inbound", author: payload.from?.email ?? "unknown", body: payload.body ?? "", untrusted: true, executable: false, at }],
    attachments: [],
    history: [],
    createdAt: at,
    updatedAt: at,
    closedAt: null,
  };
}

/**
 * Tag imod en indgående besked og returnér den spejlede sag.
 *
 * @returns `{ ticket, deduplicated, classification }`.
 */
export async function receiveInbound({ store, source, client, payload, model, policy = source, at = new Date().toISOString() } = {}) {
  if (!store || !source || !client) throw new Error("receiveInbound kræver store, source og client");
  if (!payload?.messageId) throw new IntakeError("indgående besked mangler message-id", "missing_message_id");

  const existing = store.findByMessageId(source.tenantId, payload.messageId);
  if (existing) return { ticket: existing, deduplicated: true, classification: { priority: existing.priority, category: existing.category ?? "general" } };

  const queueId = payload.queueId ?? (source.queues ?? [])[0]?.id;
  const queue = findQueue(source, queueId);
  if (!queue) throw new IntakeError(`køen '${queueId}' er ikke erklæret for kilden '${source.id}'`, "unknown_queue", 422);

  const initial = buildInitialTicket({ source, queue, payload, at });
  const classification = await classifyTicket({ ticket: initial, model });
  initial.priority = classification.priority;
  initial.category = classification.category;

  // Opret sagen upstream gennem adapteren. Idempotency-nøglen binder et retry
  // til den samme upstream-sag.
  const customer = payload.from ?? {};
  const created = await client.createTicket({
    title: initial.subject,
    group: queue.id,
    customer,
    priority: initial.priority,
    state: "new",
    idempotencyKey: payload.messageId,
  });
  await client.addArticle({
    ticketId: created.id,
    body: payload.body ?? "",
    type: "note",
    internal: false,
    idempotencyKey: `${payload.messageId}:article`,
  });
  const upstream = await client.getTicket(created.id);
  const ticket = mapZammadTicket(upstream, { source, queue });
  // Gør spejlingen deterministisk: platformen tidsstempler sin egen modtagelse.
  ticket.createdAt = at;
  ticket.updatedAt = at;
  ticket.messages = ticket.messages.map((m) => ({ ...m, at }));
  ticket.history = [];

  // Sikker vedhæftning.
  for (const [i, raw] of (payload.attachments ?? []).entries()) {
    const attachment = ingestAttachment({
      id: `att:${ticket.externalId}:${i}`,
      filename: raw.filename,
      contentType: raw.contentType,
      content: raw.content,
      tenantId: source.tenantId,
      policy: { ...(source.attachmentPolicy ?? {}), ...(policy.attachments ?? {}) },
      now: at,
    });
    attachToTicket({ ticket, attachment });
    store.putAttachmentBlob({ ...attachment, id: `att:${ticket.externalId}:${i}` });
  }

  store.upsertTicket(ticket, { at });
  store.recordMessage(source.tenantId, payload.messageId, ticket.id);
  store.indexTicket(ticket, { terms: ticketTerms(ticket) });

  store.appendHistory({ ticketId: ticket.id, type: "ticket.received", actor: initial.requester.subject, detail: { channel: ticket.channel, messageId: payload.messageId }, at });
  store.appendHistory({ ticketId: ticket.id, type: "ticket.classified", actor: "agent:classification", detail: classification, at });
  store.appendHistory({ ticketId: ticket.id, type: "ticket.queued", actor: "platform:routing", detail: { queueId: queue.id }, at });
  if (ticket.attachments.length > 0) {
    store.appendHistory({
      ticketId: ticket.id,
      type: "ticket.attachments_ingested",
      actor: "platform:attachments",
      detail: { count: ticket.attachments.length, quarantined: ticket.attachments.filter((a) => a.quarantined).length },
      at,
    });
  }

  return { ticket: store.getTicket(ticket.id), deduplicated: false, classification };
}
