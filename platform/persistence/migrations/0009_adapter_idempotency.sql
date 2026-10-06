-- DKC-023, version 9: holdbar idempotens for adapterverber.
--
-- Den fælles adapter-SDK lover, at et verbum med en idempotency-key ikke kan
-- udføre en irreversibel ændring to gange, selv hvis klienten gentager kaldet
-- eller to replikaer modtager samme kald. Løftet kræver holdbar tilstand:
--
--   * `adapter_idempotency` holder `(tenant, scope, idempotency_key)` med
--     request-digest, tilstand og den gemte kvittering.
--   * Tabellen bærer `tenant_id`, så tenant-viewet i db.mjs afgrænser den.
--
-- Rå svar gemmes kun, når verbet er klassificeret som ikke-personhenførbart.
-- SDK'en gemmer ellers alene digest + metadata, så idempotens-loggen ikke i sig
-- selv bliver et personregister.

CREATE TABLE adapter_idempotency (
  tenant_id       TEXT NOT NULL,
  scope           TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_digest  TEXT NOT NULL,
  state           TEXT NOT NULL CHECK (state IN ('in-progress', 'completed', 'failed')),
  response        TEXT,
  error           TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  PRIMARY KEY (tenant_id, scope, idempotency_key)
);

CREATE INDEX idx_adapter_idempotency_updated ON adapter_idempotency(updated_at);
