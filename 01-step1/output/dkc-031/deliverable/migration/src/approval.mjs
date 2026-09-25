/**
 * DKC-031 — pilotgodkendelse af indhold og adgangsrettigheder.
 *
 * Efter en import skal pilotbrugerne godkende både **indholdet** og
 * **adgangsrettighederne**. Godkendelsen kommer fra et navngivet, verificeret
 * menneske i kundens tenant og kan ikke gives af den der udførte migrationen
 * (to-personers-kontrol af en irreversibel overgang). Uden begge godkendelser
 * kan cutover ikke gennemføres.
 */
import { migrationApprovalProblems } from "./model.mjs";

export class MigrationApprovalError extends Error {
  constructor(message, code = "migration_approval_error", status = 400) {
    super(message);
    this.name = "MigrationApprovalError";
    this.code = code;
    this.status = status;
  }
}

export function recordApproval({ store, principal, tenantId, appId, contentApproved = false, aclApproved = false, method = "pilot-user-sign-off", evidenceRef = null, operatorSubject = null, at = "2026-03-01T00:00:00Z" } = {}) {
  if (!principal || principal.kind !== "human" || typeof principal.id !== "string") {
    throw new MigrationApprovalError("kun et verificeret menneske kan godkende migrationen", "human_required", 403);
  }
  if (principal.tenantId !== tenantId) {
    throw new MigrationApprovalError(`principalen tilhører '${principal.tenantId ?? "ingen tenant"}', ikke '${tenantId}'`, "tenant_mismatch", 403);
  }
  const approval = {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "MigrationApproval",
    tenantId,
    appId,
    approvedBy: { subject: principal.id, name: principal.name ?? principal.id, role: principal.role ?? principal.roles?.[0] ?? "member" },
    contentApproved: contentApproved === true,
    aclApproved: aclApproved === true,
    method,
    evidenceRef,
    approvedAt: at,
    operatorSubject,
  };
  const problems = migrationApprovalProblems(approval, { operatorSubject, tenantId, appId });
  if (problems.length) throw new MigrationApprovalError(problems[0].message, "invalid_approval");
  store.saveApproval(approval);
  return approval;
}
