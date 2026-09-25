/**
 * DKC-025 — appoversigt, roller, godkendelsesindbakke, driftsstatus og forbrug.
 *
 * Disse funktioner er rene og læser kun data, som kalderen allerede har
 * autoriseret adgang til. De bruges både af den server-renderede UI og af
 * JSON-API'et, så de to flader viser samme sandhed.
 */
import { ROLES } from "./constants.mjs";

/** Beskrivelser af de roller portalen kender. */
export const ROLE_CATALOG = Object.freeze([
  { id: ROLES.CUSTOMER_ADMIN, scope: "customer", titleKey: "role.customerAdmin", descriptionKey: "role.customerAdmin.description" },
  { id: ROLES.CUSTOMER_VIEWER, scope: "customer", titleKey: "role.customerViewer", descriptionKey: "role.customerViewer.description" },
  { id: ROLES.PLATFORM_OPERATOR, scope: "platform", titleKey: "role.platformOperator", descriptionKey: "role.platformOperator.description" },
  { id: ROLES.PLATFORM_APPROVER, scope: "platform", titleKey: "role.platformApprover", descriptionKey: "role.platformApprover.description" },
  { id: ROLES.PLATFORM_ADMIN, scope: "platform", titleKey: "role.platformAdmin", descriptionKey: "role.platformAdmin.description" },
]);

function principalRoles(principal) {
  return new Set([...(principal?.roles ?? []), ...(principal?.groups ?? [])].filter((r) => typeof r === "string"));
}

/** Roller: hvilke roller principalen har, og hvad hver rolle betyder. */
export function listRoles({ principal } = {}) {
  const held = principalRoles(principal);
  return ROLE_CATALOG.map((role) => ({ ...role, held: held.has(role.id) }));
}

/**
 * Appoversigt: de moduler kunden aktuelt har gennem aktive ordrer.
 * En app er først synlig når ordren er provisioneret.
 */
export function listApps({ orders = [], packages = [] } = {}) {
  const byId = new Map(packages.map((p) => [`${p.metadata?.name}@${p.metadata?.version}`, p]));
  const apps = [];
  for (const order of orders) {
    if (!["active", "suspended", "winding-down"].includes(order.state)) continue;
    const pkg = byId.get(`${order.packageId}@${order.packageVersion}`);
    const modules = pkg?.modules ?? [];
    for (const mod of modules) {
      apps.push({
        id: mod.id,
        packageId: order.packageId,
        packageVersion: order.packageVersion,
        orderId: order.orderId,
        titleKey: `app.${mod.id}`,
        state: order.state,
        reason: mod.reason,
      });
    }
  }
  return apps.sort((a, b) => a.id.localeCompare(b.id));
}

/** Godkendelsesindbakke: ordrer der venter på en menneskelig godkendelse. */
export function approvalInbox({ orders = [] } = {}) {
  return orders
    .filter((order) => order.state === "requested")
    .map((order) => ({
      orderId: order.orderId,
      tenantId: order.tenantId,
      packageId: order.packageId,
      packageVersion: order.packageVersion,
      requestedBy: order.requestedBy,
      monthly: order.preview?.monthly ?? null,
      currency: order.preview?.currency ?? "DKK",
      requestedAt: order.createdAt,
    }))
    .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
}

/**
 * Driftsstatus: samlet status for kundens apps ud fra provisioneringstrinene.
 * `ok` hvis alle er aktive, `degraded` ved delvis fejl, `suspended` hvis kunden
 * er suspenderet.
 */
export function operationalStatus({ customer, orders = [], stepsByOrder = {} } = {}) {
  const issues = [];
  let active = 0;
  let failed = 0;
  let pending = 0;
  for (const order of orders) {
    const steps = stepsByOrder[order.orderId] ?? [];
    for (const step of steps) {
      if (step.state === "succeeded" || step.state === "reused") active++;
      else if (step.state === "failed") {
        failed++;
        issues.push({ orderId: order.orderId, stepId: step.stepId, state: step.state, error: step.error ?? null });
      } else pending++;
    }
  }
  let level = "ok";
  if (customer?.state === "suspended") level = "suspended";
  else if (customer?.state === "winding-down") level = "winding-down";
  else if (failed > 0) level = "degraded";
  else if (pending > 0) level = "provisioning";
  return { level, active, failed, pending, issues };
}

/** Forbrug: aktive ordrers månedlige pris, summeret og pr. pakke. */
export function consumptionSummary({ orders = [] } = {}) {
  const lines = orders
    .filter((order) => ["active", "suspended"].includes(order.state))
    .map((order) => ({
      orderId: order.orderId,
      packageId: order.packageId,
      packageVersion: order.packageVersion,
      currency: order.preview?.currency ?? "DKK",
      monthly: order.preview?.monthly ?? 0,
      state: order.state,
    }))
    .sort((a, b) => a.orderId.localeCompare(b.orderId));
  const currency = lines[0]?.currency ?? "DKK";
  const monthly = lines.reduce((sum, line) => sum + (Number(line.monthly) || 0), 0);
  return { currency, monthly, lines };
}
