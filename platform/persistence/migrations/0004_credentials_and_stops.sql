-- DKC-010, version 4: holdbare rettigheder, tilbagekaldelser og nødstop.
--
-- Rettigheder er kortlivede og scope-bundne. For at kunne afvise et tilbagekaldt
-- token og et aktivt nødstop på tværs af processer/noder skal både
-- udstedelsesjournalen, tilbagekaldelseslisten og nødstop-tilstanden være
-- holdbare. Tabellerne er additive og påvirker ikke det eksisterende skema.

-- Udstedte credentials (jti er den unikke nøgle). Bruges til audit,
-- reconciliation og til at se hvilket scope et token faktisk fik.
CREATE TABLE credential_issuances (
  jti         TEXT PRIMARY KEY,
  tenant_id   TEXT,
  spiffe_id   TEXT NOT NULL,
  agent_ref   TEXT,
  role        TEXT,
  verb        TEXT,
  resource    TEXT,
  audience    TEXT,
  environment TEXT,
  issued_at   TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);
CREATE INDEX idx_credential_issuances_tenant ON credential_issuances(tenant_id, spiffe_id);

-- Tilbagekaldelser på tre niveauer: credential (jti), agent (spiffe_id) og
-- tenant. `key` er normaliseret som 'jti:<id>', 'agent:<id>' eller 'tenant:<id>'.
CREATE TABLE revocations (
  key        TEXT PRIMARY KEY,
  scope      TEXT NOT NULL,
  jti        TEXT,
  spiffe_id  TEXT,
  tenant_id  TEXT,
  reason     TEXT,
  revoked_by TEXT,
  revoked_at TEXT NOT NULL,
  expires_at TEXT
);
CREATE INDEX idx_revocations_scope ON revocations(scope, tenant_id, spiffe_id);

-- Nødstop pr. agent, pr. kunde og globalt. `subject_id` er '*' for globalt.
CREATE TABLE kill_switches (
  scope        TEXT NOT NULL,
  subject_id   TEXT NOT NULL DEFAULT '*',
  active       INTEGER NOT NULL DEFAULT 0,
  reason       TEXT,
  activated_by TEXT,
  activated_at TEXT,
  cleared_by   TEXT,
  cleared_at   TEXT,
  PRIMARY KEY (scope, subject_id)
);
