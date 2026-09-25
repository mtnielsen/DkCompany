/**
 * DKC-022 — autoriseret tjeneste for evidens- og risikoregisteret.
 *
 * Tjenesten er grænsen mellem CLI/API og registeret. Den:
 *   - kræver en verificeret principal med en relevant rolle for at læse
 *     registeret (default-deny),
 *   - samler en evidenspakke uden nogensinde at erklære platformen compliant
 *     eller production-ready,
 *   - tillader kun et verificeret menneske med en accept-rolle at acceptere et
 *     krav, kræver en begrundelse og afviser selv-accept (adskillelse af
 *     ansvar), og
 *   - bevarer hver accept i en hash-kædet append-only journal.
 *
 * En eksport er ikke en accept, og en accept er ikke en certificering.
 */
import { assembleEvidencePackage } from "./assurance.mjs";

export class AssuranceError extends Error {
  constructor(message, { status = 400, code = "assurance_error" } = {}) {
    super(message);
    this.name = "AssuranceError";
    this.status = status;
    this.code = code;
  }
}

export const ASSURANCE_READ_ROLES = Object.freeze(["platform-admin", "platform-owner", "dpo", "security-owner", "compliance-officer", "operations-lead", "auditor"]);
export const ASSURANCE_ACCEPT_ROLES = Object.freeze(["platform-admin", "platform-owner", "dpo", "security-owner", "operations-lead"]);

function roleSet(principal) {
  return new Set([...(principal?.groups ?? []), ...(principal?.roles ?? [])]);
}

function assertVerified(principal) {
  if (!principal || typeof principal.id !== "string" || principal.id.trim() === "") {
    throw new AssuranceError("manglende verificeret identitet", { status: 401, code: "principal_missing" });
  }
  if (principal.demo === true) {
    throw new AssuranceError("demo-identitet kan ikke bruges til assurance", { status: 403, code: "demo_identity" });
  }
  if (!["human", "workload"].includes(principal.kind)) {
    throw new AssuranceError("ukendt principal-type", { status: 403, code: "principal_kind" });
  }
}

function authorize(principal, roles, action) {
  assertVerified(principal);
  const available = roleSet(principal);
  if (!roles.some((role) => available.has(role))) {
    throw new AssuranceError(`principal mangler en rolle der tillader ${action}`, { status: 403, code: "forbidden" });
  }
}

function assertHuman(principal, action) {
  if (principal.kind !== "human") {
    throw new AssuranceError(`kun et verificeret menneske kan ${action}`, { status: 403, code: "human_required" });
  }
}

export function createAssuranceService({ register, ledger, clock = () => Date.now() } = {}) {
  if (!register) throw new Error("createAssuranceService kræver et register");
  if (!ledger) throw new Error("createAssuranceService kræver en acceptjournal");

  return {
    kind: "assurance-service",

    /** Læs registeret. Kræver en rolle med læseadgang. */
    readRegister(principal) {
      authorize(principal, ASSURANCE_READ_ROLES, "at læse assurance-registeret");
      return structuredClone(register);
    },

    /** Saml en evidenspakke. Pakken erklærer aldrig compliance eller produktion. */
    exportPackage(principal, { evidenceRecords = [], expected = {}, requireSignature = false, trustKeys = null, registerCommit = null, now = clock() } = {}) {
      authorize(principal, ASSURANCE_READ_ROLES, "at eksportere evidenspakken");
      return assembleEvidencePackage({ register, evidenceRecords, expected, requireSignature, trustKeys, registerCommit, now });
    },

    /**
     * Acceptér et krav. Kræver et verificeret menneske med en accept-rolle, en
     * begrundelse og et andet subject end kravets ejer (adskillelse af ansvar).
     */
    acceptRequirement(principal, { requirementId, rationale, decisionRef = null } = {}) {
      authorize(principal, ASSURANCE_ACCEPT_ROLES, "at acceptere et krav");
      assertHuman(principal, "acceptere et krav");
      const requirement = (register.requirements ?? []).find((r) => r.id === requirementId);
      if (!requirement) throw new AssuranceError(`ukendt krav '${requirementId}'`, { status: 404, code: "requirement_not_found" });
      if (typeof rationale !== "string" || rationale.trim().length < 20) {
        throw new AssuranceError("en accept kræver en begrundelse på mindst 20 tegn", { status: 422, code: "rationale_required" });
      }
      if (requirement.owner?.subject === principal.subject) {
        throw new AssuranceError("kravets ejer kan ikke acceptere sit eget krav (adskillelse af ansvar)", { status: 403, code: "self_accept" });
      }
      const at = new Date(clock()).toISOString();
      const record = ledger.append({
        id: `${requirementId}:${at}`,
        kind: "requirement-acceptance",
        requirementId,
        acceptedBy: { subject: principal.subject ?? principal.id, name: principal.name ?? principal.id, role: (principal.roles ?? [])[0] ?? "unknown" },
        rationale: rationale.trim(),
        decisionRef,
        at,
        notACertification: true,
      });
      return { accepted: true, requirementId, record, complianceStatus: "not-certified" };
    },

    /** Læs acceptjournalen (kun med læseadgang). */
    acceptanceHistory(principal) {
      authorize(principal, ASSURANCE_READ_ROLES, "at læse acceptjournalen");
      return { entries: ledger.entries(), head: ledger.head(), verification: ledger.verify() };
    },
  };
}
