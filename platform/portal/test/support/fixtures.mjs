/**
 * DKC-025 — fælles testfixtures: verificerede principaler og et lager.
 */
import { loadServicePackages } from "../../src/packages.mjs";
import { createMemoryPortalStore } from "../../src/store.mjs";

export function packages() {
  return loadServicePackages().map((entry) => entry.package);
}

export const OPERATOR = {
  id: "oidc|ops.olsen",
  kind: "human",
  name: "Ops Olsen",
  roles: ["platform-operator", "platform-operator:*"],
  tenantScope: ["*"],
};

export const SCOPED_OPERATOR = {
  id: "oidc|scoped.olsen",
  kind: "human",
  name: "Scoped Olsen",
  roles: ["platform-operator", "platform-operator:acme"],
  tenantScope: ["acme"],
};

export const APPROVER = {
  id: "oidc|ada.approver",
  kind: "human",
  name: "Ada Approver",
  roles: ["platform-approver", "platform-approver:acme"],
  tenantScope: ["acme"],
};

export const CUSTOMER_ADMIN = {
  id: "oidc|carol.customer",
  kind: "human",
  name: "Carol Customer",
  tenantId: "acme",
  roles: ["customer-admin"],
};

export const CUSTOMER_VIEWER = {
  id: "oidc|vickie.viewer",
  kind: "human",
  name: "Vickie Viewer",
  tenantId: "acme",
  roles: ["customer-viewer"],
};

export const DEMO = { id: "oidc|demo", kind: "human", name: "Demo", tenantId: "acme", demo: true, roles: ["customer-admin"] };
export const WORKLOAD = { id: "spiffe://platform/worker", kind: "workload", name: "Worker", tenantId: "acme", roles: ["customer-admin"] };
export const OTHER_CUSTOMER = { id: "oidc|other", kind: "human", name: "Other", tenantId: "beta", roles: ["customer-admin"] };

export function store() {
  return createMemoryPortalStore();
}
