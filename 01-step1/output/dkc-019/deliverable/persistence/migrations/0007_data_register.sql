-- DKC-019, version 7: versioneret dataregister, retention og holds.
--
-- Migrationen er additiv og bagudkompatibel. Den giver registeret et holdbart
-- hjem pr. tenant:
--
--   * data_register_versions er den versionerede registerfil. Hver version har
--     en SHA-256-digest, så en ændring af registeret er sporbart.
--   * data_register_entries holder den normaliserede post (ejer, status,
--     behandlingsgrundlag, blocker-antal), så en persondatapost uden
--     ejerbeslutning/aftale kan findes uden at parse hele dokumentet.
--   * data_register_subprocessors og data_register_retention holder aftaler og
--     formålsbestemte slettefrister hver for sig.
--   * data_register_holds er et aktivt slette-stop. Et hold blokerer sletning,
--     indtil det frigives af et navngivet menneske.

CREATE TABLE data_register_versions (
  version_id        TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL,
  register_name     TEXT NOT NULL,
  register_version  TEXT NOT NULL,
  digest            TEXT NOT NULL,
  document          TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  created_by        TEXT,
  approved_at       TEXT,
  approved_by       TEXT
);
CREATE INDEX idx_data_register_versions_tenant ON data_register_versions(tenant_id, register_name, created_at);

CREATE TABLE data_register_entries (
  tenant_id          TEXT NOT NULL,
  entry_id           TEXT NOT NULL,
  register_version   TEXT NOT NULL,
  status             TEXT NOT NULL CHECK (status IN ('approved', 'pending-owner-decision', 'blocked')),
  owner_subject      TEXT NOT NULL,
  owner_name         TEXT NOT NULL,
  module_ref         TEXT,
  route_ref          TEXT,
  personal           INTEGER NOT NULL DEFAULT 0,
  legal_basis_status TEXT NOT NULL,
  legal_basis_ground TEXT,
  has_contract       INTEGER NOT NULL DEFAULT 0,
  transfer_assessed  INTEGER NOT NULL DEFAULT 0,
  blocker_count      INTEGER NOT NULL DEFAULT 0,
  document           TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  PRIMARY KEY (tenant_id, entry_id)
);
CREATE INDEX idx_data_register_entries_tenant ON data_register_entries(tenant_id, status);

CREATE TABLE data_register_subprocessors (
  tenant_id             TEXT NOT NULL,
  subprocessor_id       TEXT NOT NULL,
  name                  TEXT NOT NULL,
  hosting_region        TEXT NOT NULL,
  dpa_ref               TEXT NOT NULL,
  contract_ref          TEXT NOT NULL,
  third_country_status  TEXT NOT NULL,
  document              TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  PRIMARY KEY (tenant_id, subprocessor_id)
);

CREATE TABLE data_register_retention (
  tenant_id             TEXT NOT NULL,
  entry_id              TEXT NOT NULL,
  policy_id             TEXT NOT NULL,
  version               TEXT NOT NULL,
  purpose_ref           TEXT NOT NULL,
  max_days              INTEGER NOT NULL,
  trigger               TEXT NOT NULL,
  legal_hold_supported  INTEGER NOT NULL DEFAULT 0,
  approved_by           TEXT NOT NULL,
  approved_at           TEXT NOT NULL,
  document              TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  PRIMARY KEY (tenant_id, entry_id)
);

CREATE TABLE data_register_holds (
  hold_id      TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  entry_id     TEXT NOT NULL,
  reason       TEXT NOT NULL,
  placed_by    TEXT NOT NULL,
  placed_at    TEXT NOT NULL,
  released_at  TEXT,
  released_by  TEXT,
  document     TEXT NOT NULL
);
CREATE INDEX idx_data_register_holds_tenant ON data_register_holds(tenant_id, entry_id, released_at);
