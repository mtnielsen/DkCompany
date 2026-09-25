/**
 * DKC-025 — kundens livscyklus og revisionsspor.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createLifecycle } from "../src/lifecycle.mjs";
import { createMemoryExecutor, createProvisioner } from "../src/provisioning.mjs";
import { APPROVER, CUSTOMER_ADMIN, OPERATOR, SCOPED_OPERATOR, packages, store as newStore } from "./support/fixtures.mjs";

function fixture() {
  const store = newStore();
  const lifecycle = createLifecycle({ store, packages: packages(), clock: () => Date.parse("2026-09-24T08:00:00Z") });
  const provisioner = createProvisioner({ store, packages: packages(), executor: createMemoryExecutor(), clock: () => Date.parse("2026-09-24T08:00:00Z") });
  const runToActive = async () => {
    lifecycle.createCustomer({ principal: OPERATOR, customer: { tenantId: "acme", name: "Acme ApS" } });
    const pkg = packages().find((p) => p.metadata.name === "starter");
    const order = lifecycle.orderModule({ principal: CUSTOMER_ADMIN, tenantId: "acme", packageId: "starter", acknowledgedConsequences: pkg.consequences.filter((c) => c.severity === "material").map((c) => c.id) });
    lifecycle.approveOrder({ principal: APPROVER, orderId: order.orderId });
    return { order, result: await provisioner.runOrder({ orderId: order.orderId, principal: APPROVER, recordEvent: lifecycle.recordEvent }) };
  };
  return { store, lifecycle, provisioner, runToActive };
}

test("en kunde oprettes, får et modul og får et revisionsspor", async () => {
  const { lifecycle, runToActive } = fixture();
  const { result } = await runToActive();
  assert.equal(result.status, "active");
  const customer = lifecycle.viewCustomer({ principal: CUSTOMER_ADMIN, tenantId: "acme" });
  assert.equal(customer.state, "active");
  assert.equal(customer.packageId, "starter");
  assert.deepEqual(lifecycle.verifyAuditTrail("acme"), []);
  assert.ok(lifecycle.listCustomers({ principal: OPERATOR }).length === 1);
});

test("ukendt kunde og dobbelt oprettelse afvises", () => {
  const { lifecycle } = fixture();
  lifecycle.createCustomer({ principal: OPERATOR, customer: { tenantId: "acme", name: "Acme ApS" } });
  assert.throws(() => lifecycle.createCustomer({ principal: OPERATOR, customer: { tenantId: "acme", name: "Acme igen" } }), /findes allerede/);
  assert.throws(() => lifecycle.viewCustomer({ principal: OPERATOR, tenantId: "findes-ikke" }), /findes ikke/);
});

test("en kunde kan suspenderes og genoptages", async () => {
  const { lifecycle, runToActive } = fixture();
  await runToActive();
  lifecycle.suspendCustomer({ principal: CUSTOMER_ADMIN, tenantId: "acme", reason: "vedligeholdelse" });
  assert.equal(lifecycle.viewCustomer({ principal: OPERATOR, tenantId: "acme" }).state, "suspended");
  lifecycle.resumeCustomer({ principal: CUSTOMER_ADMIN, tenantId: "acme", reason: "vedligeholdelse færdig" });
  assert.equal(lifecycle.viewCustomer({ principal: OPERATOR, tenantId: "acme" }).state, "active");
});

test("suspension uden begrundelse afvises", async () => {
  const { lifecycle, runToActive } = fixture();
  await runToActive();
  assert.throws(() => lifecycle.suspendCustomer({ principal: CUSTOMER_ADMIN, tenantId: "acme", reason: "x" }), /begrundelse/);
});

test("afvikling kræver eksport og sletning, og lukning kræver en anden person", async () => {
  const { lifecycle, runToActive } = fixture();
  await runToActive();
  lifecycle.windDownCustomer({ principal: OPERATOR, tenantId: "acme", reason: "kunden opsiger abonnementet" });
  assert.throws(() => lifecycle.closeCustomer({ principal: OPERATOR, tenantId: "acme", reason: "luk nu" }), /eksport og sletning/);
  lifecycle.completeWindDownStep({ principal: OPERATOR, tenantId: "acme", step: "export", reason: "eksport leveret" });
  lifecycle.completeWindDownStep({ principal: OPERATOR, tenantId: "acme", step: "deletion", reason: "slettet" });
  assert.throws(() => lifecycle.closeCustomer({ principal: OPERATOR, tenantId: "acme", reason: "jeg lukker selv" }), /kan ikke selv lukke/);
  const closed = lifecycle.closeCustomer({ principal: SCOPED_OPERATOR, tenantId: "acme", reason: "afvikling gennemført" });
  assert.equal(closed.state, "closed");
  assert.deepEqual(lifecycle.verifyAuditTrail("acme"), []);
});

test("en ændret revisionskæde opdages", () => {
  const base = newStore();
  const lifecycle = createLifecycle({ store: base, packages: packages() });
  lifecycle.createCustomer({ principal: OPERATOR, customer: { tenantId: "acme", name: "Acme ApS" } });
  const tampered = {
    ...base,
    listEvents(tenantId) {
      const events = base.listEvents(tenantId);
      if (events[0]) events[0].detail = { hacked: true };
      return events;
    },
  };
  const checking = createLifecycle({ store: tampered, packages: packages() });
  const problems = checking.verifyAuditTrail("acme");
  assert.ok(problems.some((p) => /ændret/.test(p)));
});

test("en kunde kan ikke bestille i en afviklet tilstand", async () => {
  const { lifecycle, runToActive } = fixture();
  await runToActive();
  lifecycle.windDownCustomer({ principal: CUSTOMER_ADMIN, tenantId: "acme", reason: "opsigelse" });
  assert.throws(() => lifecycle.orderModule({ principal: CUSTOMER_ADMIN, tenantId: "acme", packageId: "starter", acknowledgedConsequences: [] }), /kan ikke bestille/);
});

test("bestilleren kan ikke selv godkende ordren", () => {
  const { lifecycle } = fixture();
  lifecycle.createCustomer({ principal: OPERATOR, customer: { tenantId: "acme", name: "Acme ApS" } });
  const pkg = packages().find((p) => p.metadata.name === "starter");
  const order = lifecycle.orderModule({ principal: CUSTOMER_ADMIN, tenantId: "acme", packageId: "starter", acknowledgedConsequences: pkg.consequences.filter((c) => c.severity === "material").map((c) => c.id) });
  const selfApprover = { ...APPROVER, id: CUSTOMER_ADMIN.id };
  assert.throws(() => lifecycle.approveOrder({ principal: selfApprover, orderId: order.orderId }), /kan ikke selv godkende/);
});

test("bestilling uden kvittering afvises", () => {
  const { lifecycle } = fixture();
  lifecycle.createCustomer({ principal: OPERATOR, customer: { tenantId: "acme", name: "Acme ApS" } });
  assert.throws(() => lifecycle.orderModule({ principal: CUSTOMER_ADMIN, tenantId: "acme", packageId: "starter", acknowledgedConsequences: [] }), /kvittere/);
});
