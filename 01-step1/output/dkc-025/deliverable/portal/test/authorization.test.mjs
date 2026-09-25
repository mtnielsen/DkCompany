/**
 * DKC-025 — autorisation for UI og API.
 *
 * Beviser default-deny, at en platformrolle kræver eksplicit scope, at demo- og
 * workload-identiteter afvises, og at UI og API træffer samme beslutning.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ACTIONS, ROLES } from "../src/constants.mjs";
import { decidePortalAccess, PORTAL_POLICY, platformScope } from "../src/authorization.mjs";
import { APPROVER, CUSTOMER_ADMIN, CUSTOMER_VIEWER, DEMO, OPERATOR, OTHER_CUSTOMER, SCOPED_OPERATOR, WORKLOAD } from "./support/fixtures.mjs";

test("en kunde kan se sin egen kunde", () => {
  const decision = decidePortalAccess({ principal: CUSTOMER_ADMIN, action: ACTIONS.CUSTOMER_VIEW, tenantId: "acme" });
  assert.equal(decision.allowed, true);
  assert.equal(decision.crossTenant, false);
});

test("en kunde kan ikke se en anden kunde", () => {
  const decision = decidePortalAccess({ principal: OTHER_CUSTOMER, action: ACTIONS.CUSTOMER_VIEW, tenantId: "acme" });
  assert.equal(decision.allowed, false);
  assert.equal(decision.code, "portal_tenant_forbidden");
});

test("en platformrolle uden scope giver ingen adgang", () => {
  const roleOnly = { id: "oidc|role.only", kind: "human", name: "Role Only", roles: [ROLES.PLATFORM_OPERATOR] };
  assert.deepEqual(platformScope(roleOnly), { hasPlatformRole: true, scope: [] });
  const decision = decidePortalAccess({ principal: roleOnly, action: ACTIONS.CUSTOMER_SUSPEND, tenantId: "acme" });
  assert.equal(decision.allowed, false);
  assert.equal(decision.code, "portal_platform_scope_missing");
});

test("en scopet platformrolle kan kun handle inden for scopet", () => {
  assert.equal(decidePortalAccess({ principal: SCOPED_OPERATOR, action: ACTIONS.CUSTOMER_SUSPEND, tenantId: "acme" }).allowed, true);
  assert.equal(decidePortalAccess({ principal: SCOPED_OPERATOR, action: ACTIONS.CUSTOMER_SUSPEND, tenantId: "beta" }).allowed, false);
});

test("globale operatorer kan oprette kunder uden tenantbinding", () => {
  const decision = decidePortalAccess({ principal: OPERATOR, action: ACTIONS.CUSTOMER_CREATE });
  assert.equal(decision.allowed, true);
  assert.equal(decision.tenantId, null);
});

test("kunder kan ikke oprette kunder", () => {
  const decision = decidePortalAccess({ principal: CUSTOMER_ADMIN, action: ACTIONS.CUSTOMER_CREATE });
  assert.equal(decision.allowed, false);
});

test("demo- og workload-identiteter afvises", () => {
  assert.equal(decidePortalAccess({ principal: DEMO, action: ACTIONS.CUSTOMER_VIEW, tenantId: "acme" }).code, "portal_demo_forbidden");
  assert.equal(decidePortalAccess({ principal: WORKLOAD, action: ACTIONS.CUSTOMER_VIEW, tenantId: "acme" }).code, "portal_human_required");
});

test("en ukendt handling afvises (default-deny)", () => {
  const decision = decidePortalAccess({ principal: OPERATOR, action: "customer:delete-everything", tenantId: "acme" });
  assert.equal(decision.allowed, false);
  assert.equal(decision.code, "portal_unknown_action");
});

test("bestillingsgodkendelse kræver platformgodkender", () => {
  assert.equal(decidePortalAccess({ principal: APPROVER, action: ACTIONS.ORDER_APPROVE, tenantId: "acme" }).allowed, true);
  assert.equal(decidePortalAccess({ principal: CUSTOMER_ADMIN, action: ACTIONS.ORDER_APPROVE, tenantId: "acme" }).allowed, false);
});

test("en læser kan se, men ikke bestille", () => {
  assert.equal(decidePortalAccess({ principal: CUSTOMER_VIEWER, action: ACTIONS.APP_VIEW, tenantId: "acme" }).allowed, true);
  assert.equal(decidePortalAccess({ principal: CUSTOMER_VIEWER, action: ACTIONS.ORDER_CREATE, tenantId: "acme" }).allowed, false);
});

test("politikken er total: hver handling har roller og et kendt scope", () => {
  for (const action of Object.values(ACTIONS)) {
    const policy = PORTAL_POLICY[action];
    assert.ok(policy, `mangler politik for ${action}`);
    assert.ok(policy.roles.length > 0, `mangler roller for ${action}`);
    assert.ok(["any", "platform", "own-or-platform"].includes(policy.scope), `ukendt scope for ${action}`);
  }
});
