import { test } from "node:test";
import assert from "node:assert/strict";
import { createCaseworkerAuthorizer, PrivacyAuthorizationError, assertCaseworker } from "../src/authz.mjs";

const authorizer = createCaseworkerAuthorizer();
const subject = { identifiers: [{ type: "email", value: "kunde@example.org" }] };

test("default-deny: agent, demo, fremmed tenant og forkert rolle afvises", () => {
  assert.equal(authorizer.authorize({ principal: null, tenantId: "acme", subject }).allowed, false);
  assert.equal(authorizer.authorize({ principal: { kind: "agent", id: "spiffe://x", tenantId: "acme", roles: ["dpo"] }, tenantId: "acme", subject }).allowed, false);
  assert.equal(authorizer.authorize({ principal: { kind: "human", id: "oidc|a", tenantId: "acme", roles: ["dpo"], demo: true }, tenantId: "acme", subject }).allowed, false);
  assert.equal(authorizer.authorize({ principal: { kind: "human", id: "oidc|a", tenantId: "globex", roles: ["dpo"] }, tenantId: "acme", subject }).allowed, false);
  assert.equal(authorizer.authorize({ principal: { kind: "human", id: "oidc|a", tenantId: "acme", roles: ["operator"] }, tenantId: "acme", subject }).allowed, false);
});

test("en DPO i samme tenant tillades, men ikke for sin egen sag", () => {
  const dpo = { kind: "human", id: "oidc|dpo.anna", tenantId: "acme", roles: ["dpo"] };
  assert.equal(authorizer.authorize({ principal: dpo, tenantId: "acme", subject }).allowed, true);
  const own = { identifiers: [{ type: "email", value: "dpo.anna" }] };
  const decision = authorizer.authorize({ principal: { ...dpo, email: "dpo.anna" }, tenantId: "acme", subject: own });
  assert.equal(decision.allowed, false);
  assert.equal(decision.code, "self_service_forbidden");
});

test("assertCaseworker kaster en stabil fejlkode ved afvisning", () => {
  assert.throws(() => assertCaseworker({ principal: null, tenantId: "acme" }, authorizer), (err) => err instanceof PrivacyAuthorizationError && err.code === "privacy_forbidden");
});
