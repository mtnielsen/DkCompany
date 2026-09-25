/**
 * DKC-059 — adgangskontrol for providerudskiftning.
 *
 * Adgang er **default-deny**: principalen skal have en verificeret identitet,
 * tilhøre kundens tenant (eller have en eksplicit platform-scope), have en
 * rolle der må udføre handlingen, og handlingen skal være kendt. En
 * læserolle må se preflight og afstemning, men ikke cutover eller tilbagekalde
 * credentials. En principal kan aldrig handle på en anden tenants providere.
 */
import { authorizeTenantAccess, principalTenant } from "../../identity/src/tenant.mjs";

export const PROVIDER_ACTIONS = ["read", "preflight", "cutover", "revoke"];

/** Handlinger der ændrer tilstand. */
export const PROVIDER_WRITE_ACTIONS = new Set(["cutover", "revoke"]);

/** Roller og hvilke handlinger de dækker. */
export const PROVIDER_ROLE_GRANTS = {
  "provider-admin": ["read", "preflight", "cutover", "revoke"],
  "provider-operator": ["read", "preflight"],
  "provider-auditor": ["read"],
};

export class ProviderAccessError extends Error {
  constructor(message, code = "provider_access_denied", status = 403) {
    super(message);
    this.name = "ProviderAccessError";
    this.code = code;
    this.status = status;
  }
}

function deny(reason, action = null) {
  return { allowed: false, reason, action, role: null, crossTenant: false };
}

export function decideProviderSwapAccess({ principal, tenantId, action } = {}) {
  if (!principal || typeof principal.id !== "string" || principal.id.length === 0) return deny("principalen mangler en verificeret identitet", action);
  if (!PROVIDER_ACTIONS.includes(action)) return deny(`den ukendte handling '${action}'`, action);
  if (!tenantId) return deny("tenanten kunne ikke udledes", action);

  const tenant = authorizeTenantAccess({ principal, tenantId });
  if (!tenant.allowed) return deny(tenant.reason, action);

  const roles = [...(principal.roles ?? []), ...(principal.groups ?? [])];
  const granted = roles.filter((role) => (PROVIDER_ROLE_GRANTS[role] ?? []).includes(action));
  if (granted.length === 0) return deny(`principalen har ingen rolle der må '${action}' på providerskift`, action);

  const sameTenant = principalTenant(principal) === tenantId;
  return { allowed: true, reason: null, action, role: granted[0], crossTenant: !sameTenant };
}

export function assertProviderSwapAccess(options) {
  const decision = decideProviderSwapAccess(options);
  if (!decision.allowed) throw new ProviderAccessError(decision.reason);
  return decision;
}
