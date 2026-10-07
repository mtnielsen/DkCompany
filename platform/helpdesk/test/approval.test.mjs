import { test } from "node:test";
import assert from "node:assert/strict";
import { setupHelpdesk, SUPPORT, APPROVER } from "./helpers.mjs";
import { createDeterministicHelpdeskModel, draftReply } from "../src/classification.mjs";
import { recordReplyApproval, sendReply, recordCloseApproval, closeTicket, HelpdeskApprovalError } from "../src/approval-gate.mjs";

const AT = "2026-03-01T00:00:00Z";

async function makeDraft(ctx, ticket) {
  const draft = await draftReply({ ticket, model: createDeterministicHelpdeskModel(), policy: ctx.all.policy, now: AT });
  ctx.store.saveDraft(draft, { at: AT });
  return draft;
}

test("et udkast sendes ikke uden en godkendelse", async () => {
  const ctx = await setupHelpdesk();
  try {
    const ticket = ctx.store.listTickets({ tenantId: "acme" }).find((t) => t.queueId === "support");
    const draft = await makeDraft(ctx, ticket);
    await assert.rejects(
      () => sendReply({ store: ctx.store, client: ctx.clients["zammad-acme"], ticketId: ticket.id, draftId: draft.id, principal: SUPPORT, approvalId: null, now: AT, policy: ctx.all.policy }),
      (err) => err instanceof HelpdeskApprovalError && err.code === "approval_required"
    );
    assert.equal(ctx.store.getDraft(draft.id).sentAt, null);
  } finally {
    await ctx.close();
  }
});

test("en godkendelse kan ikke genbruges på et ændret udkast", async () => {
  const ctx = await setupHelpdesk();
  try {
    const ticket = ctx.store.listTickets({ tenantId: "acme" }).find((t) => t.queueId === "support");
    const draft = await makeDraft(ctx, ticket);
    const approval = recordReplyApproval({ store: ctx.store, draft, approver: APPROVER, now: AT, policy: ctx.all.policy });
    const tampered = { ...draft, draftDigest: "0".repeat(64) };
    ctx.store.saveDraft(tampered, { at: AT });
    await assert.rejects(
      () => sendReply({ store: ctx.store, client: ctx.clients["zammad-acme"], ticketId: ticket.id, draftId: tampered.id, principal: SUPPORT, approvalId: approval.id, now: AT, policy: ctx.all.policy }),
      (err) => err.code === "approval_required"
    );
  } finally {
    await ctx.close();
  }
});

test("et gyldigt godkendt udkast sendes", async () => {
  const ctx = await setupHelpdesk();
  try {
    const ticket = ctx.store.listTickets({ tenantId: "acme" }).find((t) => t.queueId === "support");
    const draft = await makeDraft(ctx, ticket);
    const approval = recordReplyApproval({ store: ctx.store, draft, approver: APPROVER, now: AT, policy: ctx.all.policy });
    const sent = await sendReply({ store: ctx.store, client: ctx.clients["zammad-acme"], ticketId: ticket.id, draftId: draft.id, principal: SUPPORT, approvalId: approval.id, now: AT, policy: ctx.all.policy });
    assert.equal(sent.sent, true);
    assert.ok(sent.draft.sentAt);
    assert.equal(ctx.store.getTicket(ticket.id).status, "open");
  } finally {
    await ctx.close();
  }
});

test("en demo-identitet kan ikke godkende", async () => {
  const ctx = await setupHelpdesk();
  try {
    const ticket = ctx.store.listTickets({ tenantId: "acme" }).find((t) => t.queueId === "support");
    const draft = await makeDraft(ctx, ticket);
    assert.throws(
      () => recordReplyApproval({ store: ctx.store, draft, approver: { ...APPROVER, demo: true }, now: AT, policy: ctx.all.policy }),
      (err) => err.code === "approver_demo"
    );
  } finally {
    await ctx.close();
  }
});

test("en sag kan lukkes med en gyldig godkendelse og historik", async () => {
  const ctx = await setupHelpdesk();
  try {
    const ticket = ctx.store.listTickets({ tenantId: "acme" }).find((t) => t.queueId === "support");
    const approval = recordCloseApproval({ store: ctx.store, ticket, approver: APPROVER, now: AT, policy: ctx.all.policy });
    const closed = await closeTicket({ store: ctx.store, client: ctx.clients["zammad-acme"], ticketId: ticket.id, principal: SUPPORT, approvalId: approval.id, now: AT, policy: ctx.all.policy });
    assert.equal(closed.status, "closed");
    assert.ok(closed.closedAt);
    assert.ok(ctx.store.listHistory(ticket.id).some((e) => e.type === "ticket.closed"));
  } finally {
    await ctx.close();
  }
});
