-- DKC-012, version 6: bindende modelgateway-budgetter og afregning.
--
-- Migrationen er additiv og bagudkompatibel:
--
--   * budgets får `reserved_*`-kolonner, så en reservation kan holdes mens et
--     modelkald er i gang. Et loft kontrolleres mod `tokens + reserved_tokens`,
--     så to samtidige kald ikke kan bruge den samme resterende budgetpost.
--   * budget_reservations er den holdbare reservationslog. En reservation er
--     `held`, indtil kaldet `settled` (faktisk forbrug) eller `released`
--     (timeout/afbrudt/fejl). `settle` bogfører det faktiske forbrug og frigiver
--     kun forskellen mellem reservation og faktisk brug.
--   * gateway_calls giver idempotens pr. (tenant, idempotency-key) og holder
--     den afregnede kvittering. Rå modeltekst gemmes kun for dataklasser uden
--     personhenførbare data; ellers gemmes metadata + digest.

ALTER TABLE budgets ADD COLUMN reserved_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE budgets ADD COLUMN reserved_cost_eur REAL NOT NULL DEFAULT 0;
ALTER TABLE budgets ADD COLUMN ceiling_cost_eur REAL;

CREATE TABLE budget_reservations (
  reservation_id   TEXT PRIMARY KEY,
  tenant_id        TEXT NOT NULL,
  budget_key       TEXT NOT NULL,
  tokens           INTEGER NOT NULL DEFAULT 0,
  cost_eur         REAL NOT NULL DEFAULT 0,
  state            TEXT NOT NULL DEFAULT 'held' CHECK (state IN ('held', 'settled', 'released')),
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  settled_tokens   INTEGER NOT NULL DEFAULT 0,
  settled_cost_eur REAL NOT NULL DEFAULT 0,
  idempotency_key  TEXT
);
CREATE INDEX idx_budget_reservations_tenant ON budget_reservations(tenant_id, budget_key, state);

CREATE TABLE gateway_calls (
  tenant_id       TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_digest  TEXT NOT NULL,
  state           TEXT NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved', 'settled', 'released')),
  route_id        TEXT,
  provider        TEXT,
  model           TEXT,
  model_version   TEXT,
  data_class      TEXT,
  tokens          INTEGER NOT NULL DEFAULT 0,
  cost_eur        REAL NOT NULL DEFAULT 0,
  reservation_id  TEXT,
  response        TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  PRIMARY KEY (tenant_id, idempotency_key)
);
CREATE INDEX idx_gateway_calls_state ON gateway_calls(tenant_id, state);
