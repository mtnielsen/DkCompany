/**
 * DKC-025 — én autorisationsmotor for portalens UI og API.
 *
 * Kravet bag modulet er enkelt: **UI og API skal håndhæve præcis samme
 * rettigheder**. Derfor findes der kun én beslutningsfunktion. Den
 * server-renderede UI kalder `decidePortalAccess` for at afgøre hvad der må
 * vises, og API-grænsen kalder `assertPortalAccess` på den samme handling for
 * den samme principal og tenant. Enhver forskel ville være en fejl.
 *
 * Regler:
 *   - default-deny: en ukendt handling eller en principal uden den rette rolle
 *     afvises;
 *   - kun verificerede mennesker med en gyldig identitet; demo- og
 *     workload-identiteter afvises;
 *   - tenanten udledes af den verificerede principal og må ikke påstås af
 *     klienten;
 *   - en platformrolle kræver **både** rollen og en eksplicit tenant-scope;
 *     rollen alene giver ingen adgang.
 */
import { AuthorizationError } from "../../identity/src/errors.mjs";
import { normalizeTenantId, principalTenant } from "../../identity/src/tenant.mjs";
import { ACTIONS, CUSTOMER_ROLES, PLATFORM_ROLES, ROLES } from "./constants.mjs";

/**
 * Politik pr. handling. `scope`:
 *   own-or-platform  kundens egen rolle for egen tenant, eller platformrolle
 *                    med eksplicit scope der dækker tenanten.
 *   platform         kun platformrolle med eksplicit scope.
 *   any              ingen tenantbinding (bruges kun ved oprettelse af en kunde).
 */
export const PORTAL_POLICY = Object.freeze({
  [ACTIONS.CUSTOMER_VIEW]: { roles: [ROLES.CUSTOMER_ADMIN, ROLES.CUSTOMER_VIEWER, ...PLATFORM_ROLES], scope: "own-or-platform" },
  [ACTIONS.APP_VIEW]: { roles: [ROLES.CUSTOMER_ADMIN, ROLES.CUSTOMER_VIEWER, ...PLATFORM_ROLES], scope: "own-or-platform" },
  [ACTIONS.CONSUMPTION_VIEW]: { roles: [ROLES.CUSTOMER_ADMIN, ROLES.CUSTOMER_VIEWER, ...PLATFORM_ROLES], scope: "own-or-platform" },
  [ACTIONS.STATUS_VIEW]: { roles: [ROLES.CUSTOMER_ADMIN, ROLES.CUSTOMER_VIEWER, ...PLATFORM_ROLES], scope: "own-or-platform" },
  [ACTIONS.INBOX_VIEW]: { roles: [ROLES.CUSTOMER_ADMIN, ...PLATFORM_ROLES], scope: "own-or-platform" },
  [ACTIONS.ORDER_CREATE]: { roles: [ROLES.CUSTOMER_ADMIN, ROLES.PLATFORM_OPERATOR, ROLES.PLATFORM_ADMIN], scope: "own-or-platform", write: true },
  [ACTIONS.CUSTOMER_SUSPEND]: { roles: [ROLES.CUSTOMER_ADMIN, ROLES.PLATFORM_OPERATOR, ROLES.PLATFORM_ADMIN], scope: "own-or-platform", write: true },
  [ACTIONS.CUSTOMER_RESUME]: { roles: [ROLES.CUSTOMER_ADMIN, ROLES.PLATFORM_OPERATOR, ROLES.PLATFORM_ADMIN], scope: "own-or-platform", write: true },
  [ACTIONS.CUSTOMER_WIND_DOWN]: { roles: [ROLES.CUSTOMER_ADMIN, ROLES.PLATFORM_OPERATOR, ROLES.PLATFORM_ADMIN], scope: "own-or-platform", write: true },
  [ACTIONS.ORDER_APPROVE]: { roles: [ROLES.PLATFORM_APPROVER, ROLES.PLATFORM_ADMIN], scope: "platform", write: true },
  [ACTIONS.CUSTOMER_CLOSE]: { roles: [ROLES.PLATFORM_OPERATOR, ROLES.PLATFORM_ADMIN], scope: "platform", write: true },
  [ACTIONS.CUSTOMER_CREATE]: { roles: [ROLES.PLATFORM_OPERATOR, ROLES.PLATFORM_ADMIN], scope: "any", write: true },
});

export class PortalError extends Error {
  constructor(message, { status = 400, code = "portal_error" } = {}) {
    super(message);
    this.name = "PortalError";
    this.status = status;
    this.code = code;
  }
}

function roleSet(principal) {
  return new Set([...(principal?.roles ?? []), ...(principal?.groups ?? [])].filter((r) => typeof r === "string"));
}

/**
 * Udled platformscopet fra de verificerede roller og `tenantScope`. En bar
 * platformrolle uden scope giver ingen adgang. Rollegrænsen `:<tenant>` eller
 * `:*` bærer scopet; et signeret `tenantScope`-felt medregnes også.
 */
export function platformScope(principal) {
  const roles = roleSet(principal);
  let hasPlatformRole = PLATFORM_ROLES.some((r) => roles.has(r));
  const scopes = new Set();
  for (const role of roles) {
    for (const platformRole of PLATFORM_ROLES) {
      if (!role.startsWith(`${platformRole}:`)) continue;
      hasPlatformRole = true;
      const value = role.slice(platformRole.length + 1);
      if (value === "*") scopes.add("*");
      else if (value) {
        try {
          scopes.add(normalizeTenantId(value));
        } catch {
          /* ugyldig scope ignoreres; giver ingen adgang */
        }
      }
    }
  }
  const declared = principal?.tenantScope;
  if (declared === "*") scopes.add("*");
  else if (Array.isArray(declared)) {
    for (const t of declared) {
      if (t === "*") scopes.add("*");
      else {
        try {
          scopes.add(normalizeTenantId(t));
        } catch {
          /* ignoreres */
        }
      }
    }
  } else if (typeof declared === "string" && declared) {
    try {
      if (declared === "*") scopes.add("*");
      else scopes.add(normalizeTenantId(declared));
    } catch {
      /* ignoreres */
    }
  }
  return { hasPlatformRole, scope: [...scopes] };
}

function deny(reason, code = "portal_forbidden") {
  return { allowed: false, decision: "deny", reason, code };
}

function allow(extra = {}) {
  return { allowed: true, decision: "allow", reason: null, code: null, ...extra };
}

/**
 * Den ene beslutning. Returnerer altid et struktureret resultat, så UI'en kan
 * vise en tydelig fejl og API'et kan omsætte det til en HTTP-status.
 */
export function decidePortalAccess({ principal, action, tenantId = null } = {}) {
  const policy = PORTAL_POLICY[action];
  if (!policy) return deny(`ukendt portalhandling '${action}'`, "portal_unknown_action");

  if (!principal || typeof principal.id !== "string" || principal.id.length === 0) {
    return deny("der findes ingen verificeret identitet", "portal_unauthenticated");
  }
  if (principal.kind !== "human") {
    return deny("kun verificerede mennesker kan bruge portalen", "portal_human_required");
  }
  if (principal.demo === true) {
    return deny("demo-identiteter kan ikke bruge portalen", "portal_demo_forbidden");
  }

  const roles = roleSet(principal);
  if (!policy.roles.some((r) => roles.has(r))) {
    return deny(`rollen mangler for handlingen '${action}'`, "portal_role_missing");
  }

  const own = principalTenant(principal);
  const { hasPlatformRole, scope } = platformScope(principal);

  if (policy.scope === "any") {
    if (!hasPlatformRole) return deny(`handlingen '${action}' kræver en platformrolle`, "portal_platform_role_missing");
    return allow({ crossTenant: true, own, scope, action, tenantId: null });
  }

  let target;
  if (tenantId === null || tenantId === undefined || tenantId === "") {
    if (hasPlatformRole && scope.includes("*")) return allow({ crossTenant: true, own, scope, action, tenantId: null });
    return deny(`handlingen '${action}' kræver en kundekontekst`, "portal_tenant_invalid");
  }
  try {
    target = normalizeTenantId(tenantId);
  } catch (err) {
    return deny(err.message, "portal_tenant_invalid");
  }

  if (own && own === target) {
    return allow({ crossTenant: false, own, scope, action, tenantId: target });
  }

  const covers = scope.includes("*") || scope.includes(target);
  if (hasPlatformRole && covers) {
    return allow({ crossTenant: true, own, scope, action, tenantId: target });
  }

  if (hasPlatformRole || policy.scope === "platform") {
    return deny(`handlingen '${action}' kræver en platformrolle med eksplicit scope for '${target}'`, "portal_platform_scope_missing");
  }
  return deny(
    own
      ? `principalen tilhører kunden '${own}', ikke '${target}'`
      : `principalen mangler tenantbinding og en eksplicit scope for '${target}'`,
    "portal_tenant_forbidden"
  );
}

/** Kaster en `AuthorizationError` hvis adgangen nægtes. Bruges af API-grænsen. */
export function assertPortalAccess(options) {
  const result = decidePortalAccess(options);
  if (!result.allowed) {
    throw new AuthorizationError(result.reason, { status: 403, code: result.code });
  }
  return result;
}

/** Sandt hvis principalen overhovedet har en kunderettet rolle. */
export function isCustomerRole(principal) {
  const roles = roleSet(principal);
  return CUSTOMER_ROLES.some((r) => roles.has(r));
}
