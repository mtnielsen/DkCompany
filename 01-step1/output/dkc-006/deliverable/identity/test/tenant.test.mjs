import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertResourceTenant,
  authorizeTenantAccess,
  crossTenantScope,
  formatResourceId,
  normalizeTenantId,
  parseResourceId,
  resolveTenantContext,
  stripTenantHeaders,
} from "../src/tenant.mjs";

const human = (tenantId, extra = {}) => ({ kind: "human", id: "oidc|u", tenantId, ...extra });

test("tenant-id normaliseres og ugyldige afvises", () => {
  assert.equal(normalizeTenantId("  ACME "), "acme");
  assert.equal(normalizeTenantId("kunde-2"), "kunde-2");
  for (const bad of ["", "  ", "a", "ACME!", "kunde/2", "kunde 2", null, 42]) {
    assert.throws(() => normalizeTenantId(bad), /tenant/, `skal afvise ${JSON.stringify(bad)}`);
  }
});

test("klientleverede tenant-headere fjernes", () => {
  const clean = stripTenantHeaders({ authorization: "Bearer x", "x-tenant-id": "globex", "X-Tenant": "globex", "content-type": "application/json" });
  assert.deepEqual(Object.keys(clean).sort(), ["authorization", "content-type"]);
});

test("ressource-ID bærer tenant og kan parses", () => {
  const id = formatResourceId({ tenantId: "acme", type: "invoice", localId: "42" });
  assert.equal(id, "res://acme/invoice/42");
  assert.deepEqual(parseResourceId(id), { tenantId: "acme", type: "invoice", localId: "42" });
  for (const bad of ["invoice/42", "res://acme/invoice/../etc", "res://ACME/invoice/1", "res://acme/invoice/"]) {
    assert.throws(() => parseResourceId(bad), /ressource-ID|ugyldig/, `skal afvise ${bad}`);
  }
});

test("ressource fra en anden kunde afvises for tenanten", () => {
  const foreign = formatResourceId({ tenantId: "globex", type: "invoice", localId: "42" });
  assert.throws(() => assertResourceTenant([foreign], "acme"), /globex/);
});

test("samme påstand som principalens tenant accepteres", () => {
  const ctx = resolveTenantContext({ principal: human("acme"), claimed: ["acme"] });
  assert.equal(ctx.tenantId, "acme");
  assert.equal(ctx.crossTenant, false);
});

test("udskiftning af tenant i body/URL/header afvises", () => {
  assert.throws(() => resolveTenantContext({ principal: human("acme"), claimed: ["globex"], source: "body.tenantId" }), /tenant_mismatch|globex|matcher ikke/);
  assert.throws(() => resolveTenantContext({ principal: human("acme"), claimed: ["globex"], source: "url" }), (e) => e.code === "tenant_mismatch");
});

test("ressource-ID med fremmed tenant afvises", () => {
  const foreign = formatResourceId({ tenantId: "globex", type: "invoice", localId: "42" });
  assert.throws(() => resolveTenantContext({ principal: human("acme"), resourceIds: [foreign] }), /globex/);
});

test("platform-admin uden eksplicit scope giver ingen krydskunde-adgang", () => {
  assert.equal(crossTenantScope({ roles: ["platform-admin"] }).allowed, false);
  assert.throws(() => resolveTenantContext({ principal: { kind: "service", id: "svc", roles: ["platform-admin"] }, claimed: ["acme"] }), (e) => e.code === "tenant_forbidden");
});

test("platform-admin med eksplicit scope må handle for den kunde", () => {
  const principal = { kind: "service", id: "svc", roles: ["platform-admin:acme"] };
  const ctx = resolveTenantContext({ principal, claimed: ["acme"] });
  assert.equal(ctx.tenantId, "acme");
  assert.equal(ctx.crossTenant, true);
  assert.throws(() => resolveTenantContext({ principal, claimed: ["globex"] }), (e) => e.code === "tenant_forbidden");
});

test("platform-scope * dækker alle kunder, men kræver rollen", () => {
  const admin = { kind: "service", id: "svc", roles: ["platform-admin:*"] };
  assert.equal(resolveTenantContext({ principal: admin, claimed: ["globex"] }).tenantId, "globex");
  const notAdmin = { kind: "service", id: "svc", roles: ["operator", "tenant-scope:acme"] };
  assert.equal(crossTenantScope(notAdmin).platform, false);
  assert.throws(() => resolveTenantContext({ principal: notAdmin, claimed: ["acme"] }), (e) => e.code === "tenant_forbidden");
});

test("authorizeTenantAccess: egen kunde ja, fremmed kunde kun med scope", () => {
  assert.equal(authorizeTenantAccess({ principal: human("acme"), tenantId: "acme" }).allowed, true);
  assert.equal(authorizeTenantAccess({ principal: human("acme"), tenantId: "globex" }).allowed, false);
  assert.equal(authorizeTenantAccess({ principal: { roles: ["platform-admin:globex"] }, tenantId: "globex" }).allowed, true);
});

test("tjeneste uden tenantbinding kræver præcis én eksplicit tenant", () => {
  const principal = { kind: "service", id: "svc", roles: ["platform-admin:*"] };
  assert.throws(() => resolveTenantContext({ principal, claimed: [] }), (e) => e.code === "tenant_unresolved");
  assert.throws(() => resolveTenantContext({ principal, claimed: ["acme", "globex"] }), (e) => e.code === "tenant_unresolved");
});
