/**
 * DKC-025 — in-memory portal-lager med samme interface som SQLite-adapteren.
 *
 * Lageret er bevidst tyndt: al domænelogik ligger i `lifecycle.mjs`,
 * `provisioning.mjs` og `packages.mjs`. Denne implementering bruges af
 * enhedstestene; `persistence/src/adapters/portal.mjs` implementerer præcis
 * samme metodeflade oven på SQLite, så den samme livscyklus kan køre
 * holdbart.
 */
function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

export function createMemoryPortalStore() {
  const customers = new Map();
  const orders = new Map();
  const steps = new Map(); // orderId -> Map(stepId -> step)
  const events = new Map(); // tenantId -> array

  function eventsOf(tenantId) {
    if (!events.has(tenantId)) events.set(tenantId, []);
    return events.get(tenantId);
  }

  return {
    kind: "memory",

    saveCustomer(customer) {
      customers.set(customer.tenantId, clone(customer));
      return clone(customer);
    },
    getCustomer(tenantId) {
      return clone(customers.get(tenantId)) ?? null;
    },
    listCustomers() {
      return [...customers.values()].map(clone).sort((a, b) => a.tenantId.localeCompare(b.tenantId));
    },

    saveOrder(order) {
      orders.set(order.orderId, clone(order));
      return clone(order);
    },
    getOrder(orderId) {
      return clone(orders.get(orderId)) ?? null;
    },
    listOrders(tenantId = null) {
      return [...orders.values()]
        .filter((o) => tenantId === null || o.tenantId === tenantId)
        .map(clone)
        .sort((a, b) => a.orderId.localeCompare(b.orderId));
    },

    saveStep(orderId, step) {
      if (!steps.has(orderId)) steps.set(orderId, new Map());
      steps.get(orderId).set(step.stepId, clone(step));
      return clone(step);
    },
    listSteps(orderId) {
      const map = steps.get(orderId);
      return map ? [...map.values()].map(clone).sort((a, b) => a.stepId.localeCompare(b.stepId)) : [];
    },

    appendEvent(tenantId, event) {
      const list = eventsOf(tenantId);
      list.push(clone(event));
      return clone(event);
    },
    listEvents(tenantId) {
      return eventsOf(tenantId).map(clone);
    },
    lastEventHash(tenantId) {
      const list = eventsOf(tenantId);
      return list.length ? list[list.length - 1].hash : null;
    },
    nextEventSeq(tenantId) {
      return eventsOf(tenantId).length + 1;
    },
  };
}
