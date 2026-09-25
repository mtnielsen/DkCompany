/**
 * DKC-016 — default-deny autorisation af backup og gendannelse.
 *
 * Backup indeholder hele tenantens data og skal derfor beskyttes som en
 * privilegeret handling. Autorisationen er default-deny og ser kun på den
 * verificerede principal:
 *
 *   - kun et verificeret menneske (ikke en agent eller service) må tage backup
 *     eller gendanne,
 *   - principalen skal tilhøre tenanten,
 *   - backup kræver rollen `backup-operator`/`continuity-officer`,
 *   - gendannelse kræver `continuity-officer` **og** en separat, navngivet
 *     godkendelse bundet til backup-id'et (to-personers-princippet).
 */
export class BackupAuthorizationError extends Error {
  constructor(message, code = "backup_forbidden") {
    super(message);
    this.name = "BackupAuthorizationError";
    this.code = code;
  }
}

export const DEFAULT_BACKUP_ROLES = ["backup-operator", "continuity-officer", "platform-admin"];
export const DEFAULT_RESTORE_ROLES = ["continuity-officer", "platform-admin"];

function deny(reason, code = "backup_forbidden") {
  return { decision: "deny", allowed: false, reason, code, obligations: [] };
}

function allow(obligations = ["audit"]) {
  return { decision: "allow", allowed: true, reason: null, code: null, obligations };
}

export function createBackupAuthorizer({ backupRoles = DEFAULT_BACKUP_ROLES, restoreRoles = DEFAULT_RESTORE_ROLES } = {}) {
  return {
    kind: "backup-authorizer",
    authorize({ principal, tenantId, action = "backup", approval = null, backupId = null } = {}) {
      if (!principal) return deny("ingen verificeret principal");
      if (principal.demo === true) return deny("demo-identitet kan ikke styre backup/gendannelse", "demo_forbidden");
      if (principal.kind !== "human") return deny("kun et verificeret menneske må styre backup/gendannelse", "human_required");
      const tenant = principal.tenantId ?? principal.tenant_id ?? null;
      if (!tenant || String(tenant) !== String(tenantId)) return deny("principalen tilhører ikke tenanten", "tenant_mismatch");

      if (action === "backup") {
        const hasRole = (principal.roles ?? []).some((r) => backupRoles.includes(r)) || (principal.groups ?? []).some((g) => backupRoles.includes(g));
        if (!hasRole) return deny("mangler rollen backup-operator/continuity-officer", "role_required");
        return allow();
      }

      if (action === "restore") {
        const hasRole = (principal.roles ?? []).some((r) => restoreRoles.includes(r));
        if (!hasRole) return deny("mangler rollen continuity-officer", "role_required");
        if (!approval) return deny("gendannelse kræver en eksplicit, navngivet godkendelse", "approval_required");
        if (approval.backupId && backupId && approval.backupId !== backupId) {
          return deny("godkendelsen er bundet til et andet backup-id", "approval_mismatch");
        }
        if (!approval.approvedBy || !approval.approvedAt) return deny("godkendelsen mangler navngiven godkender eller tidspunkt", "approval_incomplete");
        if (String(approval.approvedBy) === String(principal.id ?? principal.oidcSub ?? "")) {
          return deny("godkenderen må ikke være den samme som den, der udfører gendannelsen", "separation_of_duties");
        }
        return allow(["audit", "two-person-approval"]);
      }

      return deny(`ukendt handling '${action}'`, "unknown_action");
    },
  };
}

export function assertBackupAuthorization(options, authorizer = createBackupAuthorizer()) {
  const decision = authorizer.authorize(options);
  if (!decision.allowed) throw new BackupAuthorizationError(decision.reason, decision.code);
  return decision;
}
