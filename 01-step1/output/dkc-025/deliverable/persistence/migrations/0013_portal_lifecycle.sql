-- DKC-025, version 13: kundeportal og kundelivscyklus.
--
-- Migrationen er additiv og bagudkompatibel. Den giver portalens livscyklus et
-- holdbart, tenant-bundet hjem:
--
--   * `portal_customers` er kundens aktuelle tilstand (oprettet, aktiv,
--     suspenderet, under afvikling, lukket) med den bestilte servicepakke.
--   * `portal_orders` er en bestilling af en versioneret servicepakke med det
--     serverberegnede pris-/konsekvenspreview, den godkendte ændring og
--     godkenderen.
--   * `portal_provision_steps` er de deterministiske provisioneringstrin. Hvert
--     trin bærer en **unik idempotency-key** og en deterministisk ressource-ID,
--     så et delvist fejlet forløb kan genoptages uden dobbeltressourcer.
--   * `portal_audit_events` er det append-only, hash-kædede revisionsspor.
--
-- Alle tabeller bærer `tenant_id`, så tenant-viewet i db.mjs afgrænser dem.

CREATE TABLE portal_customers (
  tenant_id       TEXT PRIMARY KEY,
  customer_id     TEXT NOT NULL,
  name            TEXT NOT NULL,
  state           TEXT NOT NULL CHECK (state IN ('created', 'active', 'suspended', 'winding-down', 'closed')),
  package_id      TEXT,
  package_version TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  document        TEXT NOT NULL
);
CREATE INDEX idx_portal_customers_state ON portal_customers(tenant_id, state);

CREATE TABLE portal_orders (
  order_id        TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL,
  package_id      TEXT NOT NULL,
  package_version TEXT NOT NULL,
  state           TEXT NOT NULL CHECK (state IN ('requested', 'approved', 'provisioning', 'active', 'partial', 'suspended', 'winding-down', 'closed')),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  document        TEXT NOT NULL
);
CREATE INDEX idx_portal_orders_tenant ON portal_orders(tenant_id, state);

CREATE TABLE portal_provision_steps (
  order_id        TEXT NOT NULL,
  step_id         TEXT NOT NULL,
  tenant_id       TEXT NOT NULL,
  module_id       TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  resource_ref    TEXT NOT NULL,
  state           TEXT NOT NULL CHECK (state IN ('pending', 'succeeded', 'failed', 'reused', 'skipped')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  error           TEXT,
  updated_at      TEXT,
  document        TEXT NOT NULL,
  PRIMARY KEY (order_id, step_id)
);
CREATE UNIQUE INDEX idx_portal_steps_idempotency ON portal_provision_steps(tenant_id, idempotency_key);
CREATE INDEX idx_portal_steps_order ON portal_provision_steps(tenant_id, order_id);

CREATE TABLE portal_audit_events (
  tenant_id  TEXT NOT NULL,
  seq        INTEGER NOT NULL,
  at         TEXT NOT NULL,
  type       TEXT NOT NULL,
  actor      TEXT,
  from_state TEXT,
  to_state   TEXT,
  detail     TEXT,
  prev_hash  TEXT,
  hash       TEXT NOT NULL,
  document   TEXT NOT NULL,
  PRIMARY KEY (tenant_id, seq)
);
CREATE INDEX idx_portal_audit_tenant ON portal_audit_events(tenant_id, seq);
