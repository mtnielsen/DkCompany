/**
 * DKC-042 — separat backup- og recovery-adgang.
 *
 * To ting håndhæves her:
 *
 *   1. **Semantik** for recovery-adgangsprofilen: recovery-identiteten skal være
 *      adskilt fra primærklyngens driftscredentials, kun et verificeret menneske
 *      må aktivere den, aktivering kræver to-personers godkendelse, der må ikke
 *      findes stående adgang, og nøgler/konfiguration/katalog/images holdes
 *      adskilt fra backup-lageret og pinnes på digest.
 *   2. **Default-deny-porten** som afviser primærklyngens driftscredentials når
 *      de forsøger at slette en beskyttet backup, og som kun tillader sletning
 *      når to forskellige, navngivne mennesker har godkendt den. Porten kalder
 *      derefter det rigtige lager, hvor COMPLIANCE-låsen mekanisk afviser
 *      sletningen, så et kompromitteret driftscredentials ikke kan fjerne
 *      historik.
 */
import { isNamedHuman } from "../../../conformance/src/architecture.mjs";

export class RecoveryAccessError extends Error {
  constructor(message, code = "recovery_access_denied") {
    super(message);
    this.name = "RecoveryAccessError";
    this.code = code;
  }
}

const SHA256 = /^[a-f0-9]{64}$/;
const IMAGE_DIGEST = /^sha256:[a-f0-9]{64}$/;

/* -------------------------------------------------------------------------- */
/* Semantik                                                                   */
/* -------------------------------------------------------------------------- */

export function recoveryAccessProblems(profile) {
  const problems = [];
  const err = (path, message) => ({ path, message });
  if (!profile || typeof profile !== "object") return [err("/", "recovery-adgangsprofilen er ikke et objekt")];

  if (!isNamedHuman(profile.metadata?.accountableHuman)) problems.push(err("/metadata/accountableHuman", "profilen skal have et navngivet menneske som ejer"));

  const primary = profile.primaryOperations ?? {};
  if (!(primary.credentialsRef ?? "").trim()) problems.push(err("/primaryOperations/credentialsRef", "primærklyngens driftscredentials skal være angivet"));
  const forbidden = primary.forbiddenOnProtectedBackups ?? [];
  for (const op of ["delete", "retention-shorten"]) {
    if (!forbidden.includes(op)) problems.push(err("/primaryOperations/forbiddenOnProtectedBackups", `'${op}' skal være forbudt for primærklyngens driftscredentials`));
  }

  const recovery = profile.recoveryIdentity ?? {};
  if (recovery.separateFromPrimary !== true) problems.push(err("/recoveryIdentity/separateFromPrimary", "recovery-identiteten skal være adskilt fra primærdriften"));
  if (recovery.humanVerifiedOnly !== true) problems.push(err("/recoveryIdentity/humanVerifiedOnly", "kun et verificeret menneske må aktivere recovery-adgang"));
  if (recovery.standingAccess !== false) problems.push(err("/recoveryIdentity/standingAccess", "recovery-adgangen må ikke være stående"));
  if (recovery.activationRequiresTwoPerson !== true) problems.push(err("/recoveryIdentity/activationRequiresTwoPerson", "aktivering skal kræve to-personers godkendelse"));
  const approval = recovery.approval ?? {};
  if (!isNamedHuman(approval.approver1) || !isNamedHuman(approval.approver2)) {
    problems.push(err("/recoveryIdentity/approval", "begge godkendere skal være navngivne mennesker"));
  }
  if (approval.requesterMayNotApprove !== true) problems.push(err("/recoveryIdentity/approval/requesterMayNotApprove", "rekvirenten må ikke godkende sin egen aktivering"));
  if (!(approval.maxDurationMinutes > 0)) problems.push(err("/recoveryIdentity/approval/maxDurationMinutes", "aktiveringen skal være tidsbegrænset"));
  if ((recovery.subjectRef ?? "") === (primary.credentialsRef ?? "")) {
    problems.push(err("/recoveryIdentity/subjectRef", "recovery-identiteten må ikke være identisk med primærklyngens driftscredentials"));
  }

  const keys = profile.keys ?? {};
  if (keys.separateFromBackupStore !== true) problems.push(err("/keys/separateFromBackupStore", "krypteringsnøglen skal være adskilt fra backup-lageret"));
  if (!(keys.keyRef ?? "").trim()) problems.push(err("/keys/keyRef", "der skal peges på en nøgle uden for backup-lageret"));

  const config = profile.configuration ?? {};
  if (config.redactedInBackup !== true) problems.push(err("/configuration/redactedInBackup", "konfigurationen skal redigeres før den lægges i backup"));
  if (!(config.vaultPath ?? "").trim()) problems.push(err("/configuration/vaultPath", "konfigurationen skal komme fra et secret-store"));

  if (!SHA256.test(profile.catalog?.digest ?? "")) problems.push(err("/catalog/digest", "kataloget skal pinnes på en SHA-256"));
  if (profile.catalog?.signed !== true) problems.push(err("/catalog/signed", "kataloget skal være signeret"));

  const images = profile.images ?? [];
  if (images.length < 1) problems.push(err("/images", "der skal pinnes mindst ét image"));
  for (const [i, image] of images.entries()) {
    if (!IMAGE_DIGEST.test(image.digest ?? "")) problems.push(err(`/images/${i}/digest`, `imaget '${image.name}' skal pinnes på et digest`));
    if (!(image.signedBy ?? "").trim()) problems.push(err(`/images/${i}/signedBy`, `imaget '${image.name}' skal have en signerende identitet`));
  }

  if (profile.accessPolicy?.defaultDeny !== true) problems.push(err("/accessPolicy/defaultDeny", "adgangspolitikken skal være default-deny"));
  const allowed = new Set(profile.accessPolicy?.allowedRoles ?? []);
  const denied = new Set(profile.accessPolicy?.deniedRoles ?? []);
  if (allowed.size === 0) problems.push(err("/accessPolicy/allowedRoles", "mindst én rolle skal kunne aktivere recovery-adgang"));
  for (const role of allowed) {
    if (denied.has(role)) problems.push(err("/accessPolicy/allowedRoles", `rollen '${role}' kan ikke både være tilladt og nægtet`));
  }
  if (allowed.has(primary.roleId)) problems.push(err("/accessPolicy/allowedRoles", "primærklyngens driftsrolle må ikke være tilladt for recovery-adgang"));

  return problems;
}

/* -------------------------------------------------------------------------- */
/* Default-deny-port                                                          */
/* -------------------------------------------------------------------------- */

function deny(reason, code = "recovery_access_denied") {
  return { decision: "deny", allowed: false, reason, code };
}

function allow(obligations = ["audit"]) {
  return { decision: "allow", allowed: true, reason: null, code: null, obligations };
}

/**
 * @param {object} options
 * @param {object} options.profile  Den kanoniske RecoveryAccessProfile.
 * @param {object} [options.storage] Et lager med `deleteVersion` (DKC-041/048).
 * @param {Function} [options.clock]
 */
export function createRecoveryAccessGate({ profile, storage = null, clock = () => Date.now() } = {}) {
  if (!profile) throw new RecoveryAccessError("createRecoveryAccessGate kræver en adgangsprofil", "missing_profile");
  const primary = profile.primaryOperations ?? {};
  const recovery = profile.recoveryIdentity ?? {};
  const allowed = new Set(profile.accessPolicy?.allowedRoles ?? []);
  const denied = new Set(profile.accessPolicy?.deniedRoles ?? []);

  function isPrimaryOperations(principal) {
    if (!principal) return false;
    if (principal.credentialsRef && principal.credentialsRef === primary.credentialsRef) return true;
    if (principal.roleId && principal.roleId === primary.roleId) return true;
    return (principal.roles ?? []).includes(primary.roleId);
  }

  return {
    kind: "recovery-access-gate",
    profileName: profile.metadata?.name ?? null,
    primaryCredentialsRef: primary.credentialsRef,
    recoverySubjectRef: recovery.subjectRef,

    /**
     * Afgør om en principal må slette en beskyttet backup. Primærklyngens
     * driftscredentials afvises altid; enhver sletning kræver to forskellige,
     * navngivne mennesker.
     */
    authorizeProtectedBackupDelete({ principal, copy = null, approval = null } = {}) {
      if (!principal) return deny("ingen verificeret principal");
      if (isPrimaryOperations(principal)) {
        return deny("primærklyngens driftscredentials kan ikke slette beskyttede backups", "primary_operations_forbidden");
      }
      const hasRole = (principal.roles ?? []).some((r) => allowed.has(r)) || allowed.has(principal.roleId);
      if (!hasRole) return deny("principalen har ikke en recovery-rolle", "role_required");
      if ((principal.roles ?? []).some((r) => denied.has(r))) return deny("principalen bærer en nægtet rolle", "role_denied");
      if (copy && copy.deletePermission === "compliance") {
        return deny("COMPLIANCE-låste backups kan ikke slettes", "compliance_locked");
      }
      if (!approval || !isNamedHuman(approval.approver1) || !isNamedHuman(approval.approver2)) {
        return deny("sletning kræver to navngivne godkendere", "approval_required");
      }
      if (approval.approver1.subject === approval.approver2.subject) {
        return deny("de to godkendere skal være forskellige personer", "separation_of_duties");
      }
      const actor = principal.subject ?? principal.id ?? principal.oidcSub ?? null;
      if (actor && (actor === approval.approver1.subject || actor === approval.approver2.subject)) {
        return deny("udføreren må ikke også være godkender", "separation_of_duties");
      }
      return allow(["audit", "two-person-approval"]);
    },

    /** Aktivering af recovery-adgang kræver et verificeret menneske og to godkendere. */
    authorizeActivation({ principal, approval = null } = {}) {
      if (!principal) return deny("ingen verificeret principal");
      if (principal.kind !== "human") return deny("recovery-adgang kan kun aktiveres af et verificeret menneske", "human_required");
      if (isPrimaryOperations(principal)) return deny("primærklyngens driftscredentials kan ikke aktivere recovery-adgang", "primary_operations_forbidden");
      if (recovery.standingAccess !== false) return deny("recovery-adgangen må ikke være stående", "standing_access");
      if (!approval || !isNamedHuman(approval.approver1) || !isNamedHuman(approval.approver2)) {
        return deny("aktivering kræver to navngivne godkendere", "approval_required");
      }
      if (approval.approver1.subject === approval.approver2.subject) return deny("de to godkendere skal være forskellige personer", "separation_of_duties");
      const actor = principal.subject ?? principal.id ?? principal.oidcSub ?? null;
      const maxMinutes = recovery.approval?.maxDurationMinutes ?? 30;
      return allow([`time-boxed:${maxMinutes}m`, "audit", "two-person-approval", actor ? `actor:${actor}` : "actor:unknown"]);
    },

    /**
     * Forsøg en rigtig sletning gennem porten. Returnerer en dom og — hvis
     * tilladt — lagerets svar. Et afvist forsøg rører ikke lageret.
     */
    deleteProtectedBackup({ principal, tenantId, key, version, copy = null, approval = null } = {}) {
      const decision = this.authorizeProtectedBackupDelete({ principal, copy, approval });
      if (!decision.allowed) return { ...decision, deleted: false, storage: null };
      if (!storage) return { ...decision, deleted: false, storage: { reason: "no-storage" } };
      const target = storage.deleteVersion(tenantId, key, version, { now: clock() });
      return { ...decision, deleted: Boolean(target.deleted), storage: target };
    },
  };
}

export function assertRecoveryAccess(decision) {
  if (!decision.allowed) throw new RecoveryAccessError(decision.reason, decision.code);
  return decision;
}
