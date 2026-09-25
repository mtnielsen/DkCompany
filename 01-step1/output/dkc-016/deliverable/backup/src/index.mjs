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
 */
export { CryptoError, sha256Hex, toKeyBytes, encryptComponent, decryptComponent } from "./crypto.mjs";
export { KeyAccessError, createFileKeyProvider, createMemoryKeyProvider } from "./keys.mjs";
export { SuppressionError, createSuppressionLedger } from "./suppression.mjs";
export { collectObjectFiles } from "./objects.mjs";
export { BackupIntegrityError, createBackup, readBackup, computeManifestDigest } from "./vault.mjs";
export { restoreBackup, functionalChecks } from "./restore.mjs";
export { runRestoreDrill, latestWriteAt } from "./drill.mjs";
export { BackupAuthorizationError, DEFAULT_BACKUP_ROLES, DEFAULT_RESTORE_ROLES, createBackupAuthorizer, assertBackupAuthorization } from "./authz.mjs";
