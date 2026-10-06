/**
 * DKC-025 — genoptagelig, idempotent provisionering.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createLifecycle } from "../src/lifecycle.mjs";
import { createMemoryExecutor, createProvisioner, planSteps } from "../src/provisioning.mjs";
import { APPROVER, CUSTOMER_ADMIN, OPERATOR, packages, store as newStore } from "./support/fixtures.mjs";

function fixture({ executor } = {}) {
  const store = newStore();
  const pkgs = packages();
  const lifecycle = createLifecycle({ store, packages: pkgs, clock: () => Date.parse("2026-09-24T08:00:00Z") });
  const provisioner = createProvisioner({ store, packages: pkgs, executor: executor ?? createMemoryExecutor(), clock: () => Date.parse("2026-09-24T08:00:00Z") });
  lifecycle.createCustomer({ principal: OPERATOR, customer: { tenantId: "acme", name: "Acme ApS" } });
  const pkg = pkgs.find((p) => p.metadata.name === "hr-suite");
  const order = lifecycle.orderModule({
    principal: CUSTOMER_ADMIN,
    tenantId: "acme",
    packageId: "hr-suite",
    acknowledgedConsequences: pkg.consequences.filter((c) => c.severity === "material").map((c) => c.id),
  });
  lifecycle.approveOrder({ principal: APPROVER, orderId: order.orderId });
  return { store, lifecycle, provisioner, order };
}

test("planlægningen er deterministisk og bærer idempotency-keys", () => {
  const pkg = packages().find((p) => p.metadata.name === "starter");
  const a = planSteps(pkg, { tenantId: "acme", orderId: "o1" });
  const b = planSteps(pkg, { tenantId: "acme", orderId: "o1" });
  assert.deepEqual(a, b);
  assert.ok(a.every((s) => /^[a-f0-9]{64}$/.test(s.idempotencyKey)));
  assert.ok(a.every((s) => s.resourceRef.startsWith("res://acme/module/")));
  const otherTenant = planSteps(pkg, { tenantId: "beta", orderId: "o1" });
  assert.notEqual(otherTenant[0].idempotencyKey, a[0].idempotencyKey);
});

test("et delvist fejlet forløb genoptages uden dobbeltressourcer", async () => {
  const executor = createMemoryExecutor({ failAfterKeys: new Set(["hr"]) });
  const { store, lifecycle, provisioner, order } = fixture({ executor });

  const first = await provisioner.runOrder({ orderId: order.orderId, principal: APPROVER, recordEvent: lifecycle.recordEvent });
  assert.equal(first.status, "partial");
  assert.equal(first.failedStepId, "hr");
  assert.equal(store.getOrder(order.orderId).state, "partial");

  const second = await provisioner.runOrder({ orderId: order.orderId, principal: APPROVER, recordEvent: lifecycle.recordEvent });
  assert.equal(second.status, "active");
  const reused = second.steps.filter((s) => s.state === "reused");
  assert.ok(reused.length >= 1, "den allerede oprettede ressource skal genbruges");
  assert.deepEqual(provisioner.duplicateResources(order.orderId), []);
  const customer = lifecycle.viewCustomer({ principal: OPERATOR, tenantId: "acme" });
  assert.equal(customer.state, "active");
});

test("en anden kørsel af et aktivt forløb rører ikke gennemførte trin", async () => {
  const { provisioner, lifecycle, order } = fixture();
  const first = await provisioner.runOrder({ orderId: order.orderId, principal: APPROVER, recordEvent: lifecycle.recordEvent });
  assert.equal(first.status, "active");
  const second = await provisioner.runOrder({ orderId: order.orderId, principal: APPROVER, recordEvent: lifecycle.recordEvent });
  assert.equal(second.status, "active");
  assert.deepEqual(provisioner.duplicateResources(order.orderId), []);
});

test("en ordre der ikke er godkendt kan ikke provisioneres", async () => {
  const store = newStore();
  const provisioner = createProvisioner({ store, packages: packages() });
  store.saveOrder({ orderId: "o1", tenantId: "acme", packageId: "starter", packageVersion: "1.0.0", state: "requested", preview: {} });
  await assert.rejects(() => provisioner.runOrder({ orderId: "o1" }), /kan ikke provisioneres/);
});
