import { test } from "node:test";
import assert from "node:assert/strict";
import { setupHelpdesk } from "./helpers.mjs";
import { createDeterministicHelpdeskModel } from "../src/classification.mjs";
import { receiveInbound, IntakeError } from "../src/intake.mjs";

test("en indgående besked bliver én sag med historik", async () => {
  const { store, close } = await setupHelpdesk();
  try {
    const ticket = store.listTickets({ tenantId: "acme" }).find((t) => t.subject.includes("logge ind"));
    assert.ok(ticket, "login-sagen mangler");
    assert.equal(ticket.queueId, "support");
    const history = store.listHistory(ticket.id).map((e) => e.type);
    assert.ok(history.includes("ticket.received"));
    assert.ok(history.includes("ticket.classified"));
    assert.ok(history.includes("ticket.queued"));
  } finally {
    await close();
  }
});

test("et retry med samme message-id skaber ingen dublet", async () => {
  const { store, clients, all, close } = await setupHelpdesk();
  try {
    const source = all.sources.sources.find((s) => s.id === "zammad-acme");
    const inbound = all.corpus.tenants.acme.inbound[0];
    const before = store.listTickets({ tenantId: "acme" }).length;
    const again = await receiveInbound({ store, source, client: clients[source.id], payload: inbound, model: createDeterministicHelpdeskModel(), policy: all.policy, at: "2026-03-01T00:00:00Z" });
    assert.equal(again.deduplicated, true);
    assert.equal(store.listTickets({ tenantId: "acme" }).length, before);
  } finally {
    await close();
  }
});

test("en besked til en ukendt kø afvises", async () => {
  const { store, clients, all, close } = await setupHelpdesk();
  try {
    const source = all.sources.sources.find((s) => s.id === "zammad-acme");
    await assert.rejects(
      () => receiveInbound({ store, source, client: clients[source.id], payload: { messageId: "<x@y>", channel: "email", queueId: "findes-ikke", from: { subject: "oidc|ada.acme" }, body: "hej" }, model: createDeterministicHelpdeskModel(), policy: all.policy }),
      (err) => err instanceof IntakeError && err.code === "unknown_queue"
    );
  } finally {
    await close();
  }
});
