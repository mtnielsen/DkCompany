-- DKC-020, version 10: holdbar DSAR-sag med per-modul status og sikret eksport.
--
-- En DSAR er en langvarig, autoriseret proces der fan-out'er til flere apps.
-- Uden holdbar tilstand ville et genstart eller en timeout kunne give et
-- ufuldstændigt aggregat, og en eksport ville ikke kunne bindes til en
-- modtager, en udløbstid og et revisionsspor. Migrationen er additiv:
--
--   * `dsar_cases` holder selve sagen, den autoriserede sagsbehandler,
--     deadline og idempotency-key pr. tenant. `response` er den seneste
--     `PrivacySubjectResponse`, så en genoptaget kørsel ikke gentager
--     allerede afsluttede moduler.
--   * `dsar_module_results` holder per-modul status (found/partial/
--     unsupported/failed/unknown) med begrundelse eller fejl og en evt.
--     artefaktreference. Rækkerne er den genoptagelige arbejdsenhed.
--   * `dsar_exports` holder en sikret eksport: modtager, udløb, digest og
--     revisionsreference. Selve payloaden ligger i artefaktet, ikke i
--     registeret, så registeret ikke bliver et nyt personregister.
--
-- Alle tabeller bærer `tenant_id`, så tenant-viewet i db.mjs afgrænser dem.

CREATE TABLE dsar_cases (
  tenant_id           TEXT NOT NULL,
  case_id             TEXT NOT NULL,
  verb                TEXT NOT NULL,
  subject_identifiers TEXT NOT NULL,   -- JSON-array
  requested_by        TEXT NOT NULL,   -- JSON-objekt
  caseworker          TEXT NOT NULL,   -- JSON-objekt { subject, name, role }
  status              TEXT NOT NULL CHECK (status IN ('open', 'running', 'partially-completed', 'completed', 'failed')),
  legal_basis         TEXT,
  deadline            TEXT,
  idempotency_key     TEXT,
  response            TEXT,            -- JSON (PrivacySubjectResponse) eller NULL
  export_id           TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  completed_at        TEXT,
  PRIMARY KEY (tenant_id, case_id)
);

CREATE UNIQUE INDEX idx_dsar_cases_idempotency ON dsar_cases(tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_dsar_cases_status ON dsar_cases(tenant_id, status, created_at);

CREATE TABLE dsar_module_results (
  tenant_id        TEXT NOT NULL,
  case_id          TEXT NOT NULL,
  module           TEXT NOT NULL,
  module_version   TEXT,
  verb             TEXT NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('full', 'found', 'partial', 'unsupported', 'failed', 'unknown')),
  records_affected INTEGER,
  matched          INTEGER,
  reason           TEXT,
  error            TEXT,
  artifact_ref     TEXT,
  artifact_sha256  TEXT,
  duration_ms      INTEGER,
  updated_at       TEXT NOT NULL,
  PRIMARY KEY (tenant_id, case_id, module)
);

CREATE INDEX idx_dsar_module_results_status ON dsar_module_results(tenant_id, case_id, status);

CREATE TABLE dsar_exports (
  tenant_id    TEXT NOT NULL,
  export_id    TEXT NOT NULL,
  case_id      TEXT NOT NULL,
  verb         TEXT NOT NULL,
  recipient    TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('active', 'redeemed', 'revoked', 'expired')),
  record_count INTEGER NOT NULL,
  artifact     TEXT NOT NULL,   -- JSON { uri, sha256, bytes }
  audit_ref    TEXT,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  redeemed_at  TEXT,
  revoked_at   TEXT,
  PRIMARY KEY (tenant_id, export_id)
);

CREATE INDEX idx_dsar_exports_case ON dsar_exports(tenant_id, case_id);
CREATE INDEX idx_dsar_exports_expiry ON dsar_exports(status, expires_at);
