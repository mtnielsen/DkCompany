/**
 * DKC-025 — holdbar portal og kundelivscyklus (SQLite).
 *
 * Beviser at livscyklussen og den genoptagelige provisionering kører uændret på
 * det holdbare lager, at et delvist fejlet forløb genoptages uden
 * dobbeltressourcer, og at tenant-viewet afgrænser portalens tabeller.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, TENANT_TABLES } from "../src/db.mjs";
import { createMigrator } from "../src/migrations.mjs";
import { createSqlitePortalStore } from "../src/adapters/portal.mjs";
import { loadServicePackages } from "../../portal/src/packages.mjs";
import { createLifecycle } from "../../portal/src/lifecycle.mjs";
import { createMemoryExecutor, createProvisioner } from "../../portal/src/provisioning.mjs";

const OPERATOR = { id: "oidc|ops.olsen", kind: "human", name: "Ops Olsen", roles: ["platform-operator", "platform-operator:*"], tenantScope: ["*"] };
const APPROVER = { id: "oidc|ada.approver", kind: "human", name: "Ada Approver", roles: ["platform-approver", "platform-approver:acme"], tenantScope: ["acme"] };
const CUSTOMER_ADMIN = { id: "oidc|carol.customer", kind: "human", name: "Carol Customer", tenantId: "acme", roles: ["customer-admin"] };

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "dkc-025-portal-"));
  const path = join(dir, "portal.db");
  const db = openDatabase({ path });
  createMigrator({ db }).apply();
  const store = createSqlitePortalStore({ db });
  return {
    db,
    path,
    store,
    cleanup: () => {
      try {
        db.close();
      } catch {
        /* ignore */
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("livscyklus og provisionering er holdbar og idempotent på SQLite", async () => {
  const { db, path, store, cleanup } = fixture();
  try {
    const packages = loadServicePackages().map((entry) => entry.package);
    const clock = () => Date.parse("2026-09-24T08:00:00Z");
    const lifecycle = createLifecycle({ store, packages, clock });
    const provisioner = createProvisioner({ store, packages, executor: createMemoryExecutor({ failAfterKeys: new Set(["hr"]) }), clock });

    lifecycle.createCustomer({ principal: OPERATOR, customer: { tenantId: "acme", name: "Acme ApS" } });
    const pkg = packages.find((p) => p.metadata.name === "hr-suite");
    const order = lifecycle.orderModule({ principal: CUSTOMER_ADMIN, tenantId: "acme", packageId: "hr-suite", acknowledgedConsequences: pkg.consequences.filter((c) => c.severity === "material").map((c) => c.id) });
    lifecycle.approveOrder({ principal: APPROVER, orderId: order.orderId });

    const first = await provisioner.runOrder({ orderId: order.orderId, principal: APPROVER, recordEvent: lifecycle.recordEvent });
    assert.equal(first.status, "partial");
    const second = await provisioner.runOrder({ orderId: order.orderId, principal: APPROVER, recordEvent: lifecycle.recordEvent });
    assert.equal(second.status, "active");
    assert.ok(second.steps.some((s) => s.state === "reused"));
    assert.deepEqual(provisioner.duplicateResources(order.orderId), []);
    assert.deepEqual(lifecycle.verifyAuditTrail("acme"), []);
    const lastHash = store.listEvents("acme").at(-1).hash;

    // Genåbn databasen med et nyt adapter-instans: alt er der stadig.
    db.close();
    const reopened = openDatabase({ path });
    const store2 = createSqlitePortalStore({ db: reopened });
    const lifecycle2 = createLifecycle({ store: store2, packages, clock });
    const customer = store2.getCustomer("acme");
    assert.equal(customer.state, "active");
    assert.equal(store2.getOrder(order.orderId).state, "active");
    assert.ok(store2.listSteps(order.orderId).length >= 4);
    assert.deepEqual(lifecycle2.verifyAuditTrail("acme"), []);
    assert.equal(store2.lastEventHash("acme"), lastHash);
    reopened.close();
  } finally {
    cleanup();
  }
});

test("tenant-viewet afgrænser portalens tabeller", () => {
  const { db, store, cleanup } = fixture();
  try {
    for (const table of ["portal_customers", "portal_orders", "portal_provision_steps", "portal_audit_events"]) {
      assert.ok(TENANT_TABLES[table], `mangler tenant-view for ${table}`);
    }
    store.saveCustomer({ tenantId: "acme", customerId: "acme", name: "Acme", state: "created", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", packageId: null, packageVersion: null, windingDown: null });
    store.saveCustomer({ tenantId: "beta", customerId: "beta", name: "Beta", state: "created", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", packageId: null, packageVersion: null, windingDown: null });

    db.setTenant("acme");
    const rows = db.all("SELECT tenant_id FROM v_portal_customers");
    assert.deepEqual(rows.map((r) => r.tenant_id), ["acme"]);
    db.setTenant("beta");
    assert.deepEqual(db.all("SELECT tenant_id FROM v_portal_customers").map((r) => r.tenant_id), ["beta"]);
  } finally {
    cleanup();
  }
});
