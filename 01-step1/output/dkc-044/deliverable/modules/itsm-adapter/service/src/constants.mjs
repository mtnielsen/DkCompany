/**
 * DKC-044 — fælles konstanter for ITSM-adapteren.
 *
 * Modulet wrapper GLPI uændret og oversætter platformens serviceproces
 * (alarmer, incidents, major incidents, requests, problemer, kendte fejl,
 * changes, CI-relationer og vidensartikler) til GLPI's API. Konstanterne er
 * bevidst udtrukket, så mock-upstream, adapter, service-registry og tests taler
 * om de samme begreber.
 */

/**
 * Alvorlighedsgrader. En alarm bliver til én incident med en menneskelig ejer;
 * en manglende kvittering eskalerer og stopper risikofyldt handling.
 */
export const SEVERITIES = Object.freeze({
  sev1: { level: 1, label: "SEV1", ackMinutes: 5, escalationMinutes: 10, requiresHumanAck: true, major: true },
  sev2: { level: 2, label: "SEV2", ackMinutes: 15, escalationMinutes: 30, requiresHumanAck: true, major: false },
  sev3: { level: 3, label: "SEV3", ackMinutes: 60, escalationMinutes: 120, requiresHumanAck: true, major: false },
  sev4: { level: 4, label: "SEV4", ackMinutes: 240, escalationMinutes: 480, requiresHumanAck: true, major: false },
});

/** De recordtyper ITSM-fladen kender. Et change er en record som alle andre. */
export const RECORD_KINDS = Object.freeze([
  "incident",
  "major_incident",
  "request",
  "problem",
  "known_error",
  "change",
]);

/** Livscyklus for en incident. Kun et menneske må lukke en major incident. */
export const INCIDENT_STATES = Object.freeze([
  "new",
  "acknowledged",
  "investigating",
  "mitigated",
  "resolved",
  "closed",
  "cancelled",
]);

/** En request's tilstand. */
export const REQUEST_STATES = Object.freeze(["new", "approved", "in_progress", "fulfilled", "rejected", "cancelled"]);

/** En changes tilstand. Et change kræver både runbook og godkende menneske. */
export const CHANGE_STATES = Object.freeze(["draft", "approval", "scheduled", "implementing", "implemented", "rolled_back", "cancelled"]);

/** Hvilke kommunikationskanaler der bruges uden for platformen. */
export const COMMUNICATION_CHANNELS = Object.freeze(["statuspage", "email", "sms", "phone", "slack", "teams"]);

/**
 * GLPI-kandidaten. GLPI findes som ren GPL-kerne (Community) og som
 * abonnementsudgave (Network). API'et er REST + High-Level API. Ingen
 * delmængde frigives, før licens, API og driftsprofil er valideret.
 */
export const ITSM_EDITIONS = Object.freeze({
  "glpi-network": {
    name: "glpi-network",
    description:
      "GLPI Network (abonnement) som ITSM-kerne med support, SLA/OLA, Change, Problem, CMDB og vidensbase. Bruges bag adapteren.",
    product: {
      name: "GLPI",
      vendor: "Teclib'",
      version: "10.0.16",
      edition: "Network",
      license: { spdx: "GPL-3.0-or-later", type: "mixed", paidFeaturesRequired: true, redistributionAllowed: true },
      api: {
        protocol: "rest",
        basePath: "/apirest.php",
        highLevel: true,
        incidents: true,
        problems: true,
        changes: true,
        cmdb: true,
        serviceCatalog: true,
        sla: true,
        knowledge: true,
      },
      operations: { backup: "database-and-files", rpoMinutes: 60, rtoMinutes: 240, haCapable: true },
    },
    releasedSubmodules: ["serviceCatalog", "incidents", "requests", "problems", "changes", "cmdb", "knowledge", "sla"],
  },
  "glpi-community": {
    name: "glpi-community",
    description:
      "GLPI Community (GPL) uden Network-abonnement. Kernen kan incidents, problemer, changes og CMDB, men SLA/OLA-avancerede felter og support er ikke dækket.",
    product: {
      name: "GLPI",
      vendor: "Teclib'",
      version: "10.0.16",
      edition: "Community",
      license: { spdx: "GPL-3.0-or-later", type: "open-source", paidFeaturesRequired: false, redistributionAllowed: true },
      api: {
        protocol: "rest",
        basePath: "/apirest.php",
        highLevel: true,
        incidents: true,
        problems: true,
        changes: true,
        cmdb: true,
        serviceCatalog: true,
        sla: false,
        knowledge: true,
      },
      operations: { backup: "database-and-files", rpoMinutes: 60, rtoMinutes: 240, haCapable: true },
    },
    releasedSubmodules: ["serviceCatalog", "incidents", "requests", "problems", "changes", "cmdb", "knowledge"],
  },
});

/** Standardkandidaten for piloten. */
export const DEFAULT_ITSM_EDITION = "glpi-network";

/**
 * Rollerne i en serviceproces. Genbruger DKC-055's uforanderlige roller, men
 * beskriver hvilke der er nødvendige i ITSM-flowet.
 */
export const PROCESS_ROLES = Object.freeze(["observer", "planner", "implementer", "verifier", "executor", "auditor"]);

/** Roller der aldrig må tildeles en AI i en serviceproces. */
export const FORBIDDEN_AI_ROLES = Object.freeze(["owner", "approver", "admin", "on-call", "human-approver"]);

/** Standardpolitik for ITSM. Default er den mest restriktive. */
export const DEFAULT_ITSM_POLICY = Object.freeze({
  majorIncident: {
    requiresHumanAck: true,
    requiresHumanClose: true,
    allowAiCloseOnGreenHealthcheck: false,
  },
  problem: {
    repeatThreshold: 3,
    windowDays: 30,
    requireHumanValidation: true,
  },
  change: {
    requireRunbook: true,
    requireApproval: true,
    requireIncidentLink: true,
  },
  customer: {
    exposeInternalNotes: false,
    exposeOwnerIdentity: false,
    visibleStatuses: ["new", "acknowledged", "investigating", "mitigated", "resolved", "closed"],
  },
});
