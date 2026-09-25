-- DKC-009, version 3: holdbar audit med intent/outcome, idempotens og
-- adskilt personal-data-retention.
--
-- Migrationen er additiv og bagudkompatibel. `ALTER TABLE ... ADD COLUMN` uden
-- NOT NULL og uden DEFAULT giver NULL for eksisterende rækker, og
-- hash-kæden i `createSqliteAuditLog` udelader de nye felter når de er NULL, så
-- en tidligere skrevet kæde forbliver gyldig efter opgraderingen.
--
-- Formålet er at audit-sporet dokumenterer FORSØGET før en ekstern ændring og
-- RESULTATET bagefter. `audit_intents` er den vedvarende kvittering; den skrives
-- og committes før nogen executor kaldes. `audit_events.phase` binder
-- intent-/outcome-begivenhederne til den samme idempotency_id.

-- 1) Intent/outcome-felter på den hash-kædede begivenhedslog.
ALTER TABLE audit_events ADD COLUMN idempotency_id TEXT;
ALTER TABLE audit_events ADD COLUMN intent_id TEXT;
ALTER TABLE audit_events ADD COLUMN phase TEXT;
ALTER TABLE audit_events ADD COLUMN outcome TEXT;
ALTER TABLE audit_events ADD COLUMN retention_class TEXT;
ALTER TABLE audit_events ADD COLUMN payload_digest TEXT;
ALTER TABLE audit_events ADD COLUMN personal_data_digest TEXT;
CREATE INDEX idx_audit_events_idempotency ON audit_events(tenant_id, idempotency_id);

-- 2) Handlingsintents. Primærnøglen (tenant_id, idempotency_id) er selve
-- idempotens-mekanismen: en gentaget task kan ikke oprette endnu et intent og
-- dermed ikke udløse en ny, ukritisk eksekvering. `state` er 'pending' fra
-- intentet committes, og bliver 'succeeded'/'failed'/'unknown' bagefter.
CREATE TABLE audit_intents (
  tenant_id       TEXT    NOT NULL,
  idempotency_id  TEXT    NOT NULL,
  intent_id       TEXT    NOT NULL,
  verb            TEXT    NOT NULL,
  target          TEXT    NOT NULL,
  environment     TEXT,
  actor           TEXT,
  request_digest  TEXT    NOT NULL,
  state           TEXT    NOT NULL,          -- pending | succeeded | failed | unknown
  created_at      TEXT    NOT NULL,
  updated_at      TEXT    NOT NULL,
  outcome_at      TEXT,
  attempts        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, idempotency_id)
);
CREATE INDEX idx_audit_intents_state ON audit_intents(tenant_id, state);
CREATE UNIQUE INDEX idx_audit_intents_intent ON audit_intents(intent_id);

-- 3) Personhenførbare payloads holdes uden for hash-kæden. Kun digesten af
-- persondata indgår i den kædede begivenhed, så en sletning/udløb af
-- persondata kan ske uden at brække kæden. `retain_until` styrer retention
-- separat fra de operationelle begivenheder.
CREATE TABLE audit_personal (
  tenant_id    TEXT NOT NULL,
  digest       TEXT NOT NULL,
  subject_key  TEXT,
  categories   TEXT NOT NULL DEFAULT '[]',
  payload      TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  retain_until TEXT,
  erased_at    TEXT,
  PRIMARY KEY (tenant_id, digest)
);
CREATE INDEX idx_audit_personal_retention ON audit_personal(tenant_id, retain_until);
