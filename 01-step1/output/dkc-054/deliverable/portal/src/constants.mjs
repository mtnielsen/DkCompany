/**
 * DKC-025 — fælles konstanter for kundeportalen.
 *
 * Portalen er ét indgangspunkt for kunderne og for den interne drift. Alle
 * flader — den server-renderede UI og JSON-API'et — læser de samme roller,
 * handlinger og tilstande herfra, så de ikke kan drive fra hinanden.
 */

/** Roller. Kundens egne roller er bundet til kundens tenant. */
export const ROLES = Object.freeze({
  CUSTOMER_ADMIN: "customer-admin",
  CUSTOMER_VIEWER: "customer-viewer",
  PLATFORM_OPERATOR: "platform-operator",
  PLATFORM_APPROVER: "platform-approver",
  PLATFORM_ADMIN: "platform-admin",
});

/** Alle roller der regnes som kundevendte (bundet til deres egen tenant). */
export const CUSTOMER_ROLES = Object.freeze([ROLES.CUSTOMER_ADMIN, ROLES.CUSTOMER_VIEWER]);

/** Alle platformroller. En platformrolle kræver altid en eksplicit tenant-scope. */
export const PLATFORM_ROLES = Object.freeze([ROLES.PLATFORM_OPERATOR, ROLES.PLATFORM_APPROVER, ROLES.PLATFORM_ADMIN]);

/**
 * Handlinger. `scope` er `own` (kun egen kunde), `platform` (kræver
 * platformrolle + eksplicit scope) eller `any` (kunden oprettes før den findes).
 */
export const ACTIONS = Object.freeze({
  CUSTOMER_CREATE: "customer:create",
  CUSTOMER_VIEW: "customer:view",
  CUSTOMER_SUSPEND: "customer:suspend",
  CUSTOMER_RESUME: "customer:resume",
  CUSTOMER_WIND_DOWN: "customer:wind-down",
  CUSTOMER_CLOSE: "customer:close",
  ORDER_CREATE: "order:create",
  ORDER_APPROVE: "order:approve",
  APP_VIEW: "app:view",
  CONSUMPTION_VIEW: "consumption:view",
  STATUS_VIEW: "status:view",
  INBOX_VIEW: "inbox:view",
  CONFIG_VIEW: "config:view",
  CONFIG_CHANGE: "config:change",
});

/** Kundens livscyklus. Terminale tilstande kan ikke forlade sig selv. */
export const CUSTOMER_STATES = Object.freeze(["created", "active", "suspended", "winding-down", "closed"]);

export const CUSTOMER_TRANSITIONS = Object.freeze({
  created: Object.freeze(["active", "winding-down", "closed"]),
  active: Object.freeze(["suspended", "winding-down"]),
  suspended: Object.freeze(["active", "winding-down"]),
  "winding-down": Object.freeze(["closed"]),
  closed: Object.freeze([]),
});

/** Ordrer. */
export const ORDER_STATES = Object.freeze(["requested", "approved", "provisioning", "active", "partial", "suspended", "winding-down", "closed"]);

export const ORDER_TRANSITIONS = Object.freeze({
  requested: Object.freeze(["approved", "winding-down"]),
  approved: Object.freeze(["provisioning", "winding-down"]),
  provisioning: Object.freeze(["active", "partial"]),
  partial: Object.freeze(["provisioning", "active", "winding-down"]),
  active: Object.freeze(["suspended", "winding-down"]),
  suspended: Object.freeze(["active", "winding-down"]),
  "winding-down": Object.freeze(["closed"]),
  closed: Object.freeze([]),
});

/** Provisionsskridt. */
export const STEP_STATES = Object.freeze(["pending", "succeeded", "failed", "reused", "skipped"]);

/** Sprog portalen understøtter. Dansk er standard. */
export const LANGUAGES = Object.freeze(["da", "en"]);
export const DEFAULT_LANGUAGE = "da";
