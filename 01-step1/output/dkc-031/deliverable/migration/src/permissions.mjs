/**
 * DKC-031 — adgangskontrol for migration og exit.
 *
 * Adgang er **default-deny**: en principal skal tilhøre kundens tenant (eller
 * have en eksplicit platform-scope), have en rolle der må udføre handlingen for
 * den pågældende app, og handlingen skal være kendt. En læserolle må læse og
 * eksportere, men ikke importere eller cutover. En principal kan aldrig handle
 * på en anden tenants data uden en eksplicit scope.
 */
import { authorizeTenantAccess, principalTenant } from "../../identity/src/tenant.mjs";

export const MIGRATION_ACTIONS = ["read", "export", "import", "cutover", "reconcile"];
const WRITE_ACTIONS = new Set(["import", "cutover"]);

export class MigrationAccessError extends Error {
  constructor(message, code = "migration_access_denied", status = 403) {
    super(message);
    this.name = "MigrationAccessError";
    this.code = code;
    this.status = status;
  }
}

function deny(reason) {
  return { allowed: false, reason };
}

/** Afgør om principalen må udføre handlingen for app'en i tenanten. */
export function decideMigrationAccess({ principal, source, action, tenantId = null } = {}) {
  if (!principal || typeof principal.id !== "string" || principal.id.length === 0) return deny("principalen mangler en verificeret identitet");
  if (!MIGRATION_ACTIONS.includes(action)) return deny(`den ukendte handling '${action}'`);
  const target = tenantId ?? source?.tenantId;
  if (!target) return deny("tenanten kunne ikke udledes");

  const tenant = authorizeTenantAccess({ principal, tenantId: target });
  if (!tenant.allowed) return deny(tenant.reason);

  const roles = { ...(source?.roles ?? {}) };
  if (source && source.tenantId !== target) return deny("kilden tilhører en anden tenant");
  const appId = source?.appId;
  const principalRoles = new Set([...(principal.roles ?? []), ...(principal.groups ?? [])]);
  const candidates = Object.entries(roles).filter(([role]) => principalRoles.has(role) && (roles[role].appIds ?? []).includes(appId));
  if (candidates.length === 0) return deny(`principalen har ingen rolle der dækker appen '${appId}'`);

  const write = WRITE_ACTIONS.has(action);
  const covering = candidates.find(([, def]) => (write ? def.write === true : def.read === true));
  if (!covering) return deny(`principalen har ingen ${write ? "skrive" : "læse"}rolle for '${appId}'`);

  const sameTenant = principalTenant(principal) === target;
  return { allowed: true, reason: null, role: covering[0], crossTenant: !sameTenant, action };
}

export function assertMigrationAccess(options) {
  const decision = decideMigrationAccess(options);
  if (!decision.allowed) throw new MigrationAccessError(decision.reason);
  return decision;
}
