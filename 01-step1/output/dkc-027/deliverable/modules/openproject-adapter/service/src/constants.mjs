/**
 * DKC-027 — fælles konstanter for projektstyringsadapteren.
 *
 * Modulet wrapper OpenProject uændret og oversætter platformens projekt-,
 * opgave- og medlemskabsoperationer til OpenProject API v3. Konstanterne er
 * bevidst udtrukket, så mock-upstream, adapter og tests taler om de samme
 * begreber.
 *
 * Der skelnes mellem Community- og Enterprise-udgaven, fordi central SSO
 * (OIDC/SAML) og visse projekt-/teamfunktioner er Enterprise-tilføjelser. En
 * delmængde frigives aldrig på en uafklaret edition.
 */

/** Platformens projektrettigheder. De er platformsting, ikke upstream-grupper. */
export const PERMISSIONS = Object.freeze({
  PROJECT_READ: "project.read",
  PROJECT_MANAGE: "project.manage",
  WORKPACKAGE_READ: "workpackage.read",
  WORKPACKAGE_WRITE: "workpackage.write",
  MEMBER_MANAGE: "member.manage",
  FILE_READ: "file.read",
  FILE_WRITE: "file.write",
  ACTIVITY_READ: "activity.read",
  PROJECT_EXPORT: "project.export",
  PROJECT_DELETE: "project.delete",
});

/** Roller i projektmodulet. Rollen er en platformsting, ikke en upstream-rolle. */
export const ROLES = Object.freeze({
  TENANT_ADMIN: "tenant-admin",
  PROJECT_ADMIN: "project-admin",
  MEMBER: "member",
  READER: "reader",
  GUEST: "external-guest",
  AUDITOR: "auditor",
});

/**
 * Rettighedsmatrix pr. rolle. En projektgæst må kun læse sit eget projekt og
 * må aldrig administrere medlemmer, rettigheder eller eksportere.
 */
export const ROLE_PERMISSIONS = Object.freeze({
  [ROLES.TENANT_ADMIN]: Object.freeze([
    PERMISSIONS.PROJECT_READ,
    PERMISSIONS.PROJECT_MANAGE,
    PERMISSIONS.WORKPACKAGE_READ,
    PERMISSIONS.WORKPACKAGE_WRITE,
    PERMISSIONS.MEMBER_MANAGE,
    PERMISSIONS.FILE_READ,
    PERMISSIONS.FILE_WRITE,
    PERMISSIONS.ACTIVITY_READ,
    PERMISSIONS.PROJECT_EXPORT,
    PERMISSIONS.PROJECT_DELETE,
  ]),
  [ROLES.PROJECT_ADMIN]: Object.freeze([
    PERMISSIONS.PROJECT_READ,
    PERMISSIONS.PROJECT_MANAGE,
    PERMISSIONS.WORKPACKAGE_READ,
    PERMISSIONS.WORKPACKAGE_WRITE,
    PERMISSIONS.MEMBER_MANAGE,
    PERMISSIONS.FILE_READ,
    PERMISSIONS.FILE_WRITE,
    PERMISSIONS.ACTIVITY_READ,
    PERMISSIONS.PROJECT_EXPORT,
  ]),
  [ROLES.MEMBER]: Object.freeze([
    PERMISSIONS.PROJECT_READ,
    PERMISSIONS.WORKPACKAGE_READ,
    PERMISSIONS.WORKPACKAGE_WRITE,
    PERMISSIONS.FILE_READ,
    PERMISSIONS.FILE_WRITE,
    PERMISSIONS.ACTIVITY_READ,
  ]),
  [ROLES.READER]: Object.freeze([
    PERMISSIONS.PROJECT_READ,
    PERMISSIONS.WORKPACKAGE_READ,
    PERMISSIONS.FILE_READ,
    PERMISSIONS.ACTIVITY_READ,
  ]),
  [ROLES.GUEST]: Object.freeze([
    PERMISSIONS.PROJECT_READ,
    PERMISSIONS.WORKPACKAGE_READ,
    PERMISSIONS.FILE_READ,
    PERMISSIONS.ACTIVITY_READ,
  ]),
  [ROLES.AUDITOR]: Object.freeze([
    PERMISSIONS.PROJECT_READ,
    PERMISSIONS.WORKPACKAGE_READ,
    PERMISSIONS.ACTIVITY_READ,
  ]),
});

/** Kundens projektpolitik. Default er den mest restriktive. */
export const DEFAULT_PROJECT_POLICY = Object.freeze({
  guestAccess: "disabled", // disabled | own-projects-only
  publicSharing: false,
  export: {
    requiresApproval: true,
    allowedFormats: ["json"],
  },
  deletion: {
    requireReason: true,
    requireApproval: true,
    blockOnLegalHold: true,
  },
  ai: {
    // AI må kun læse projektindhold den kalder på gennem en frisk
    // rettighedsprojektion; et forældet indeks må ikke svare.
    requireFreshPermissionIndex: true,
    maxIndexAgeSeconds: 300,
  },
});

/** OpenProject-typer og -statusser, som adapteren oversætter mekanisk. */
export const WORK_PACKAGE_TYPES = Object.freeze(["task", "bug", "feature", "epic"]);
export const WORK_PACKAGE_STATUSES = Object.freeze(["new", "in_progress", "on_hold", "closed"]);
export const PROJECT_STATUSES = Object.freeze(["active", "archived", "closed"]);
export const PROJECT_VISIBILITIES = Object.freeze(["public", "private"]);
export const DEPENDENCY_KINDS = Object.freeze(["blocks", "blocked_by", "relates"]);

/**
 * De kandidater, som er vurderet for projektstyring. OpenProject er den første
 * kandidat. Forskellen mellem Community og Enterprise er dokumenteret, fordi
 * central SSO og visse projektfunktioner kræver Enterprise-tilføjelsen.
 */
export const EDITION_COMBINATIONS = Object.freeze({
  "openproject-community": {
    name: "openproject-community",
    description:
      "OpenProject Community (GPLv3) som projektkerne. Kan projekter, arbejdspakker, medlemskaber, REST API v3, vedhæftninger og aktiviteter, men har ingen indbygget central OIDC/SAML-SSO og ingen garanteret support.",
    product: {
      product: "OpenProject",
      vendor: "OpenProject GmbH",
      version: "14.6.0",
      edition: "Community",
      license: { spdx: "GPL-3.0-or-later", type: "open-source", paidFeaturesRequired: false, redistributionAllowed: true },
      api: {
        protocol: "rest",
        basePath: "/api/v3",
        projects: true,
        workPackages: true,
        memberships: true,
        attachments: true,
        activities: true,
        relations: true,
      },
      sso: { central: false, protocols: [], notes: "Central OIDC/SAML-SSO er en Enterprise-tilføjelse; Community kan bruge lokal adgangskode/LDAP." },
      searchIndex: { aclAware: false, notes: "Communitys indeks er ikke ACL-bevidst; platformen lægger sin egen rettighedsprojektion foran." },
      operations: { backup: "database-and-attachments", rpoMinutes: 60, rtoMinutes: 240, haCapable: true },
    },
    requiredFeatures: ["projects", "workPackages", "memberships", "files", "statusEvents", "sso"],
  },
  "openproject-enterprise": {
    name: "openproject-enterprise",
    description:
      "OpenProject Enterprise (abonnement) med central OIDC/SAML-SSO, 2FA og support. Bruges bag adapteren for pilotkunder.",
    product: {
      product: "OpenProject",
      vendor: "OpenProject GmbH",
      version: "14.6.0",
      edition: "Enterprise",
      license: { spdx: "GPL-3.0-or-later", type: "mixed", paidFeaturesRequired: true, redistributionAllowed: true },
      api: {
        protocol: "rest",
        basePath: "/api/v3",
        projects: true,
        workPackages: true,
        memberships: true,
        attachments: true,
        activities: true,
        relations: true,
      },
      sso: { central: true, protocols: ["oidc", "saml2"], notes: "OIDC/SAML via Enterprise-tilføjelsen." },
      searchIndex: { aclAware: true, notes: "Enterprise-indekset kan filtrere på projektmedlemskab, men platformen håndhæver stadig sin egen projektion." },
      operations: { backup: "database-and-attachments", rpoMinutes: 60, rtoMinutes: 240, haCapable: true },
    },
    requiredFeatures: ["projects", "workPackages", "memberships", "files", "statusEvents", "sso"],
  },
});

/** Standardkandidaten for piloten. */
export const DEFAULT_EDITION_COMBINATION = "openproject-enterprise";

/** De features platformen kræver, og hvordan de aflæses i en kandidat. */
export const FEATURE_PROBES = Object.freeze({
  projects: (product) => Boolean(product.api?.projects),
  workPackages: (product) => Boolean(product.api?.workPackages),
  memberships: (product) => Boolean(product.api?.memberships),
  files: (product) => Boolean(product.api?.attachments),
  statusEvents: (product) => Boolean(product.api?.activities),
  sso: (product) => product.sso?.central === true,
});

/** Hvilke projektdata der er autoritative hvor. */
export const AUTHORITATIVE_DATA = Object.freeze({
  upstream: [
    "projekter og deres identifikatorer",
    "arbejdspakker, status, ansvarlige og afhængigheder",
    "projektmedlemskaber og upstream-roller",
    "vedhæftninger og deres checksummer",
    "aktivitets-/statushændelser",
  ],
  platform: [
    "tenant-tilknytning og den tenantafgrænsede reference",
    "audit, samtykke og DSAR-svar",
    "den ACL-bevidste søge-/AI-projektion",
    "slette- og retentionkvitteringer",
  ],
});
