/**
 * DKC-061 — adgangskontrol for produktlivscyklussen.
 *
 * Adgang er **default-deny**: principalen skal have en verificeret identitet,
 * tilhøre kundens tenant (eller have en eksplicit platform-scope), have en rolle
 * der må udføre handlingen, og handlingen skal være kendt. En læserolle må se
 * planer og rapporter, men ikke gennemføre opdateringer, fjernelser eller
 * datasletning. Fjernadgang til support kræver desuden et navngivent menneskes
 * samtykke og er aldrig skjult.
 */
import { authorizeTenantAccess, principalTenant } from "../../identity/src/tenant.mjs";

export const LIFECYCLE_ACTIONS = ["read", "plan", "update", "rollback", "remove", "delete-data", "support-bundle", "remote-access"];

/** Handlinger der ændrer tilstand. */
export const LIFECYCLE_WRITE_ACTIONS = new Set(["update", "rollback", "remove", "delete-data", "remote-access"]);

/** Roller og hvilke handlinger de dækker. */
export const LIFECYCLE_ROLE_GRANTS = {
  "lifecycle-admin": ["read", "plan", "update", "rollback", "remove", "delete-data", "support-bundle", "remote-access"],
  "lifecycle-operator": ["read", "plan", "update", "rollback", "remove", "support-bundle"],
  "lifecycle-auditor": ["read"],
};

export class LifecycleAccessError extends Error {
  constructor(message, code = "lifecycle_access_denied", status = 403) {
    super(message);
    this.name = "LifecycleAccessError";
    this.code = code;
    this.status = status;
  }
}

function deny(reason, action = null) {
  return { allowed: false, reason, action, role: null, crossTenant: false, requiresConsent: false };
}

export function decideLifecycleAccess({ principal, tenantId, action, consent = null } = {}) {
  if (!principal || typeof principal.id !== "string" || principal.id.length === 0) return deny("principalen mangler en verificeret identitet", action);
  if (!LIFECYCLE_ACTIONS.includes(action)) return deny(`den ukendte handling '${action}'`, action);
  if (!tenantId) return deny("tenanten kunne ikke udledes", action);

  const tenant = authorizeTenantAccess({ principal, tenantId });
  if (!tenant.allowed) return deny(tenant.reason, action);

  const roles = [...(principal.roles ?? []), ...(principal.groups ?? [])];
  const granted = roles.filter((role) => (LIFECYCLE_ROLE_GRANTS[role] ?? []).includes(action));
  if (granted.length === 0) return deny(`principalen har ingen rolle der må '${action}' i livscyklussen`, action);

  const sameTenant = principalTenant(principal) === tenantId;

  // Datasletning kræver to-personers-kontrol: en anden navngiven, verificeret
  // person end den der udfører handlingen.
  if (action === "delete-data") {
    const second = consent?.secondHumanSubject;
    if (!/^[a-z][a-z0-9-]*\|/.test(second ?? "")) return deny("datasletning kræver en anden navngiven, verificeret person", action);
    if (second === principal.id) return deny("de to personer ved datasletning må ikke være samme principal", action);
  }

  // Fjernadgang kræver et navngivent menneskes samtykke og en positiv TTL.
  if (action === "remote-access") {
    const consentRef = consent?.consentRef;
    if (consent?.enabled !== true) return deny("fjernadgang er ikke aktiveret", action);
    if (!/^[a-z][a-z0-9-]*\|/.test(consentRef ?? "")) return deny("fjernadgang kræver et navngivent menneskes samtykke", action);
    if (!(consent?.ttlMinutes >= 1)) return deny("fjernadgang kræver en positiv TTL", action);
  }

  return { allowed: true, reason: null, action, role: granted[0], crossTenant: !sameTenant, requiresConsent: action === "remote-access" };
}

export function assertLifecycleAccess(options) {
  const decision = decideLifecycleAccess(options);
  if (!decision.allowed) throw new LifecycleAccessError(decision.reason);
  return decision;
}
