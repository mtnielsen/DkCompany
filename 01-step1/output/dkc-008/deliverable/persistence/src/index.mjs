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
export { createSqliteBudgetStore } from "./adapters/budgets.mjs";
export { createSqliteAuditLog } from "./adapters/audit.mjs";
