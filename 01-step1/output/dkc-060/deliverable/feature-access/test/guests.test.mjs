import { test } from "node:test";
import assert from "node:assert/strict";
import { guestGrantProblems, decideGuestAccess } from "../src/index.mjs";

const NOW = Date.parse("2025-09-01T08:00:00Z");

function grant(overrides = {}) {
  return {
    id: "g1",
    subject: "oidc|gaest.bruger",
    tenantId: "acme",
    invitedBy: { subject: "oidc|cecilia.christensen", name: "Cecilia Christensen", role: "Service Owner" },
    resources: ["res://acme/channel/general"],
    fields: ["message_body"],
    roles: [],
    tenantWide: false,
    expiresAt: "2025-09-02T08:00:00Z",
    ...overrides,
  };
}

const guest = { subject: "oidc|gaest.bruger", tenantId: "acme" };

test("en gyldig gæstebevilling tillader kun de delte felter", () => {
  assert.equal(guestGrantProblems(grant(), { now: NOW }).length, 0);
  assert.equal(decideGuestAccess({ guest, grant: grant(), resource: "res://acme/channel/general", field: "message_body", now: NOW }).decision, "allow");
  assert.equal(decideGuestAccess({ guest, grant: grant(), resource: "res://acme/channel/general", field: "attachment_content", now: NOW }).decision, "deny");
});

test("en udløbet gæstebevilling afvises", () => {
  assert.ok(guestGrantProblems(grant({ expiresAt: "2025-08-31T08:00:00Z" }), { now: NOW }).some((p) => /udløbet/.test(p.message)));
  assert.equal(decideGuestAccess({ guest, grant: grant({ expiresAt: "2025-08-31T08:00:00Z" }), resource: "res://acme/channel/general", now: NOW }).decision, "deny");
});

test("rollearv og tenantbred adgang afvises", () => {
  assert.ok(guestGrantProblems(grant({ roles: ["admin"] }), { now: NOW }).length > 0);
  assert.ok(guestGrantProblems(grant({ tenantWide: true }), { now: NOW }).length > 0);
});

test("en ikke-delt ressource afvises", () => {
  assert.equal(decideGuestAccess({ guest, grant: grant(), resource: "res://acme/channel/hemmelig", now: NOW }).decision, "deny");
});

test("en gæst fra en anden tenant afvises", () => {
  assert.equal(decideGuestAccess({ guest: { subject: "oidc|gaest.bruger", tenantId: "globex" }, grant: grant(), resource: "res://acme/channel/general", now: NOW }).decision, "deny");
});
