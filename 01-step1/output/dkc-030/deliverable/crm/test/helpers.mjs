import { setupCrm } from "../src/check.mjs";

export { setupCrm };

export const ADA = { kind: "human", id: "oidc|ada.acme", tenantId: "acme", roles: ["sales"], clearance: "confidential" };
export const BEN = { kind: "human", id: "oidc|ben.acme", tenantId: "acme", roles: ["sales"], clearance: "personal" };
export const GUS = { kind: "human", id: "oidc|gus.globex", tenantId: "globex", roles: ["sales"], clearance: "internal" };
export const SUPPORT = { kind: "human", id: "oidc|sam.support", tenantId: "acme", roles: ["support"], clearance: "internal" };
