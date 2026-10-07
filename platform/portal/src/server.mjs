/**
 * DKC-025 — portalens API- og UI-grænse.
 *
 * Den samme `handle` betjener både `GET /portal` (server-rendered HTML) og
 * `/api/*` (JSON). Begge flader kalder **den samme autorisation** og de samme
 * domænefunktioner. Afvises en handling, får API'et en JSON-fejl med en stabil
 * kode og UI'et en synlig, lokaliseret fejl — aldrig en tavs tom side.
 */
import { normalizeTenantId } from "../../identity/src/tenant.mjs";
import { AuthorizationError } from "../../identity/src/errors.mjs";
import { ACTIONS } from "./constants.mjs";
import { assertPortalAccess, decidePortalAccess } from "./authorization.mjs";
import { createLifecycle, LifecycleError } from "./lifecycle.mjs";
import { createProvisioner } from "./provisioning.mjs";
import { listApps, approvalInbox, consumptionSummary, listRoles, operationalStatus } from "./apps.mjs";
import { normalizeLang, t } from "./i18n.mjs";
import {
  escapeHtml,
  renderAppsSection,
  renderConsumptionSection,
  renderInboxSection,
  renderOrderPreview,
  renderPortalPage,
  renderRolesSection,
  renderStatusSection,
} from "./render.mjs";
import { configurationApi, handleConfigurationSubmission, renderConfigurationView } from "../../configuration/src/ui.mjs";
import { validateConfigurationInput } from "../../configuration/src/validate-api.mjs";

function json(body, status = 200) {
  return { status, contentType: "application/json; charset=utf-8", body: JSON.stringify(body) };
}

function html(body, status = 200) {
  return { status, contentType: "text/html; charset=utf-8", body };
}

function errorFor(lang, error) {
  const code = error.code ?? "generic";
  // Portalkoder bærer præfikset `portal_`; tekstnøglerne er uden.
  const key = `error.${String(code).replace(/^portal_/, "")}`;
  const localized = t(lang, key);
  return { code, message: localized === key ? error.message : localized, detail: error.message };
}

function stepsByOrder(store, orders) {
  const map = {};
  for (const order of orders) map[order.orderId] = store.listSteps(order.orderId);
  return map;
}

export function createPortalHandler({ store, packages, clock = () => Date.now(), configuration = null } = {}) {
  if (!store) throw new Error("createPortalHandler kræver et lager");
  const lifecycle = createLifecycle({ store, packages, clock });
  const provisioner = createProvisioner({ store, packages, clock });

  function tenantFor(principal, query) {
    const fromQuery = query?.tenant ?? null;
    return fromQuery ? normalizeTenantId(fromQuery) : principal?.tenantId ?? null;
  }

  function dashboard({ principal, lang, tenantId }) {
    const decision = decidePortalAccess({ principal, action: ACTIONS.CUSTOMER_VIEW, tenantId });
    if (!decision.allowed) return { error: decision, sections: [], customer: null, roles: [] };
    const customer = store.getCustomer(decision.tenantId);
    const orders = store.listOrders(decision.tenantId);
    const steps = stepsByOrder(store, orders);
    const sections = [];
    sections.push(renderAppsSection({ lang, apps: listApps({ orders, packages }) }));
    sections.push(renderInboxSection({ lang, inbox: approvalInbox({ orders }) }));
    sections.push(renderStatusSection({ lang, status: operationalStatus({ customer, orders, stepsByOrder: steps }) }));
    sections.push(renderConsumptionSection({ lang, consumption: consumptionSummary({ orders }) }));
    sections.push(renderRolesSection({ lang, roles: listRoles({ principal }) }));
    return { customer, sections, error: null, roles: listRoles({ principal }) };
  }

  /**
   * Hovedindgang. `request` er en allerede autentificeret request beskrevet ved
   * den verificerede `principal`; grænsen påstår aldrig selv en tenant.
   */
  async function handle({ principal, method = "GET", path = "/portal", body = {}, query = {}, headers = {}, lang = "da" } = {}) {
    const language = normalizeLang(headers["accept-language"] ?? lang);
    const segments = path.split("?")[0].split("/").filter(Boolean);
    const isApi = segments[0] === "api";
    const wrap = (result) => result;

    const fail = (error, status) => {
      const info = errorFor(language, error);
      if (isApi) return json({ error: info.message, code: info.code }, status ?? error.status ?? 400);
      return html(renderPortalPage({ lang: language, error: info }), status ?? error.status ?? 400);
    };

    try {
      if (method === "GET" && (path === "/portal" || path === "/portal/")) {
        const tenantId = tenantFor(principal, query);
        const view = dashboard({ principal, lang: language, tenantId });
        if (view.error) return fail(Object.assign(new Error(view.error.reason), { code: view.error.code }), 403);
        return html(renderPortalPage({ lang: language, customer: view.customer, sections: view.sections }));
      }

      if (method === "GET" && path === "/api/roles") {
        return json({ roles: listRoles({ principal }) });
      }

      if (method === "GET" && path === "/api/packages") {
        const tenantId = tenantFor(principal, query);
        const packagesView = packages
          .filter((pkg) => pkg.lifecycle?.orderable === true)
          .sort((a, b) => a.metadata.name.localeCompare(b.metadata.name))
          .map((pkg) => ({ packageId: pkg.metadata.name, version: pkg.metadata.version, description: pkg.metadata.description }));
        if (tenantId) assertPortalAccess({ principal, action: ACTIONS.ORDER_CREATE, tenantId });
        return json({ packages: packagesView });
      }

      if (method === "GET" && segments[0] === "api" && segments[1] === "customers") {
        if (segments.length === 2) {
          return json({ customers: lifecycle.listCustomers({ principal }) });
        }
        const tenantId = normalizeTenantId(segments[2]);
        const customer = lifecycle.viewCustomer({ principal, tenantId });
        const orders = store.listOrders(tenantId);
        const steps = stepsByOrder(store, orders);
        return json({
          customer,
          apps: listApps({ orders, packages }),
          inbox: approvalInbox({ orders }),
          status: operationalStatus({ customer, orders, stepsByOrder: steps }),
          consumption: consumptionSummary({ orders }),
          roles: listRoles({ principal }),
        });
      }

      if (method === "POST" && path === "/api/customers") {
        const customer = lifecycle.createCustomer({ principal, customer: body });
        return json({ customer }, 201);
      }

      if (method === "POST" && segments[0] === "api" && segments[1] === "customers" && segments[3]) {
        const tenantId = normalizeTenantId(segments[2]);
        const op = segments[3];
        if (op === "suspend") return json({ customer: lifecycle.suspendCustomer({ principal, tenantId, reason: body.reason }) });
        if (op === "resume") return json({ customer: lifecycle.resumeCustomer({ principal, tenantId, reason: body.reason }) });
        if (op === "wind-down") return json({ customer: lifecycle.windDownCustomer({ principal, tenantId, reason: body.reason }) });
        if (op === "wind-down-complete") {
          const step = body.step === "deletion" ? "deletion" : "export";
          return json({ customer: lifecycle.completeWindDownStep({ principal, tenantId, step, reason: body.reason }) });
        }
        if (op === "close") return json({ customer: lifecycle.closeCustomer({ principal, tenantId, reason: body.reason }) });
        return fail(Object.assign(new Error("ukendt kundehandling"), { code: "unknown_action" }), 404);
      }

      if (method === "GET" && segments[0] === "api" && segments[1] === "orders") {
        if (segments.length === 2) return json({ orders: lifecycle.listOrders({ principal, tenantId: query.tenant ?? null }) });
        const order = lifecycle.getOrder({ principal, orderId: segments[2] });
        return json({ order, steps: store.listSteps(order.orderId) });
      }

      if (method === "POST" && path === "/api/orders") {
        const order = lifecycle.orderModule({
          principal,
          tenantId: body.tenantId,
          packageId: body.packageId,
          version: body.version ?? null,
          acknowledgedConsequences: body.acknowledgedConsequences ?? [],
          orderId: body.orderId ?? null,
        });
        return json({ order }, 201);
      }

      if (method === "POST" && segments[0] === "api" && segments[1] === "orders" && segments[3] === "approve") {
        const order = lifecycle.approveOrder({ principal, orderId: segments[2], reason: body.reason });
        const result = await provisioner.runOrder({ orderId: order.orderId, principal, recordEvent: lifecycle.recordEvent });
        return json({ order: result.order, steps: result.steps, status: result.status }, result.status === "active" ? 200 : 202);
      }

      if (method === "GET" && (path === "/portal/configuration" || path === "/portal/configuration/")) {
        if (!configuration) return fail(Object.assign(new Error("konfigurationen er ikke tilsluttet portalen"), { code: "configuration_unavailable" }), 503);
        assertPortalAccess({ principal, action: ACTIONS.CONFIG_VIEW, tenantId: tenantFor(principal, query) });
        return html(renderConfigurationView({ desired: configuration.desired, actual: configuration.actual ?? configuration.desired, lang: language }));
      }

      if (method === "GET" && path === "/api/configuration") {
        if (!configuration) return fail(Object.assign(new Error("konfigurationen er ikke tilsluttet portalen"), { code: "configuration_unavailable" }), 503);
        assertPortalAccess({ principal, action: ACTIONS.CONFIG_VIEW, tenantId: tenantFor(principal, query) });
        const validation = validateConfigurationInput(configuration.desired, { source: "portal" });
        return json({ ...configurationApi({ desired: configuration.desired, actual: configuration.actual }), validation: { ok: validation.ok, digest: validation.digest, errors: validation.errors } });
      }

      if (method === "POST" && (path === "/api/configuration/validate" || path === "/api/configuration/apply")) {
        if (!configuration) return fail(Object.assign(new Error("konfigurationen er ikke tilsluttet portalen"), { code: "configuration_unavailable" }), 503);
        const action = path.endsWith("/apply") ? ACTIONS.CONFIG_CHANGE : ACTIONS.CONFIG_VIEW;
        assertPortalAccess({ principal, action, tenantId: body.tenantId ?? tenantFor(principal, query) });
        const result = handleConfigurationSubmission({ source: "portal", payload: body.configuration ?? body, desired: configuration.desired });
        return json(result, result.ok ? 200 : 400);
      }

      return fail(Object.assign(new Error(`ukendt rute '${method} ${path}'`), { code: "method_not_allowed" }), 404);
    } catch (err) {
      if (err instanceof AuthorizationError || err instanceof LifecycleError) return fail(err, err.status);
      return fail(Object.assign(new Error(err.message), { code: err.code ?? "generic" }), 500);
    }
  }

  return { handle, lifecycle, provisioner };
}

export { AuthorizationError };
