/**
 * DKC-060 — fælles testfixtures. Syntetiske principaler og profiler; ingen
 * produktionsdata.
 */
import { loadProfiles, indexProfiles } from "../../src/profiles.mjs";

export const PROFILES = indexProfiles(loadProfiles());
export const TENANT = "acme";
export const OTHER_TENANT = "globex";

export function principal(overrides = {}) {
  return {
    id: "oidc|lena.larsen",
    tenantId: TENANT,
    roles: ["employee"],
    grants: [],
    claims: { department: "sales" },
    verified: true,
    ...overrides,
  };
}

export const BI_USER = principal({ id: "oidc|bi.bruger", roles: ["bi-user"], claims: { department: "finance" } });

export const SSO_ONLY = principal({ id: "oidc|sso.bruger", roles: ["sso-user"] });

export const HR_USER = principal({
  id: "oidc|hr.bruger",
  roles: ["hr-user"],
  grants: ["hr.salary.read", "hr.personnel.read", "hr.department.read"],
  claims: { department: "hr" },
});

export const SERVICE_ACCOUNT = {
  id: "svc|reporting",
  tenantId: TENANT,
  roles: ["service-account"],
  scopes: ["read:hr"],
  interactive: false,
  impersonates: null,
  owner: { subject: "oidc|cecilia.christensen", name: "Cecilia Christensen", role: "Service Owner" },
};

export function resource(profiles = PROFILES) {
  return { tenantId: TENANT, type: "dataset", localId: "employees", profiles };
}
