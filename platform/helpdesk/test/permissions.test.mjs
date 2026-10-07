import { test } from "node:test";
import assert from "node:assert/strict";
import { setupHelpdesk, ADA, BEN, GUS, SUPPORT, SECURITY } from "./helpers.mjs";
import { decideTicketAccess, filterAuthorizedTickets } from "../src/permissions.mjs";

test("en ekstern kunde ser kun egne sager", async () => {
  const { store, close } = await setupHelpdesk();
  try {
    const tickets = store.listTickets();
    const ada = filterAuthorizedTickets({ principal: ADA, tickets });
    assert.ok(ada.authorized.length > 0);
    assert.ok(ada.authorized.every((t) => t.requester?.subject === ADA.id));
    const ben = filterAuthorizedTickets({ principal: BEN, tickets });
    assert.ok(ben.authorized.every((t) => t.requester?.subject === BEN.id));
  } finally {
    await close();
  }
});

test("tenants er isoleret i begge retninger", async () => {
  const { store, close } = await setupHelpdesk();
  try {
    const tickets = store.listTickets();
    const ada = filterAuthorizedTickets({ principal: ADA, tickets });
    const gus = filterAuthorizedTickets({ principal: GUS, tickets });
    assert.ok(ada.authorized.every((t) => t.tenantId === "acme"));
    assert.ok(gus.authorized.every((t) => t.tenantId === "globex"));
  } finally {
    await close();
  }
});

test("en agent uden den rette kø/klarering nægtes adgang", async () => {
  const { store, close } = await setupHelpdesk();
  try {
    const security = store.listTickets({ tenantId: "acme" }).find((t) => t.queueId === "security");
    assert.equal(decideTicketAccess({ principal: SUPPORT, ticket: security, queue: security.queue }).allowed, false);
    assert.equal(decideTicketAccess({ principal: SECURITY, ticket: security, queue: security.queue }).allowed, true);
    assert.equal(decideTicketAccess({ principal: BEN, ticket: security, queue: security.queue }).allowed, false);
  } finally {
    await close();
  }
});

test("en manglende tenant giver default-deny", async () => {
  const { store, close } = await setupHelpdesk();
  try {
    const ticket = store.listTickets({ tenantId: "acme" })[0];
    assert.equal(decideTicketAccess({ principal: { kind: "human", id: "oidc|nobody" }, ticket }).allowed, false);
  } finally {
    await close();
  }
});
