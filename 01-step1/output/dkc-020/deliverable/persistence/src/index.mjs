/**
 * DKC-008 — holdbar tilstand og migrationer.
 *
 * Samlet indgang til persistenslaget:
 *   - `openDatabase` / `createMigrator` — database og versionsstyrede migrationer
 *   - `openIdentity` / `openPlatform` — adskilte databaseidentiteter
 *   - adapters — holdbare godkendelser, jobs, budgetter og audit
 *   - `backupDatabase` / `restoreDatabase` — backup- og gendannelsesøvelser
 */
export { openDatabase, TENANT_TABLES } from "./db.mjs";
export { createMigrator, discoverMigrations, migrationsDir, MigrationError } from "./migrations.mjs";
export { DB_IDENTITIES, migrateDatabase, openIdentity, openPlatform, openReadOnlyIdentity } from "./identities.mjs";
export { backupDatabase, restoreDatabase, tableCounts, exerciseBackupRestore } from "./backup.mjs";
export { createSqliteApprovalStore } from "./adapters/approvals.mjs";
export { createSqliteApprovalLedger } from "./adapters/approval-ledger.mjs";
export { createSqliteJobStore } from "./adapters/jobs.mjs";
export { createSqliteJobQueue } from "./adapters/job-queue.mjs";
export { createSqliteBudgetStore, BudgetError } from "./adapters/budgets.mjs";
export { createSqliteGatewayCallStore } from "./adapters/gateway-calls.mjs";
export { createSqliteAuditLog, computeChainHash } from "./adapters/audit.mjs";
export { createSqliteRevocationStore } from "./adapters/revocations.mjs";
export { createSqliteStopStore } from "./adapters/stops.mjs";
export { createSqliteIssuanceLedger } from "./adapters/issuances.mjs";
export { createSqliteDataRegisterStore, DataRegisterError, digestOf, canonicalJson } from "./adapters/data-register.mjs";
export { createSqliteActionJournal, JournalError } from "./adapters/audit-journal.mjs";
export { createSqliteAdapterIdempotencyStore, requestDigest } from "./adapters/adapter-idempotency.mjs";
export { createSqliteDsarStore, DsarError } from "./adapters/dsar.mjs";
export { createCheckpointStore } from "./checkpoint.mjs";
export { openAuditWriter, openAuditReader, auditRoles } from "./audit-roles.mjs";
export { prepareAuditPayload, redactSecrets, payloadDigestOf, REDACTED } from "./redact.mjs";
