/**
 * DKC-026 — fælles konstanter for arbejdspladsmodulet.
 *
 * Modulet wrapper Nextcloud uændret og oversætter platformens
 * arbejdspladsoperationer (filer, deling, kalender, kontoreditor) til
 * Nextclouds API. Konstanterne er bevidst udtrukket, så både mock-upstream,
 * adapter og tests taler om de samme begreber.
 */

/** Roller i arbejdspladsmodulet. Rollen er en platformsting, ikke en upstream-gruppe. */
export const ROLES = Object.freeze({
  TENANT_ADMIN: "tenant-admin",
  MEMBER: "member",
  GUEST: "external-guest",
  AUDITOR: "auditor",
});

/**
 * Nextclouds deletyper. Værdierne matcher upstreams OCS-API, så oversættelsen
 * er mekanisk og kan efterprøves.
 */
export const SHARE_TYPES = Object.freeze({
  USER: 0,
  GROUP: 1,
  PUBLIC_LINK: 3,
  EXTERNAL_GUEST: 4,
});

/**
 * Nextclouds tilladelsesbits. `ALL` er summen af dem alle; adapteren bruger
 * bitsene direkte, så en deling hverken over- eller undererklæres.
 */
export const PERMISSIONS = Object.freeze({
  READ: 1,
  UPDATE: 2,
  CREATE: 4,
  DELETE: 8,
  SHARE: 16,
  ALL: 31,
});

/** Livscyklus for en ekstern gæst. */
export const GUEST_STATES = Object.freeze(["invited", "active", "suspended", "removed"]);

/** Kundens delepolitik. Default er den mest restriktive. */
export const DEFAULT_CUSTOMER_POLICY = Object.freeze({
  externalSharing: "disabled", // disabled | domain-restricted | allowed
  allowedExternalDomains: [],
  publicLinks: {
    enabled: false,
    requirePassword: true,
    requireExpiry: true,
    maxTtlDays: 7,
    allowUpload: false,
  },
  offboarding: {
    closeSessions: true,
    revokeShares: true,
    deleteOwnedFiles: false,
    transferOwnedFilesTo: "tenant-archive",
    retainDataDays: 30,
  },
  deletion: {
    requireReason: true,
    requireApproval: true,
    blockOnLegalHold: true,
  },
});

/** De officielle kontorformater, som pilotkunder forventes at bruge. */
export const PILOT_OFFICE_FORMATS = Object.freeze([
  "docx",
  "xlsx",
  "pptx",
  "odt",
  "ods",
  "odp",
  "pdf",
  "txt",
  "csv",
]);

/**
 * Den dokumenterede editionkombination. En arbejdsplads er først en kandidat,
 * når både Nextcloud-editionen og kontoreduktøren er valideret for licens, API
 * og driftsprofil. Ingen delmængde frigives på en uafklaret kombination.
 */
export const EDITION_COMBINATIONS = Object.freeze({
  "nextcloud-hub-onlyoffice": {
    name: "nextcloud-hub-onlyoffice",
    description:
      "Nextcloud Hub Enterprise som fil-/kalenderkerne kombineret med ONLYOFFICE Docs Enterprise som kontoreditor over WOPI.",
    nextcloud: {
      product: "Nextcloud Hub",
      version: "30.0.0",
      edition: "Enterprise",
      license: { spdx: "AGPL-3.0-or-later", type: "mixed", paidFeaturesRequired: true, redistributionAllowed: true },
      api: { files: "dav", sharing: "ocs/v2", calendar: "caldav", editor: "wopi" },
      operations: { backup: "app-and-volume", rpoMinutes: 1440, rtoMinutes: 240, haCapable: true },
    },
    office: {
      product: "ONLYOFFICE Docs",
      version: "8.1.0",
      edition: "Enterprise",
      license: { spdx: "AGPL-3.0-or-later", type: "mixed", paidFeaturesRequired: true, redistributionAllowed: true },
      api: { protocol: "wopi", documented: true },
      operations: { backup: "config-only", rpoMinutes: 1440, rtoMinutes: 240, haCapable: true },
    },
    formats: ["docx", "xlsx", "pptx", "odt", "ods", "odp", "pdf", "txt", "csv"],
    releasedSubmodules: ["files", "sharing", "calendar", "editor"],
  },
  "nextcloud-hub-collabora": {
    name: "nextcloud-hub-collabora",
    description:
      "Nextcloud Hub Enterprise kombineret med Collabora Online Development Edition. Ikke godkendt til produktion i denne kandidat, fordi COD har færre drift-/supportgarantier end Enterprise.",
    nextcloud: {
      product: "Nextcloud Hub",
      version: "30.0.0",
      edition: "Enterprise",
      license: { spdx: "AGPL-3.0-or-later", type: "mixed", paidFeaturesRequired: true, redistributionAllowed: true },
      api: { files: "dav", sharing: "ocs/v2", calendar: "caldav", editor: "wopi" },
      operations: { backup: "app-and-volume", rpoMinutes: 1440, rtoMinutes: 240, haCapable: true },
    },
    office: {
      product: "Collabora Online",
      version: "24.04.0",
      edition: "Development",
      license: { spdx: "MPL-2.0", type: "mixed", paidFeaturesRequired: false, redistributionAllowed: true },
      api: { protocol: "wopi", documented: true },
      operations: { backup: "none", rpoMinutes: 1440, rtoMinutes: 240, haCapable: false },
    },
    formats: ["docx", "xlsx", "pptx", "odt", "ods", "odp", "txt", "csv"],
    releasedSubmodules: ["files", "sharing", "calendar"],
  },
});

/** Standardeditionen for piloten. */
export const DEFAULT_EDITION_COMBINATION = "nextcloud-hub-onlyoffice";
