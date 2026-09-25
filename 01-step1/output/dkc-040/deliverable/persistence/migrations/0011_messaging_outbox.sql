-- DKC-040, version 11: holdbar beskedudveksling på tværs af servere.
--
-- Migrationen er additiv og bagudkompatibel. Den tilføjer de fire tabeller som
-- bærer den transaktionelle udveksling mellem tjenester:
--
--   * `event_outbox`      — begivenheder skrives i SAMME transaktion som den
--                           forretningsmæssige ændring. En begivenhed kan derfor
--                           hverken mangle (ændringen skete) eller overleve alene
--                           (ændringen blev rullet tilbage). Kolonnen
--                           `lease_token` er et monotonisk fencing-token, så en
--                           gammel udgiver ikke kan bekræfte en begivenhed den
--                           har mistet retten til.
--   * `event_inbox`       — forbrugerens dedup- og ack-spor. (tenant, consumer,
--                           event) er unik, så en genleveret begivenhed ikke kan
--                           give en dobbelt sideeffekt. Rækken skrives FØR
--                           sideeffekten (`received`), så et nedbrud mellem
--                           sideeffekt og ack efterlader et sporbart `received`
--                           som kan reconcileres i stedet for blindt genudføres.
--   * `resource_versions` — logisk rækkefølge pr. ressource. En forsinket
--                           (stale) begivenhed afvises, og et hul i
--                           versionsrækken udsætter behandlingen i stedet for at
--                           anvende begivenheder i den forkerte rækkefølge.
--   * `singleton_leases`  — lease med monotonisk `fencing_token` for
--                           singletonjobs. En gammel worker med et lavere token
--                           kan ikke fortsætte efter at en ny har overtaget.
--
-- `event_dead_letters` isolerer poison-beskeder pr. tenant/consumer, så én
-- kundes ødelagte begivenhed ikke blokerer de øvrige.

-- 1) Transaktionel outbox.
CREATE TABLE event_outbox (
  tenant_id          TEXT    NOT NULL,
  event_id           TEXT    NOT NULL,
  event_type         TEXT    NOT NULL,
  source             TEXT    NOT NULL,
  subject            TEXT,
  resource_type      TEXT    NOT NULL,
  resource_id        TEXT    NOT NULL,
  resource_version   INTEGER NOT NULL DEFAULT 0,
  payload            TEXT    NOT NULL,
  dataclassification TEXT,
  trace_id           TEXT,
  idempotency_key    TEXT,
  status             TEXT    NOT NULL DEFAULT 'pending',   -- pending | confirmed | failed
  attempts           INTEGER NOT NULL DEFAULT 0,
  next_attempt_at    TEXT,
  claimed_by         TEXT,
  claimed_at         TEXT,
  lease_token        INTEGER NOT NULL DEFAULT 0,
  lease_until        TEXT,
  confirmed_at       TEXT,
  last_error         TEXT,
  created_at         TEXT    NOT NULL,
  updated_at         TEXT    NOT NULL,
  PRIMARY KEY (tenant_id, event_id)
);
-- Samme logiske begivenhed leveret to gange må ikke skrive to rækker.
CREATE UNIQUE INDEX idx_event_outbox_idempotency ON event_outbox(tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_event_outbox_due ON event_outbox(tenant_id, status, next_attempt_at);

-- 2) Forbrugerens dedup- og ack-spor.
CREATE TABLE event_inbox (
  tenant_id        TEXT    NOT NULL,
  consumer         TEXT    NOT NULL,
  event_id         TEXT    NOT NULL,
  event_type       TEXT    NOT NULL,
  resource_type    TEXT    NOT NULL,
  resource_id      TEXT    NOT NULL,
  resource_version INTEGER NOT NULL DEFAULT 0,
  payload_digest   TEXT    NOT NULL,
  status           TEXT    NOT NULL DEFAULT 'received',    -- received | processing | processed | skipped | failed | dead-letter
  received_at      TEXT    NOT NULL,
  processed_at     TEXT,
  attempts         INTEGER NOT NULL DEFAULT 0,
  last_error       TEXT,
  PRIMARY KEY (tenant_id, consumer, event_id)
);
CREATE INDEX idx_event_inbox_status ON event_inbox(tenant_id, consumer, status);

-- 3) Logisk rækkefølge pr. ressource.
CREATE TABLE resource_versions (
  tenant_id     TEXT    NOT NULL,
  resource_type TEXT    NOT NULL,
  resource_id   TEXT    NOT NULL,
  version       INTEGER NOT NULL DEFAULT 0,
  last_event_id TEXT,
  updated_at    TEXT    NOT NULL,
  PRIMARY KEY (tenant_id, resource_type, resource_id)
);

-- 4) Singleton-leases med fencing-token.
CREATE TABLE singleton_leases (
  tenant_id     TEXT    NOT NULL,
  name          TEXT    NOT NULL,
  holder        TEXT,
  fencing_token INTEGER NOT NULL DEFAULT 0,
  lease_until   TEXT,
  heartbeat_at  TEXT,
  acquired_at   TEXT,
  updated_at    TEXT    NOT NULL,
  PRIMARY KEY (tenant_id, name)
);

-- 5) Poison-isolation pr. tenant/consumer.
CREATE TABLE event_dead_letters (
  tenant_id   TEXT    NOT NULL,
  consumer    TEXT    NOT NULL,
  event_id    TEXT    NOT NULL,
  reason      TEXT    NOT NULL,
  attempts    INTEGER NOT NULL,
  payload     TEXT    NOT NULL,
  created_at  TEXT    NOT NULL,
  redriven_at TEXT,
  PRIMARY KEY (tenant_id, consumer, event_id)
);
CREATE INDEX idx_event_dead_letters_created ON event_dead_letters(tenant_id, consumer, created_at);
