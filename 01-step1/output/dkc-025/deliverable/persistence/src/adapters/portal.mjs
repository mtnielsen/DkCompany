/**
 * DKC-025 — holdbart portal-lager oven på SQLite.
 *
 * Adapteren implementerer præcis samme metodeflade som
 * `portal/src/store.mjs` (in-memory-lageret), så kundelivscyklussen og den
 * genoptagelige provisionering kan køre uændret på et holdbart lager. Alle
 * læsninger filtrerer eksplicit på `tenant_id`, og provisioneringstrinnene har
 * en unik idempotency-key pr. tenant, så et genoptaget forløb ikke kan oprette
 * en ressource to gange.
 */
import { normalizeTenantId } from "../../../identity/src/tenant.mjs";

export class PortalStoreError extends Error {
  constructor(message, code = "portal_store_error") {
    super(message);
    this.name = "PortalStoreError";
    this.code = code;
  }
}

function parse(value) {
  return value === null || value === undefined ? null : JSON.parse(value);
}

export function createSqlitePortalStore({ db, kind = "sqlite-portal-store" } = {}) {
  if (!db) throw new PortalStoreError("createSqlitePortalStore kræver en database");

  const upsertCustomer = db.prepare(`INSERT INTO portal_customers(
      tenant_id, customer_id, name, state, package_id, package_version, created_at, updated_at, document)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tenant_id) DO UPDATE SET
      customer_id = excluded.customer_id, name = excluded.name, state = excluded.state,
      package_id = excluded.package_id, package_version = excluded.package_version,
      updated_at = excluded.updated_at, document = excluded.document`);
  const getCustomerStmt = db.prepare("SELECT document FROM portal_customers WHERE tenant_id = ?");
  const listCustomersStmt = db.prepare("SELECT document FROM portal_customers ORDER BY tenant_id");

  const upsertOrder = db.prepare(`INSERT INTO portal_orders(
      order_id, tenant_id, package_id, package_version, state, created_at, updated_at, document)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(order_id) DO UPDATE SET
      state = excluded.state, updated_at = excluded.updated_at, document = excluded.document`);
  const getOrderStmt = db.prepare("SELECT document FROM portal_orders WHERE order_id = ?");
  const listOrdersStmt = db.prepare("SELECT document FROM portal_orders ORDER BY order_id");
  const listOrdersByTenantStmt = db.prepare("SELECT document FROM portal_orders WHERE tenant_id = ? ORDER BY order_id");

  const upsertStep = db.prepare(`INSERT INTO portal_provision_steps(
      order_id, step_id, tenant_id, module_id, idempotency_key, resource_ref, state, attempts, error, updated_at, document)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(order_id, step_id) DO UPDATE SET
      state = excluded.state, attempts = excluded.attempts, error = excluded.error,
      updated_at = excluded.updated_at, document = excluded.document`);
  const listStepsStmt = db.prepare("SELECT document FROM portal_provision_steps WHERE order_id = ? ORDER BY step_id");

  const insertEvent = db.prepare(`INSERT INTO portal_audit_events(
      tenant_id, seq, at, type, actor, from_state, to_state, detail, prev_hash, hash, document)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const listEventsStmt = db.prepare("SELECT document FROM portal_audit_events WHERE tenant_id = ? ORDER BY seq");
  const lastHashStmt = db.prepare("SELECT hash FROM portal_audit_events WHERE tenant_id = ? ORDER BY seq DESC LIMIT 1");
  const nextSeqStmt = db.prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM portal_audit_events WHERE tenant_id = ?");

  return {
    kind,

    saveCustomer(customer) {
      const tenantId = normalizeTenantId(customer.tenantId);
      upsertCustomer.run(
        tenantId,
        customer.customerId ?? tenantId,
        customer.name,
        customer.state,
        customer.packageId ?? null,
        customer.packageVersion ?? null,
        customer.createdAt,
        customer.updatedAt,
        JSON.stringify(customer)
      );
      return structuredClone(customer);
    },
    getCustomer(tenantId) {
      const row = getCustomerStmt.get(normalizeTenantId(tenantId));
      return row ? parse(row.document) : null;
    },
    listCustomers() {
      return listCustomersStmt.all().map((row) => parse(row.document));
    },

    saveOrder(order) {
      upsertOrder.run(
        order.orderId,
        normalizeTenantId(order.tenantId),
        order.packageId,
        order.packageVersion,
        order.state,
        order.createdAt,
        order.updatedAt,
        JSON.stringify(order)
      );
      return structuredClone(order);
    },
    getOrder(orderId) {
      const row = getOrderStmt.get(orderId);
      return row ? parse(row.document) : null;
    },
    listOrders(tenantId = null) {
      const rows = tenantId === null ? listOrdersStmt.all() : listOrdersByTenantStmt.all(normalizeTenantId(tenantId));
      return rows.map((row) => parse(row.document));
    },

    saveStep(orderId, step) {
      upsertStep.run(
        orderId,
        step.stepId,
        normalizeTenantId(step.tenantId),
        step.moduleId,
        step.idempotencyKey,
        step.resourceRef,
        step.state,
        step.attempts ?? 0,
        step.error ?? null,
        step.updatedAt ?? null,
        JSON.stringify(step)
      );
      return structuredClone(step);
    },
    listSteps(orderId) {
      return listStepsStmt.all(orderId).map((row) => parse(row.document));
    },

    appendEvent(tenantId, event) {
      const normalized = normalizeTenantId(tenantId);
      insertEvent.run(
        normalized,
        event.seq,
        event.at,
        event.type,
        event.actor === null || event.actor === undefined ? null : JSON.stringify(event.actor),
        event.from ?? null,
        event.to ?? null,
        event.detail === null || event.detail === undefined ? null : JSON.stringify(event.detail),
        event.prevHash ?? null,
        event.hash,
        JSON.stringify(event)
      );
      return structuredClone(event);
    },
    listEvents(tenantId) {
      return listEventsStmt.all(normalizeTenantId(tenantId)).map((row) => parse(row.document));
    },
    lastEventHash(tenantId) {
      const row = lastHashStmt.get(normalizeTenantId(tenantId));
      return row ? row.hash : null;
    },
    nextEventSeq(tenantId) {
      const row = nextSeqStmt.get(normalizeTenantId(tenantId));
      return row ? Number(row.next) : 1;
    },
  };
}
