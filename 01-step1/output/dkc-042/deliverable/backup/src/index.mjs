/**
 * DKC-016 — samlet indgang til backup- og gendannelsesmodulet.
 *
 *   - `keys.mjs`        — separat nøgleadgang (nøglen ligger ikke i lageret),
 *   - `crypto.mjs`      — AES-256-GCM med AAD-binding,
 *   - `vault.mjs`       — krypteret backupbeholder med manifest og checksums,
 *   - `suppression.mjs` — append-only suppressionsjournal for slettede data,
 *   - `restore.mjs`     — isoleret gendannelse og funktionelle checks,
 *   - `drill.mjs`       — målt RPO/RTO med release-gate,
 *   - `authz.mjs`       — default-deny autorisation og to-personers-godkendelse.
 *
 * DKC-057 tilføjer:
 *   - `backends/`       — filsystem- og S3-kompatible objektlager-backends,
 *   - `targets.mjs`     — preflight, canary, synkronisering og skift af mål.
 */
export { CryptoError, sha256Hex, toKeyBytes, encryptComponent, decryptComponent } from "./crypto.mjs";
export { KeyAccessError, createFileKeyProvider, createMemoryKeyProvider } from "./keys.mjs";
export { SuppressionError, createSuppressionLedger } from "./suppression.mjs";
export { collectObjectFiles } from "./objects.mjs";
export { BackupIntegrityError, createBackup, readBackup, computeManifestDigest } from "./vault.mjs";
export { restoreBackup, functionalChecks } from "./restore.mjs";
export { runRestoreDrill, latestWriteAt } from "./drill.mjs";
export { BackupAuthorizationError, DEFAULT_BACKUP_ROLES, DEFAULT_RESTORE_ROLES, createBackupAuthorizer, assertBackupAuthorization } from "./authz.mjs";
export { BackupTargetError, TARGET_ERROR_CODES, classifyTargetError } from "./errors.mjs";
export { createFilesystemBackend, createS3Backend, createBackendForTarget } from "./backends/index.mjs";
export { signS3Request } from "./backends/s3.mjs";
export {
  loadBackupTargets,
  findTarget,
  resolveCredentials,
  preflightTarget,
  canaryTarget,
  syncBackupToTarget,
  fetchBackupFromTarget,
  planTargetSwitch,
  canPurgePreviousTarget,
  statBackupStore,
  sha256Hex as targetSha256Hex,
} from "./targets.mjs";

// DKC-042 — uafhængig backup, PITR og katastrofegendannelse.
export {
  loadDisasterRecoveryPlan,
  loadRecoveryAccessProfile,
  disasterRecoveryPlanProblems,
  DR_PLAN_PATH,
  RECOVERY_ACCESS_PATH,
} from "./dr/plan.mjs";
export { RecoveryAccessError, createRecoveryAccessGate, recoveryAccessProblems, assertRecoveryAccess } from "./dr/access.mjs";
export { PitrError, createWalArchive, planPointInTimeRecovery, aclAsOf, reconcileAcl, recoverToPointInTime, pitrReconciliationProblems } from "./dr/pitr.mjs";
export { runDisasterRecoveryDrill, disasterRecoveryDrillProblems } from "./dr/drill.mjs";
export { renderDrPlan } from "./dr/render.mjs";
