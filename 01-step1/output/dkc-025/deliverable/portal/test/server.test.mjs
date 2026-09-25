/**
 * DKC-025 — portalens UI- og API-grænse håndhæver samme rettigheder.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createPortalHandler } from "../src/server.mjs";
import { APPROVER, CUSTOMER_ADMIN, CUSTOMER_VIEWER, OPERATOR, OTHER_CUSTOMER, packages, store as newStore } from "./support/fixtures.mjs";

function handler() {
  const store = newStore();
  return createPortalHandler({ store, packages: packages(), clock: () => Date.parse("2026-09-24T08:00:00Z") });
}

test("UI og API giver samme adgang for samme principal", async () => {
  const portal = handler();
  await portal.handle({ principal: OPERATOR, method: "POST", path: "/api/customers", body: { tenantId: "acme", name: "Acme ApS" } });

  // Kunden ser sin egen side og sit eget API.
  const ui = await portal.handle({ principal: CUSTOMER_VIEWER, method: "GET", path: "/portal" });
  const api = await portal.handle({ principal: CUSTOMER_VIEWER, method: "GET", path: "/api/customers/acme" });
  assert.equal(ui.status, 200);
  assert.equal(api.status, 200);

  // Kunden afvises på en fremmed kunde i både UI og API.
  const foreignUi = await portal.handle({ principal: OTHER_CUSTOMER, method: "GET", path: "/portal", query: { tenant: "acme" } });
  const foreignApi = await portal.handle({ principal: OTHER_CUSTOMER, method: "GET", path: "/api/customers/acme" });
  assert.equal(foreignUi.status, 403);
  assert.equal(foreignApi.status, 403);

  // Læseren kan se, men ikke bestille — på begge flader.
  const deniedOrder = await portal.handle({ principal: CUSTOMER_VIEWER, method: "POST", path: "/api/orders", body: { tenantId: "acme", packageId: "starter", acknowledgedConsequences: [] } });
  assert.equal(deniedOrder.status, 403);
});

test("en kunde kan oprettes, bestille og aktiveres gennem API'et", async () => {
  const portal = handler();
  const created = await portal.handle({ principal: OPERATOR, method: "POST", path: "/api/customers", body: { tenantId: "acme", name: "Acme ApS" } });
  assert.equal(created.status, 201);

  const pkg = packages().find((p) => p.metadata.name === "starter");
  const ack = pkg.consequences.filter((c) => c.severity === "material").map((c) => c.id);
  const orderRes = await portal.handle({ principal: CUSTOMER_ADMIN, method: "POST", path: "/api/orders", body: { tenantId: "acme", packageId: "starter", acknowledgedConsequences: ack } });
  assert.equal(orderRes.status, 201);
  const order = JSON.parse(orderRes.body).order;

  const approve = await portal.handle({ principal: APPROVER, method: "POST", path: `/api/orders/${order.orderId}/approve`, body: { reason: "godkendt" } });
  assert.equal(approve.status, 200);
  assert.equal(JSON.parse(approve.body).order.state, "active");

  const apps = await portal.handle({ principal: CUSTOMER_ADMIN, method: "GET", path: "/api/customers/acme" });
  const view = JSON.parse(apps.body);
  assert.equal(view.customer.state, "active");
  assert.ok(view.apps.length >= 3);
  assert.ok(view.consumption.monthly > 0);
});

test("fejl er tydelige og lokaliserede i begge sprog", async () => {
  const portal = handler();
  await portal.handle({ principal: OPERATOR, method: "POST", path: "/api/customers", body: { tenantId: "acme", name: "Acme ApS" } });
  const da = await portal.handle({ principal: OTHER_CUSTOMER, method: "GET", path: "/api/customers/acme", lang: "da" });
  const en = await portal.handle({ principal: OTHER_CUSTOMER, method: "GET", path: "/api/customers/acme", lang: "en" });
  assert.equal(JSON.parse(da.body).code, "portal_tenant_forbidden");
  assert.match(JSON.parse(da.body).error, /anden kunde/);
  assert.match(JSON.parse(en.body).error, /another customer/);
});

test("en ugyldig ordre giver en synlig fejl, ikke et aktivt forløb", async () => {
  const portal = handler();
  await portal.handle({ principal: OPERATOR, method: "POST", path: "/api/customers", body: { tenantId: "acme", name: "Acme ApS" } });
  const res = await portal.handle({ principal: CUSTOMER_ADMIN, method: "POST", path: "/api/orders", body: { tenantId: "acme", packageId: "findes-ikke", acknowledgedConsequences: [] } });
  assert.equal(res.status, 404);
  assert.equal(JSON.parse(res.body).code, "package_not_found");
});

test("UI og API viser samme appoversigt for en læser", async () => {
  const portal = handler();
  await portal.handle({ principal: OPERATOR, method: "POST", path: "/api/customers", body: { tenantId: "acme", name: "Acme ApS" } });
  const pkg = packages().find((p) => p.metadata.name === "starter");
  const ack = pkg.consequences.filter((c) => c.severity === "material").map((c) => c.id);
  const orderRes = await portal.handle({ principal: CUSTOMER_ADMIN, method: "POST", path: "/api/orders", body: { tenantId: "acme", packageId: "starter", acknowledgedConsequences: ack } });
  const order = JSON.parse(orderRes.body).order;
  await portal.handle({ principal: APPROVER, method: "POST", path: `/api/orders/${order.orderId}/approve`, body: { reason: "godkendt" } });

  const ui = await portal.handle({ principal: CUSTOMER_VIEWER, method: "GET", path: "/portal" });
  const api = await portal.handle({ principal: CUSTOMER_VIEWER, method: "GET", path: "/api/customers/acme" });
  assert.equal(ui.status, 200);
  const view = JSON.parse(api.body);
  for (const app of view.apps) {
    assert.ok(ui.body.includes(`data-app="${app.id}"`), `UI mangler appen '${app.id}' som API'et viser`);
  }
  assert.ok(ui.body.includes('id="inbox"'));
});
