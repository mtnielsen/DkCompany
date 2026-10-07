-- DKC-056, version 8: datatjenester — profiler, kilder, bindinger, discovery,
-- migrationslog og revisionsspor.
--
-- Migrationen er additiv og bagudkompatibel. Den giver datatjenesterne et
-- holdbart, tenant-bundet hjem:
--
--   * data_service_profiles holder den versionerede databaseprofil (managed/BYO).
--   * data_service_sources holder connectorerklæringen med scope og secretreference.
--   * data_service_bindings binder en applikation til profil og kilder.
--   * data_service_schema_snapshots holder et discovery-øjebliksbillede pr. kilde.
--   * data_service_migration_log sporer hvem der anvendte hvilken migration.
--   * data_service_audit er revisionssporet for connect/query/denied/disconnect.
--
-- Alle tabeller bærer tenant_id, så tenant-viewene i db.mjs kan afgrænse dem.

CREATE TABLE data_service_profiles (
  tenant_id      TEXT NOT NULL,
  profile_id     TEXT NOT NULL,
  profile_type   TEXT NOT NULL CHECK (profile_type IN ('managed', 'byo')),
  engine_family  TEXT NOT NULL,
  digest         TEXT NOT NULL,
  document       TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  PRIMARY KEY (tenant_id, profile_id)
);

CREATE TABLE data_service_sources (
  tenant_id                 TEXT NOT NULL,
  source_id                 TEXT NOT NULL,
  source_type               TEXT NOT NULL,
  data_owner_subject        TEXT NOT NULL,
  read_only                 INTEGER NOT NULL DEFAULT 1,
  allowed_schemas           TEXT NOT NULL,
  allowed_tables            TEXT NOT NULL,
  secret_ref                TEXT NOT NULL,
  treat_as_own_database     INTEGER NOT NULL DEFAULT 0,
  auto_migrate              INTEGER NOT NULL DEFAULT 0,
  auto_backup               INTEGER NOT NULL DEFAULT 0,
  digest                    TEXT NOT NULL,
  document                  TEXT NOT NULL,
  updated_at                TEXT NOT NULL,
  PRIMARY KEY (tenant_id, source_id)
);

CREATE TABLE data_service_bindings (
  tenant_id              TEXT NOT NULL,
  binding_id             TEXT NOT NULL,
  application_ref        TEXT NOT NULL,
  database_profile_ref   TEXT NOT NULL,
  digest                 TEXT NOT NULL,
  document               TEXT NOT NULL,
  updated_at             TEXT NOT NULL,
  PRIMARY KEY (tenant_id, binding_id)
);

CREATE TABLE data_service_schema_snapshots (
  tenant_id      TEXT NOT NULL,
  source_id      TEXT NOT NULL,
  discovered_at  TEXT NOT NULL,
  digest         TEXT NOT NULL,
  document       TEXT NOT NULL,
  PRIMARY KEY (tenant_id, source_id, discovered_at)
);
CREATE INDEX idx_data_service_snapshots_source ON data_service_schema_snapshots(tenant_id, source_id, discovered_at);

CREATE TABLE data_service_migration_log (
  tenant_id          TEXT NOT NULL,
  migration_id       TEXT NOT NULL,
  profile_ref        TEXT NOT NULL,
  owned_schemas      TEXT NOT NULL,
  statement_count    INTEGER NOT NULL,
  destructive_count  INTEGER NOT NULL,
  applied_by         TEXT,
  approved_by        TEXT,
  applied_at         TEXT NOT NULL,
  digest             TEXT NOT NULL,
  document           TEXT NOT NULL,
  PRIMARY KEY (tenant_id, migration_id)
);
CREATE INDEX idx_data_service_migrations_profile ON data_service_migration_log(tenant_id, profile_ref, applied_at);

CREATE TABLE data_service_audit (
  tenant_id     TEXT NOT NULL,
  event_id      TEXT NOT NULL,
  source_id     TEXT NOT NULL,
  operation     TEXT NOT NULL,
  principal     TEXT,
  allowed       INTEGER NOT NULL,
  reason        TEXT,
  sql_digest    TEXT,
  occurred_at   TEXT NOT NULL,
  document      TEXT NOT NULL,
  PRIMARY KEY (tenant_id, event_id)
);
CREATE INDEX idx_data_service_audit_source ON data_service_audit(tenant_id, source_id, occurred_at);
