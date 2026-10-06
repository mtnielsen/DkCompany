/**
 * DKC-034 — autoriseret forbrugsrapport og eksport.
 *
 * Rapporten udleder tenanten af den **verificerede** principal. En kunde kan
 * kun se sin egen rapport og skal desuden have en eksplicit læserrolle; en
 * påstand om en fremmed tenant afvises. Kun en scopet platformrolle kan eksportere
 * på tværs af kunder, og det markeres i resultatet. Et sidste sikkerhedsnet
 * afviser enhver række, der bærer en anden tenant end konteksten.
 */
import { requireTenantContext } from "../../identity/src/tenant.mjs";
import { AuthorizationError } from "../../identity/src/errors.mjs";

export const COST_EXPORT_ROLES = ["billing-reader", "tenant-admin", "platform-admin"];
export const DEFAULT_COST_EXPORT_ROLE = "billing-reader";

/**
 * Autoriser et forbrugsudtræk for den tenant principalen tilhører.
 *
 * @throws AuthorizationError hvis tenanten ikke kan udledes, ikke matcher,
 *         eller hvis principalen mangler læserollen.
 */
export function authorizeCostExport({ principal, requestedTenantId = null, requiredRole = DEFAULT_COST_EXPORT_ROLE } = {}) {
  const context = requireTenantContext({
    principal,
    claimed: requestedTenantId ? [requestedTenantId] : [],
    source: "cost-export",
  });
  const roles = new Set([...(principal?.roles ?? []), ...(principal?.groups ?? [])]);
  if (!context.crossTenant) {
    const allowed = [requiredRole, "tenant-admin", "platform-admin"].some((role) => roles.has(role));
    if (!allowed) {
      throw new AuthorizationError(`principalen mangler rollen '${requiredRole}' for at eksportere forbrugsrapporten`, { status: 403, code: "cost_export_forbidden" });
    }
  }
  return Object.freeze({ ...context, authorized: true, requiredRole });
}

/**
 * Eksportér den byggede rapport for principalens tenant. Krydskunde-eksport
 * kræver en scopet platformrolle og returnerer alle tenants.
 */
export function exportCostReport({ report, principal, requestedTenantId = null, requiredRole = DEFAULT_COST_EXPORT_ROLE, exportedAt = null } = {}) {
  const context = authorizeCostExport({ principal, requestedTenantId, requiredRole });
  let tenants = report.tenants;
  if (requestedTenantId) {
    const target = context.tenantId;
    tenants = report.tenants.filter((tenant) => tenant.tenantId === target);
  }
  if (!context.crossTenant) {
    tenants = report.tenants.filter((tenant) => tenant.tenantId === context.tenantId);
    if (tenants.length === 0) {
      throw new AuthorizationError(`der findes ingen forbrugsrapport for tenanten '${context.tenantId}'`, { status: 404, code: "cost_report_missing" });
    }
  }
  // Sidste sikkerhedsnet: en same-tenant-eksport må aldrig bære en anden tenant.
  for (const tenant of tenants) {
    if (!context.crossTenant && tenant.tenantId !== context.tenantId) {
      throw new Error(`tenant-lækage: eksporten bærer '${tenant.tenantId}', ikke '${context.tenantId}'`);
    }
  }
  return {
    exportedAt,
    tenantId: context.tenantId,
    crossTenant: context.crossTenant,
    subject: context.subject,
    currency: report.currency,
    measurement: report.measurement,
    tenants,
  };
}
