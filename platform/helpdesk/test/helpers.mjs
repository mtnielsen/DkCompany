import { setupHelpdesk } from "../src/check.mjs";

export { setupHelpdesk };

export const ADA = { kind: "customer", id: "oidc|ada.acme", tenantId: "acme", groups: ["acme"], roles: ["customer"], clearance: "internal", email: "ada@acme.example" };
export const BEN = { kind: "customer", id: "oidc|ben.acme", tenantId: "acme", groups: ["acme"], roles: ["customer"], clearance: "internal", email: "ben@acme.example" };
export const GUS = { kind: "customer", id: "oidc|gus.globex", tenantId: "globex", groups: ["globex"], roles: ["customer"], clearance: "internal", email: "gus@globex.example" };
export const SUPPORT = { kind: "human", id: "oidc|sara.support", tenantId: "acme", groups: ["acme", "support"], roles: ["support-agent"], clearance: "internal" };
export const SECURITY = { kind: "human", id: "oidc|seb.security", tenantId: "acme", groups: ["acme", "security"], roles: ["security-agent"], clearance: "confidential" };
export const APPROVER = { kind: "human", id: "oidc|mia.manager", tenantId: "acme", groups: ["acme", "support"], roles: ["support-manager"], clearance: "confidential" };
