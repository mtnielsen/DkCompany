-- DKC-008, version 1: baseline-skema for holdbar tilstand.
--
-- Alle tabeller er tenant-scoped: tenant_id er en del af den primære nøgle, så
-- identiske lokale id'er hos to kunder hverken kolliderer eller kan overskrive
-- hinanden. `data`/`payload` er kanonisk JSON; opslagsfelter (state, status)
-- ligger som kolonner, så de kan indekseres og låses transaktionelt.

-- Godkendelsesanmodninger. `data` er hele den serverstyrede anmodning.
CREATE TABLE approval_requests (
  tenant_id  TEXT    NOT NULL,
  id         TEXT    NOT NULL,
  state      TEXT    NOT NULL,
  data       TEXT    NOT NULL,
  revision   INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT    NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX idx_approval_requests_state ON approval_requests(tenant_id, state);

-- Atomisk reservation (claim) af en godkendelse, så to workers ikke kan
-- eksekvere samme godkendte ændring.
CREATE TABLE approval_claims (
  tenant_id    TEXT NOT NULL,
  approval_id  TEXT NOT NULL,
  execution_id TEXT,
  data         TEXT NOT NULL,
  claimed_at   TEXT NOT NULL,
  PRIMARY KEY (tenant_id, approval_id)
);

-- Baggrundsjobs. `leased_by`/`leased_at` gør det muligt at genoptage efter et
-- procesnedbrud: en lease der er ældre end heartbeat-grænsen kan requeues.
CREATE TABLE jobs (
  tenant_id   TEXT    NOT NULL,
  id          TEXT    NOT NULL,
  kind        TEXT    NOT NULL,
  payload     TEXT    NOT NULL DEFAULT 'null',
  status      TEXT    NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  leased_by   TEXT,
  leased_at   TEXT,
  enqueued_at TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL,
  result      TEXT,
  error       TEXT,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX idx_jobs_status ON jobs(tenant_id, status);

-- Budgetkonti pr. tenant/agent. Tællere opdateres atomisk.
CREATE TABLE budgets (
  tenant_id  TEXT    NOT NULL,
  budget_key TEXT    NOT NULL,
  tokens     INTEGER NOT NULL DEFAULT 0,
  cost_eur   REAL    NOT NULL DEFAULT 0,
  calls      INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT    NOT NULL,
  PRIMARY KEY (tenant_id, budget_key)
);

-- Append-only audit-log med hash-kæde pr. tenant. En ændring af en gammel
-- post bryder kæden fra det punkt og frem.
CREATE TABLE audit_events (
  seq       INTEGER PRIMARY KEY AUTOINCREMENT,
  id        TEXT    NOT NULL,
  tenant_id TEXT,
  at        TEXT    NOT NULL,
  type      TEXT    NOT NULL,
  verb      TEXT,
  actor     TEXT,
  payload   TEXT    NOT NULL DEFAULT '{}',
  prev_hash TEXT    NOT NULL,
  hash      TEXT    NOT NULL,
  UNIQUE (tenant_id, id)
);
CREATE INDEX idx_audit_events_tenant ON audit_events(tenant_id, seq);

-- Beskyttet beslutningslog for godkendelser (DKC-004's ledger, nu i databasen).
-- Samme hash-kæde pr. tenant; `hash` kan være HMAC hvis der er sat en nøgle.
CREATE TABLE approval_ledger (
  seq            INTEGER PRIMARY KEY AUTOINCREMENT,
  id             TEXT NOT NULL,
  type           TEXT NOT NULL,
  at             TEXT NOT NULL,
  tenant_id      TEXT,
  state          TEXT,
  binding_digest TEXT,
  actor          TEXT,
  detail         TEXT,
  prev_hash      TEXT NOT NULL,
  hash           TEXT NOT NULL
);
CREATE INDEX idx_approval_ledger_tenant ON approval_ledger(tenant_id, seq);
