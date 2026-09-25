/**
 * DKC-056 — holdbar datatjeneste-tilstand.
 *
 * Adapteren gemmer databaseprofiler, datakilder, bindinger, discovery-snapshots,
 * migrationslog og revisionsspor pr. tenant. Hver metode normaliserer tenant-id
 * og filtrerer eksplicit på `tenant_id`, så en fremmed tenant ikke kan læse eller
 * skrive en andens datatjenester. Tjeneste-/connectorlaget ovenover håndhæver
 * autorisationen.
 */
import { normalizeTenantId } from "../../../identity/src/tenant.mjs";
import { canonicalJson, digestOf } from "./data-register.mjs";

export class DataServicesStoreError extends Error {
  constructor(message) {
    super(message);
    this.name = "DataServicesStoreError";
  }
}

export function createSqliteDataServicesStore({ db, clock = () => Date.now(), kind = "sqlite-data-services-store" } = {}) {
  if (!db) throw new Error("createSqliteDataServicesStore kræver en database");

  const upsertProfile = db.prepare(`INSERT INTO data_service_profiles(
      tenant_id, profile_id, profile_type, engine_family, digest, document, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tenant_id, profile_id) DO UPDATE SET
      profile_type = excluded.profile_type, engine_family = excluded.engine_family,
      digest = excluded.digest, document = excluded.document, updated_at = excluded.updated_at`);
  const getProfileStmt = db.prepare("SELECT * FROM data_service_profiles WHERE tenant_id = ? AND profile_id = ?");
  const listProfilesStmt = db.prepare("SELECT * FROM data_service_profiles WHERE tenant_id = ? ORDER BY profile_id");

  const upsertSource = db.prepare(`INSERT INTO data_service_sources(
      tenant_id, source_id, source_type, data_owner_subject, read_only, allowed_schemas, allowed_tables,
      secret_ref, treat_as_own_database, auto_migrate, auto_backup, digest, document, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tenant_id, source_id) DO UPDATE SET
      source_type = excluded.source_type, data_owner_subject = excluded.data_owner_subject, read_only = excluded.read_only,
      allowed_schemas = excluded.allowed_schemas, allowed_tables = excluded.allowed_tables, secret_ref = excluded.secret_ref,
      treat_as_own_database = excluded.treat_as_own_database, auto_migrate = excluded.auto_migrate, auto_backup = excluded.auto_backup,
      digest = excluded.digest, document = excluded.document, updated_at = excluded.updated_at`);
  const getSourceStmt = db.prepare("SELECT * FROM data_service_sources WHERE tenant_id = ? AND source_id = ?");
  const listSourcesStmt = db.prepare("SELECT * FROM data_service_sources WHERE tenant_id = ? ORDER BY source_id");

  const upsertBinding = db.prepare(`INSERT INTO data_service_bindings(
      tenant_id, binding_id, application_ref, database_profile_ref, digest, document, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tenant_id, binding_id) DO UPDATE SET
      application_ref = excluded.application_ref, database_profile_ref = excluded.database_profile_ref,
      digest = excluded.digest, document = excluded.document, updated_at = excluded.updated_at`);
  const getBindingStmt = db.prepare("SELECT * FROM data_service_bindings WHERE tenant_id = ? AND binding_id = ?");
  const listBindingsStmt = db.prepare("SELECT * FROM data_service_bindings WHERE tenant_id = ? ORDER BY binding_id");

  const insertSnapshot = db.prepare(`INSERT INTO data_service_schema_snapshots(
      tenant_id, source_id, discovered_at, digest, document)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(tenant_id, source_id, discovered_at) DO UPDATE SET digest = excluded.digest, document = excluded.document`);
  const listSnapshotsStmt = db.prepare("SELECT * FROM data_service_schema_snapshots WHERE tenant_id = ? AND source_id = ? ORDER BY discovered_at DESC");

  const insertMigration = db.prepare(`INSERT INTO data_service_migration_log(
      tenant_id, migration_id, profile_ref, owned_schemas, statement_count, destructive_count,
      applied_by, approved_by, applied_at, digest, document)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const listMigrationsStmt = db.prepare("SELECT * FROM data_service_migration_log WHERE tenant_id = ? ORDER BY applied_at DESC");

  const insertAudit = db.prepare(`INSERT INTO data_service_audit(
      tenant_id, event_id, source_id, operation, principal, allowed, reason, sql_digest, occurred_at, document)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const listAuditStmt = db.prepare("SELECT * FROM data_service_audit WHERE tenant_id = ? ORDER BY occurred_at DESC");
  const listAuditBySourceStmt = db.prepare("SELECT * FROM data_service_audit WHERE tenant_id = ? AND source_id = ? ORDER BY occurred_at DESC");

  function profileRecord(row) {
    if (!row) return null;
    return { tenantId: row.tenant_id, profileId: row.profile_id, profileType: row.profile_type, engineFamily: row.engine_family, digest: row.digest, updatedAt: row.updated_at, document: JSON.parse(row.document) };
  }
  function sourceRecord(row) {
    if (!row) return null;
    return {
      tenantId: row.tenant_id,
      sourceId: row.source_id,
      sourceType: row.source_type,
      dataOwnerSubject: row.data_owner_subject,
      readOnly: row.read_only === 1,
      allowedSchemas: JSON.parse(row.allowed_schemas),
      allowedTables: JSON.parse(row.allowed_tables),
      secretRef: row.secret_ref,
      externalPolicy: { treatAsOwnDatabase: row.treat_as_own_database === 1, autoMigrate: row.auto_migrate === 1, autoBackup: row.auto_backup === 1 },
      digest: row.digest,
      updatedAt: row.updated_at,
      document: JSON.parse(row.document),
    };
  }
  function bindingRecord(row) {
    if (!row) return null;
    return { tenantId: row.tenant_id, bindingId: row.binding_id, applicationRef: row.application_ref, databaseProfileRef: row.database_profile_ref, digest: row.digest, updatedAt: row.updated_at, document: JSON.parse(row.document) };
  }
  function snapshotRecord(row) {
    return { tenantId: row.tenant_id, sourceId: row.source_id, discoveredAt: row.discovered_at, digest: row.digest, document: JSON.parse(row.document) };
  }
  function migrationRecord(row) {
    return {
      tenantId: row.tenant_id,
      migrationId: row.migration_id,
      profileRef: row.profile_ref,
      ownedSchemas: JSON.parse(row.owned_schemas),
      statementCount: row.statement_count,
      destructiveCount: row.destructive_count,
      appliedBy: row.applied_by,
      approvedBy: row.approved_by,
      appliedAt: row.applied_at,
      digest: row.digest,
      document: JSON.parse(row.document),
    };
  }
  function auditRecord(row) {
    return {
      tenantId: row.tenant_id,
      eventId: row.event_id,
      sourceId: row.source_id,
      operation: row.operation,
      principal: row.principal,
      allowed: row.allowed === 1,
      reason: row.reason,
      sqlDigest: row.sql_digest,
      occurredAt: row.occurred_at,
      document: JSON.parse(row.document),
    };
  }

  return {
    kind,

    saveProfile(tenantId, profile) {
      if (!profile?.metadata?.name) throw new DataServicesStoreError("profilen mangler metadata.name");
      const tenant = normalizeTenantId(tenantId);
      const at = new Date(clock()).toISOString();
      const digest = digestOf(profile);
      upsertProfile.run(tenant, profile.metadata.name, profile.profileType, profile.engine?.family ?? "unknown", digest, canonicalJson(profile), at);
      return { tenantId: tenant, profileId: profile.metadata.name, digest, updatedAt: at };
    },
    getProfile(tenantId, profileId) {
      return profileRecord(getProfileStmt.get(normalizeTenantId(tenantId), profileId));
    },
    listProfiles(tenantId) {
      return listProfilesStmt.all(normalizeTenantId(tenantId)).map(profileRecord);
    },

    saveSource(tenantId, source) {
      if (!source?.metadata?.name) throw new DataServicesStoreError("datakilden mangler metadata.name");
      const tenant = normalizeTenantId(tenantId);
      const at = new Date(clock()).toISOString();
      const digest = digestOf(source);
      const policy = source.externalPolicy ?? {};
      upsertSource.run(
        tenant,
        source.metadata.name,
        source.sourceType,
        source.dataOwnership?.owner?.subject ?? "",
        source.access?.readOnly ? 1 : 0,
        JSON.stringify(source.access?.allowedSchemas ?? []),
        JSON.stringify(source.access?.allowedTables ?? []),
        source.connection?.secretRef ?? "",
        policy.treatAsOwnDatabase ? 1 : 0,
        policy.autoMigrate ? 1 : 0,
        policy.autoBackup ? 1 : 0,
        digest,
        canonicalJson(source),
        at
      );
      return { tenantId: tenant, sourceId: source.metadata.name, digest, updatedAt: at };
    },
    getSource(tenantId, sourceId) {
      return sourceRecord(getSourceStmt.get(normalizeTenantId(tenantId), sourceId));
    },
    listSources(tenantId) {
      return listSourcesStmt.all(normalizeTenantId(tenantId)).map(sourceRecord);
    },

    saveBinding(tenantId, binding) {
      if (!binding?.metadata?.name) throw new DataServicesStoreError("bindingen mangler metadata.name");
      const tenant = normalizeTenantId(tenantId);
      const at = new Date(clock()).toISOString();
      const digest = digestOf(binding);
      upsertBinding.run(tenant, binding.metadata.name, binding.application?.ref ?? "", binding.databaseProfileRef ?? "", digest, canonicalJson(binding), at);
      return { tenantId: tenant, bindingId: binding.metadata.name, digest, updatedAt: at };
    },
    getBinding(tenantId, bindingId) {
      return bindingRecord(getBindingStmt.get(normalizeTenantId(tenantId), bindingId));
    },
    listBindings(tenantId) {
      return listBindingsStmt.all(normalizeTenantId(tenantId)).map(bindingRecord);
    },

    recordSchemaSnapshot(tenantId, sourceId, snapshot) {
      const tenant = normalizeTenantId(tenantId);
      const discoveredAt = snapshot?.discoveredAt ?? new Date(clock()).toISOString();
      const digest = digestOf(snapshot);
      insertSnapshot.run(tenant, sourceId, discoveredAt, digest, canonicalJson(snapshot));
      return { tenantId: tenant, sourceId, discoveredAt, digest };
    },
    listSchemaSnapshots(tenantId, sourceId) {
      return listSnapshotsStmt.all(normalizeTenantId(tenantId), sourceId).map(snapshotRecord);
    },

    recordMigration(tenantId, { migrationId = null, profileRef, report, appliedBy = null, approvedBy = null, sql = "" } = {}) {
      const tenant = normalizeTenantId(tenantId);
      const at = new Date(clock()).toISOString();
      const id = migrationId ?? `${tenant}:${profileRef}:${at}`;
      const digest = digestOf({ profileRef, sql, appliedBy, approvedBy });
      const document = { profileRef, sql, appliedBy, approvedBy, appliedAt: at, ownedSchemas: report?.ownedSchemas ?? [], destructiveCount: report?.destructiveCount ?? 0 };
      insertMigration.run(tenant, id, profileRef ?? "", JSON.stringify(report?.ownedSchemas ?? []), report?.statements?.length ?? 0, report?.destructiveCount ?? 0, appliedBy, approvedBy, at, digest, canonicalJson(document));
      return { tenantId: tenant, migrationId: id, appliedAt: at, digest };
    },
    listMigrations(tenantId) {
      return listMigrationsStmt.all(normalizeTenantId(tenantId)).map(migrationRecord);
    },

    recordAudit(tenantId, event) {
      const tenant = normalizeTenantId(tenantId);
      const at = event?.at ?? new Date(clock()).toISOString();
      const id = event?.eventId ?? `${tenant}:${event?.sourceId ?? "?"}:${at}:${Math.random().toString(36).slice(2, 8)}`;
      insertAudit.run(tenant, id, event?.sourceId ?? "", event?.operation ?? "unknown", event?.principal ?? null, event?.allowed ? 1 : 0, event?.reason ?? null, event?.sqlDigest ?? null, at, canonicalJson({ ...event, at }));
      return { tenantId: tenant, eventId: id, occurredAt: at };
    },
    listAudit(tenantId, { sourceId = null } = {}) {
      const tenant = normalizeTenantId(tenantId);
      const rows = sourceId ? listAuditBySourceStmt.all(tenant, sourceId) : listAuditStmt.all(tenant);
      return rows.map(auditRecord);
    },
  };
}
