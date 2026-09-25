/**
 * DKC-029 — godkendelsesgate for afsendelse og lukning.
 *
 * AI'en udkaster; et **menneske** godkender; afsendelsen er en separat
 * handling. Godkendelsen bindes til det præcise udkast via dets digest
 * (`draft-digest`), tenant og en udløbsfrist. Ændres udkastet, matcher
 * digesten ikke længere, og godkendelsen holder ikke. En demo-identitet eller
 * en ikke-menneskelig principal kan aldrig godkende.
 *
 * Lukning af en sag er også en godkendelsespligtig handling og bindes til
 * sagens ændringsdigest.
 */
import { digestOf } from "../../runtime/src/digest.mjs";
import { decideTicketAccess } from "./permissions.mjs";
import { isExternalCustomer } from "./model.mjs";

export class HelpdeskApprovalError extends Error {
  constructor(message, code, status = 403) {
    super(message);
    this.name = "HelpdeskApprovalError";
    this.code = code;
    this.status = status;
  }
}

function assertHumanApprover(approver) {
  if (!approver || typeof approver.id !== "string" || approver.id.length === 0) {
    throw new HelpdeskApprovalError("manglende verificeret godkender-identitet", "unauthenticated", 401);
  }
  if (approver.kind !== "human") throw new HelpdeskApprovalError("kun et menneske kan godkende", "approver_not_human", 403);
  if (approver.demo === true) throw new HelpdeskApprovalError("demo-identitet kan ikke godkende", "approver_demo", 403);
}

/** Registrér en menneskelig godkendelse af et svarudkast. */
export function recordReplyApproval({ store, draft, approver, now = new Date().toISOString(), policy = {} } = {}) {
  assertHumanApprover(approver);
  if (!draft?.draftDigest) throw new HelpdeskApprovalError("udkastet mangler et digest", "missing_draft_digest");
  if (draft.dispatchedBy && draft.dispatchedBy === approver.id) {
    throw new HelpdeskApprovalError("selvgodkendelse er forbudt", "self_approval", 403);
  }
  const expiresInMinutes = policy.approvals?.expiresInMinutes ?? 60;
  const approval = {
    id: `appr:${draft.draftDigest.slice(0, 16)}`,
    action: "ticket.reply.send",
    tenantId: draft.tenantId,
    ticketId: draft.ticketId,
    draftId: draft.id,
    draftDigest: draft.draftDigest,
    status: "approved",
    approvedBy: approver.id,
    approvedAt: now,
    expiresAt: new Date(Date.parse(now) + expiresInMinutes * 60_000).toISOString(),
  };
  store.saveApproval(approval, { at: now });
  store.appendHistory({ ticketId: draft.ticketId, type: "ticket.reply_approval_recorded", actor: approver.id, detail: { approvalId: approval.id, expiresAt: approval.expiresAt }, at: now });
  return approval;
}

/** Afgør om en godkendelse gyldigt dækker handlingen. */
export function checkApproval({ store, approvalId, action, binding, tenantId, now = new Date().toISOString() } = {}) {
  const approval = approvalId ? store.getApproval(approvalId) : null;
  if (!approval) return { ok: false, reason: "no-approval" };
  if (approval.action !== action) return { ok: false, reason: "wrong-action" };
  if (approval.status !== "approved") return { ok: false, reason: "not-approved" };
  if (approval.tenantId !== tenantId) return { ok: false, reason: "tenant-mismatch" };
  if (binding && approval.draftDigest !== binding && approval.changeDigest !== binding) return { ok: false, reason: "binding-mismatch" };
  if (Date.parse(now) > Date.parse(approval.expiresAt)) return { ok: false, reason: "expired" };
  return { ok: true, approval };
}

function assertCanAct({ principal, ticket }) {
  const decision = decideTicketAccess({ principal, ticket, queue: ticket.queue });
  if (!decision.allowed) throw new HelpdeskApprovalError(`adgang nægtet (${decision.reason})`, "access_denied", 403);
  if (isExternalCustomer(principal)) throw new HelpdeskApprovalError("en ekstern kunde kan ikke sende agentsvar", "external_cannot_reply", 403);
}

/**
 * Send et svarudkast. Afsendelse er en separat handling og kræver en gyldig
 * godkendelse bundet til udkastets digest. Uden den sendes intet.
 */
export async function sendReply({ store, client, ticketId, draftId, principal, approvalId = null, now = new Date().toISOString(), policy = {} } = {}) {
  const ticket = store.getTicket(ticketId);
  const draft = store.getDraft(draftId);
  if (!ticket || !draft) throw new HelpdeskApprovalError("sag eller udkast findes ikke", "not_found", 404);
  assertCanAct({ principal, ticket });

  const approval = checkApproval({ store, approvalId, action: "ticket.reply.send", binding: draft.draftDigest, tenantId: draft.tenantId, now });
  if (!approval.ok) {
    store.appendHistory({ ticketId, type: "ticket.reply_send_denied", actor: principal?.id ?? "unknown", detail: { reason: approval.reason, draftId }, at: now });
    throw new HelpdeskApprovalError(`afsendelse nægtet: ${approval.reason}`, "approval_required", 428);
  }

  await client.addArticle({
    ticketId: ticket.externalId,
    body: draft.body,
    type: "email",
    to: ticket.requester?.email ?? null,
    subject: ticket.subject,
    internal: false,
    idempotencyKey: `send:${draft.draftDigest}`,
  });

  const message = {
    id: `outbound:${draft.draftDigest.slice(0, 16)}`,
    direction: "outbound",
    author: principal.id,
    body: draft.body,
    untrusted: true,
    executable: false,
    at: now,
    approvalId: approval.approval.id,
  };
  ticket.messages = [...(ticket.messages ?? []), message];
  ticket.status = ticket.status === "new" ? "open" : ticket.status;
  ticket.updatedAt = now;
  store.upsertTicket(ticket, { at: now });
  const sent = { ...draft, approvalId: approval.approval.id, sentAt: now };
  store.saveDraft(sent, { at: now });
  store.appendHistory({ ticketId, type: "ticket.reply_sent", actor: principal.id, detail: { approvalId: approval.approval.id, draftId }, at: now });
  return { sent: true, draft: sent, message, approval: approval.approval };
}

/** Registrér en menneskelig godkendelse af en lukning. */
export function recordCloseApproval({ store, ticket, approver, now = new Date().toISOString(), policy = {} } = {}) {
  assertHumanApprover(approver);
  const changeDigest = digestOf({ ticketId: ticket.id, action: "ticket.close" });
  const expiresInMinutes = policy.approvals?.expiresInMinutes ?? 60;
  const approval = {
    id: `appr:close:${changeDigest.slice(0, 12)}`,
    action: "ticket.close",
    tenantId: ticket.tenantId,
    ticketId: ticket.id,
    changeDigest,
    status: "approved",
    approvedBy: approver.id,
    approvedAt: now,
    expiresAt: new Date(Date.parse(now) + expiresInMinutes * 60_000).toISOString(),
  };
  store.saveApproval(approval, { at: now });
  store.appendHistory({ ticketId: ticket.id, type: "ticket.close_approval_recorded", actor: approver.id, detail: { approvalId: approval.id }, at: now });
  return approval;
}

/** Luk en sag. Kræver en gyldig, ændringsbundet godkendelse. */
export async function closeTicket({ store, client, ticketId, principal, approvalId = null, now = new Date().toISOString(), policy = {} } = {}) {
  const ticket = store.getTicket(ticketId);
  if (!ticket) throw new HelpdeskApprovalError("sagen findes ikke", "not_found", 404);
  assertCanAct({ principal, ticket });
  const changeDigest = digestOf({ ticketId: ticket.id, action: "ticket.close" });
  const approval = checkApproval({ store, approvalId, action: "ticket.close", binding: changeDigest, tenantId: ticket.tenantId, now });
  if (!approval.ok) {
    store.appendHistory({ ticketId, type: "ticket.close_denied", actor: principal?.id ?? "unknown", detail: { reason: approval.reason }, at: now });
    throw new HelpdeskApprovalError(`lukning nægtet: ${approval.reason}`, "approval_required", 428);
  }
  await client.updateTicket(ticket.externalId, { state: "closed" });
  ticket.status = "closed";
  ticket.closedAt = now;
  ticket.updatedAt = now;
  store.upsertTicket(ticket, { at: now });
  store.appendHistory({ ticketId, type: "ticket.closed", actor: principal.id, detail: { approvalId: approval.approval.id }, at: now });
  return store.getTicket(ticketId);
}
