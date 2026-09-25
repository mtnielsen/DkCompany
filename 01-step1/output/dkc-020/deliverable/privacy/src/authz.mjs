/**
 * DKC-020 — autorisation af DSAR-sagsbehandlere.
 *
 * En DSAR er en følsom, autoriseret proces. Denne autorisator er default-deny
 * og tjekker kun principalens verificerede identitet — aldrig klientens egne
 * påstande:
 *
 *   - kun et verificeret menneske (ikke en agent eller service) må behandle en sag,
 *   - sagsbehandleren skal tilhøre sagens tenant,
 *   - sagsbehandleren skal have en af de godkendte roller eller grupper,
 *   - selvbetjening er forbudt: man kan ikke behandle sin egen sag.
 *
 * Autorisationen er bevidst adskilt fra PDP'en og kan bruges som et ekstra,
 * deny-only lag oven på den.
 */
export class PrivacyAuthorizationError extends Error {
  constructor(message, code = "privacy_forbidden") {
    super(message);
    this.name = "PrivacyAuthorizationError";
    this.code = code;
  }
}

export const DEFAULT_CASEWORKER_ROLES = ["dpo", "privacy-officer"];
export const DEFAULT_CASEWORKER_GROUPS = ["dpo-approvers"];

function deny(reason, code = "privacy_forbidden") {
  return { decision: "deny", allowed: false, reason, code, obligations: [] };
}

function principalTenant(principal) {
  return principal?.tenantId ?? principal?.tenant_id ?? null;
}

function ownIdentities(principal) {
  return [principal?.id, principal?.oidcSub, principal?.email].filter(Boolean).map((v) => String(v).toLowerCase());
}

/**
 * @param {object} [config]
 * @param {string[]} [config.eligibleRoles]
 * @param {string[]} [config.eligibleGroups]
 * @param {boolean} [config.selfServiceForbidden]
 */
export function createCaseworkerAuthorizer({
  eligibleRoles = DEFAULT_CASEWORKER_ROLES,
  eligibleGroups = DEFAULT_CASEWORKER_GROUPS,
  selfServiceForbidden = true,
} = {}) {
  return {
    kind: "privacy-caseworker-authorizer",
    authorize({ principal, tenantId, action = "case.open", subject = null } = {}) {
      if (!principal) return deny("ingen verificeret principal");
      if (principal.demo === true) return deny("demo-identitet kan ikke behandle en DSAR-sag", "demo_forbidden");
      if (principal.kind !== "human") return deny("kun et verificeret menneske må behandle en DSAR-sag", "human_required");
      const tenant = principalTenant(principal);
      if (!tenant || String(tenant) !== String(tenantId)) return deny("sagsbehandleren tilhører ikke sagens tenant", "tenant_mismatch");

      const roles = principal.roles ?? [];
      const groups = principal.groups ?? [];
      const hasRole = roles.some((r) => eligibleRoles.includes(r)) || groups.some((g) => eligibleGroups.includes(g));
      if (!hasRole) return deny("sagsbehandleren har ikke rollen eller gruppen til at behandle DSAR-sager", "role_required");

      if (selfServiceForbidden && subject) {
        const subjectIds = new Set((subject.identifiers ?? []).map((i) => String(i.normalised ?? i.value ?? "").toLowerCase()));
        if (ownIdentities(principal).some((own) => subjectIds.has(own))) {
          return deny("en sagsbehandler kan ikke behandle sin egen sag", "self_service_forbidden");
        }
      }
      return { decision: "allow", allowed: true, reason: null, code: null, obligations: ["audit"] };
    },
  };
}

/** Kaster hvis autorisationen nægter. */
export function assertCaseworker(options, authorizer = createCaseworkerAuthorizer()) {
  const decision = authorizer.authorize(options);
  if (!decision.allowed) throw new PrivacyAuthorizationError(decision.reason, decision.code);
  return decision;
}
