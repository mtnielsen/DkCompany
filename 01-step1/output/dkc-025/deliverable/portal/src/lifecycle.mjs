/**
 * DKC-025 — kundens livscyklus med revisionsspor.
 *
 * En kunde oprettes, får en servicepakke, kan suspenderes/genoptages og kan
 * afvikles. Hver tilstandsovergang kræver en autoriseret, verificeret person,
 * en begrundelse og skriver et **hash-kædet** revisionsspor. Kæden gør det
 * muligt at opdage en efterfølgende ændring af historikken.
 *
 * Alt går gennem den fælles autorisationsmotor (`authorization.mjs`), så
 * livscyklussen håndhæver de samme rettigheder uanset om den kaldes fra UI'et
 * eller fra API'et.
 */
import { createHash } from "node:crypto";
import { stableStringify } from "../../approvals/src/binding.mjs";
import { normalizeTenantId, principalTenant } from "../../identity/src/tenant.mjs";
import { AuthorizationError } from "../../identity/src/errors.mjs";
import { ACTIONS, CUSTOMER_STATES, CUSTOMER_TRANSITIONS, ORDER_STATES, ORDER_TRANSITIONS } from "./constants.mjs";
import { assertPortalAccess, platformScope } from "./authorization.mjs";
import { acknowledgmentProblems, loadServicePackages, orderPreview, selectPackage } from "./packages.mjs";

function digestOf(value) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

/** SHA-256 over en revisionshændelse uden dens egen hash (til kædeverifikation). */
export function auditEventDigest(event) {
  const { hash, ...body } = event;
  return digestOf({ ...body, prevHash: event.prevHash ?? null });
}

function parseDate(clock) {
  return new Date(clock()).toISOString();
}

export class LifecycleError extends Error {
  constructor(message, { status = 409, code = "lifecycle_error" } = {}) {
    super(message);
    this.name = "LifecycleError";
    this.status = status;
    this.code = code;
  }
}

function assertTransition(map, from, to, kind) {
  const allowed = map[from];
  if (!allowed) throw new LifecycleError(`ukendt ${kind}-tilstand '${from}'`, { status: 500, code: "unknown_state" });
  if (!allowed.includes(to)) throw new LifecycleError(`ulovlig ${kind}-overgang ${from} → ${to}`, { status: 409, code: "invalid_transition" });
}

function requireReason(reason) {
  if (typeof reason !== "string" || reason.trim().length < 5) {
    throw new LifecycleError("en begrundelse på mindst 5 tegn er påkrævet", { status: 400, code: "reason_required" });
  }
}

function actorOf(principal) {
  return { subject: principal.id, name: principal.name ?? principal.id, role: principal.role ?? null };
}

export function createLifecycle({ store, packages = loadServicePackages().map((entry) => entry.package), clock = () => Date.now() } = {}) {
  if (!store) throw new Error("createLifecycle kræver et lager");

  /** Tilføj et hash-kædet revisionsspor. Returnerer den skrevne hændelse. */
  function recordEvent(tenantId, { type, actor, from = null, to = null, detail = null }) {
    const seq = store.nextEventSeq(tenantId);
    const prevHash = store.lastEventHash(tenantId);
    const body = { seq, at: parseDate(clock), tenantId, type, actor: actor ?? null, from, to, detail };
    const hash = digestOf({ ...body, prevHash });
    const event = { ...body, prevHash, hash };
    store.appendEvent(tenantId, event);
    return event;
  }

  function loadPackage(packageId, version) {
    const pkg = selectPackage(packages, { packageId, version });
    if (!pkg) throw new LifecycleError(`servicepakken '${packageId}'${version ? `@${version}` : ""} findes ikke`, { status: 404, code: "package_not_found" });
    return pkg;
  }

  function createCustomer({ principal, customer } = {}) {
    assertPortalAccess({ principal, action: ACTIONS.CUSTOMER_CREATE });
    if (!customer?.name || String(customer.name).trim().length < 2) {
      throw new LifecycleError("kunden skal have et navn", { status: 400, code: "customer_name_required" });
    }
    const tenantId = normalizeTenantId(customer.tenantId ?? customer.name);
    if (store.getCustomer(tenantId)) {
      throw new LifecycleError(`kunden '${tenantId}' findes allerede`, { status: 409, code: "customer_exists" });
    }
    const now = parseDate(clock);
    const record = {
      customerId: tenantId,
      tenantId,
      name: String(customer.name).trim(),
      state: "created",
      packageId: null,
      packageVersion: null,
      createdAt: now,
      updatedAt: now,
      windingDown: null,
    };
    store.saveCustomer(record);
    recordEvent(tenantId, { type: "customer.created", actor: actorOf(principal), to: "created", detail: { name: record.name } });
    return store.getCustomer(tenantId);
  }

  function viewCustomer({ principal, tenantId } = {}) {
    const target = normalizeTenantId(tenantId);
    assertPortalAccess({ principal, action: ACTIONS.CUSTOMER_VIEW, tenantId: target });
    const customer = store.getCustomer(target);
    if (!customer) throw new LifecycleError(`kunden '${target}' findes ikke`, { status: 404, code: "customer_not_found" });
    return customer;
  }

  /**
   * Liste over kunder principalen må se. En kunde ser kun sig selv. En
   * platformrolle med scope `*` ser alle; en scopet platformrolle ser kun de
   * kunder scopet dækker.
   */
  function listCustomers({ principal } = {}) {
    const own = principalTenant(principal);
    const { hasPlatformRole, scope } = platformScope(principal);
    if (!hasPlatformRole) {
      if (!own) return [];
      assertPortalAccess({ principal, action: ACTIONS.CUSTOMER_VIEW, tenantId: own });
      return store.listCustomers().filter((c) => c.tenantId === own);
    }
    if (scope.includes("*")) {
      assertPortalAccess({ principal, action: ACTIONS.CUSTOMER_VIEW });
      return store.listCustomers();
    }
    const target = scope[0] ?? own;
    if (!target) return [];
    assertPortalAccess({ principal, action: ACTIONS.CUSTOMER_VIEW, tenantId: target });
    return store.listCustomers().filter((c) => scope.includes(c.tenantId) || c.tenantId === own);
  }

  function updateState({ principal, tenantId, to, reason, type, detail = null, mutate = null } = {}) {
    requireReason(reason);
    const customer = store.getCustomer(normalizeTenantId(tenantId));
    if (!customer) throw new LifecycleError(`kunden '${tenantId}' findes ikke`, { status: 404, code: "customer_not_found" });
    const from = customer.state;
    assertTransition(CUSTOMER_TRANSITIONS, from, to, "kunde");
    const next = { ...customer, state: to, updatedAt: parseDate(clock) };
    if (mutate) mutate(next);
    store.saveCustomer(next);
    recordEvent(next.tenantId, { type, actor: actorOf(principal), from, to, detail: detail ?? { reason } });
    return store.getCustomer(next.tenantId);
  }

  function suspendCustomer({ principal, tenantId, reason } = {}) {
    const target = normalizeTenantId(tenantId);
    assertPortalAccess({ principal, action: ACTIONS.CUSTOMER_SUSPEND, tenantId: target });
    return updateState({ principal, tenantId: target, to: "suspended", reason, type: "customer.suspended" });
  }

  function resumeCustomer({ principal, tenantId, reason } = {}) {
    const target = normalizeTenantId(tenantId);
    assertPortalAccess({ principal, action: ACTIONS.CUSTOMER_RESUME, tenantId: target });
    return updateState({ principal, tenantId: target, to: "active", reason, type: "customer.resumed" });
  }

  function windDownCustomer({ principal, tenantId, reason } = {}) {
    const target = normalizeTenantId(tenantId);
    assertPortalAccess({ principal, action: ACTIONS.CUSTOMER_WIND_DOWN, tenantId: target });
    return updateState({
      principal,
      tenantId: target,
      to: "winding-down",
      reason,
      type: "customer.winding-down",
      mutate(customer) {
        customer.windingDown = { startedBy: actorOf(principal), startedAt: parseDate(clock), exportCompleted: false, deletionCompleted: false };
      },
    });
  }

  /** Markér et afviklingstrin (eksport eller sletning) som gennemført. */
  function completeWindDownStep({ principal, tenantId, step, reason } = {}) {
    if (!["export", "deletion"].includes(step)) throw new LifecycleError("trin skal være 'export' eller 'deletion'", { status: 400, code: "winddown_step_invalid" });
    requireReason(reason);
    const target = normalizeTenantId(tenantId);
    assertPortalAccess({ principal, action: ACTIONS.CUSTOMER_WIND_DOWN, tenantId: target });
    const customer = store.getCustomer(target);
    if (!customer) throw new LifecycleError(`kunden '${target}' findes ikke`, { status: 404, code: "customer_not_found" });
    if (customer.state !== "winding-down") throw new LifecycleError("kunden er ikke under afvikling", { status: 409, code: "not_winding_down" });
    const next = { ...customer, updatedAt: parseDate(clock), windingDown: { ...customer.windingDown } };
    if (step === "export") next.windingDown.exportCompleted = true;
    else next.windingDown.deletionCompleted = true;
    store.saveCustomer(next);
    recordEvent(target, { type: `customer.winddown-${step}`, actor: actorOf(principal), detail: { reason } });
    return store.getCustomer(target);
  }

  /**
   * Luk kunden. Kræver at afviklingen er dokumenteret færdig, og at lukningen
   * foretages af en **anden** person end den der startede afviklingen
   * (to-personers-kontrol af en irreversibel handling).
   */
  function closeCustomer({ principal, tenantId, reason } = {}) {
    const target = normalizeTenantId(tenantId);
    assertPortalAccess({ principal, action: ACTIONS.CUSTOMER_CLOSE, tenantId: target });
    requireReason(reason);
    const customer = store.getCustomer(target);
    if (!customer) throw new LifecycleError(`kunden '${target}' findes ikke`, { status: 404, code: "customer_not_found" });
    if (!customer.windingDown?.exportCompleted || !customer.windingDown?.deletionCompleted) {
      throw new LifecycleError("kunden kan ikke lukkes før både eksport og sletning er gennemført", { status: 409, code: "winddown_incomplete" });
    }
    if (customer.windingDown.startedBy?.subject === principal.id) {
      throw new LifecycleError("den der startede afviklingen kan ikke selv lukke kunden", { status: 403, code: "two_person_required" });
    }
    return updateState({ principal, tenantId: target, to: "closed", reason, type: "customer.closed" });
  }

  /**
   * Opret en ordre på en servicepakke. Kunden skal have kvitteret for alle
   * væsentlige konsekvenser, og prisen beregnes server-side — klienten kan
   * ikke bestemme den.
   */
  function orderModule({ principal, tenantId, packageId, version = null, acknowledgedConsequences = [], orderId = null } = {}) {
    const target = normalizeTenantId(tenantId);
    assertPortalAccess({ principal, action: ACTIONS.ORDER_CREATE, tenantId: target });
    const customer = store.getCustomer(target);
    if (!customer) throw new LifecycleError(`kunden '${target}' findes ikke`, { status: 404, code: "customer_not_found" });
    if (["suspended", "winding-down", "closed"].includes(customer.state)) {
      throw new LifecycleError(`kunden kan ikke bestille i tilstanden '${customer.state}'`, { status: 409, code: "customer_not_orderable" });
    }
    const pkg = loadPackage(packageId, version);
    const ackProblems = acknowledgmentProblems(pkg, acknowledgedConsequences);
    if (ackProblems.length) throw new LifecycleError(ackProblems[0].message, { status: 400, code: "acknowledgment_required" });
    const preview = orderPreview(pkg);
    const now = parseDate(clock);
    const record = {
      orderId: orderId ?? `${target}-${pkg.metadata.name}-${pkg.metadata.version}`,
      tenantId: target,
      packageId: pkg.metadata.name,
      packageVersion: pkg.metadata.version,
      state: "requested",
      requestedBy: actorOf(principal),
      approvedBy: null,
      approval: null,
      acknowledgedConsequences: [...acknowledgedConsequences],
      preview: { currency: preview.currency, monthly: preview.monthly, implementation: preview.implementation, firstMonthTotal: preview.firstMonthTotal, consequences: preview.consequences },
      createdAt: now,
      updatedAt: now,
    };
    if (store.getOrder(record.orderId)) throw new LifecycleError(`ordren '${record.orderId}' findes allerede`, { status: 409, code: "order_exists" });
    store.saveOrder(record);
    recordEvent(target, { type: "order.created", actor: actorOf(principal), detail: { orderId: record.orderId, packageId: record.packageId, version: record.packageVersion, monthly: preview.monthly } });
    return store.getOrder(record.orderId);
  }

  function getOrder({ principal, orderId } = {}) {
    const order = store.getOrder(orderId);
    if (!order) throw new LifecycleError(`ordren '${orderId}' findes ikke`, { status: 404, code: "order_not_found" });
    assertPortalAccess({ principal, action: ACTIONS.CUSTOMER_VIEW, tenantId: order.tenantId });
    return order;
  }

  function listOrders({ principal, tenantId = null } = {}) {
    if (tenantId) {
      const target = normalizeTenantId(tenantId);
      assertPortalAccess({ principal, action: ACTIONS.CUSTOMER_VIEW, tenantId: target });
      return store.listOrders(target);
    }
    const customers = listCustomers({ principal });
    const ids = new Set(customers.map((c) => c.tenantId));
    return store.listOrders().filter((o) => ids.has(o.tenantId));
  }

  /** Godkend en ordre. En anden person end bestilleren skal godkende. */
  function approveOrder({ principal, orderId, reason = "godkendt til provisionering" } = {}) {
    const order = store.getOrder(orderId);
    if (!order) throw new LifecycleError(`ordren '${orderId}' findes ikke`, { status: 404, code: "order_not_found" });
    assertPortalAccess({ principal, action: ACTIONS.ORDER_APPROVE, tenantId: order.tenantId });
    if (order.requestedBy?.subject === principal.id) {
      throw new LifecycleError("bestilleren kan ikke selv godkende ordren", { status: 403, code: "two_person_required" });
    }
    assertTransition(ORDER_TRANSITIONS, order.state, "approved", "ordre");
    const next = { ...order, state: "approved", approvedBy: actorOf(principal), approval: { reason, at: parseDate(clock) }, updatedAt: parseDate(clock) };
    store.saveOrder(next);
    recordEvent(order.tenantId, { type: "order.approved", actor: actorOf(principal), from: order.state, to: "approved", detail: { orderId, reason } });
    return store.getOrder(orderId);
  }

  /** Sæt en ordre til en ny tilstand og skriv revisionssporet. */
  function setOrderState({ principal, orderId, to, type, detail = null, mutate = null } = {}) {
    const order = store.getOrder(orderId);
    if (!order) throw new LifecycleError(`ordren '${orderId}' findes ikke`, { status: 404, code: "order_not_found" });
    const from = order.state;
    if (from !== to) assertTransition(ORDER_TRANSITIONS, from, to, "ordre");
    const next = { ...order, state: to, updatedAt: parseDate(clock) };
    if (mutate) mutate(next);
    store.saveOrder(next);
    recordEvent(order.tenantId, { type, actor: principal ? actorOf(principal) : null, from, to, detail });
    return store.getOrder(orderId);
  }

  /** Verificér revisionskæden for en kunde; returnerer problemer (tom = intakt). */
  function verifyAuditTrail(tenantId) {
    const problems = [];
    const list = store.listEvents(normalizeTenantId(tenantId));
    let prev = null;
    for (const [i, event] of list.entries()) {
      if (event.seq !== i + 1) problems.push(`hændelse ${i + 1} har forkert sekvensnummer (${event.seq})`);
      if (event.prevHash !== prev) problems.push(`hændelse ${i + 1} peger ikke på den foregående hash`);
      const { hash, ...body } = event;
      const expected = digestOf({ ...body, prevHash: event.prevHash });
      if (hash !== expected) problems.push(`hændelse ${i + 1} er ændret (hash matcher ikke)`);
      prev = hash;
    }
    return problems;
  }

  return {
    store,
    packages,
    recordEvent,
    createCustomer,
    viewCustomer,
    listCustomers,
    suspendCustomer,
    resumeCustomer,
    windDownCustomer,
    completeWindDownStep,
    closeCustomer,
    orderModule,
    getOrder,
    listOrders,
    approveOrder,
    setOrderState,
    verifyAuditTrail,
  };
}

export { AuthorizationError };
