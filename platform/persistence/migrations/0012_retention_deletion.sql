-- DKC-021, version 12: sletning, legal hold og gendannelsesregler.
--
-- Migrationen er additiv og bagudkompatibel. Den giver slette- og
-- tilbageholdsprocessen et holdbart hjem pr. tenant:
--
--   * `retention_holds` er et begrundet, godkendt slette-stop. Rækken bærer
--     subjektets digest (ikke rå identifikatorer), de dækkede dataklasser, den
--     der lagde holdet, og den **separate** godkender. Et aktivt hold blokerer
--     enhver sletning i sin scope, indtil det frigives.
--   * `retention_deletion_receipts` er beviset for et sletteforsøg: status,
--     per-flade resultat, resterende kopier med begrundelse og udløb samt
--     revisionsreferencerne. Kvitteringen bærer kun subjektets digest.
--   * `retention_restore_gates` holder et gendannet miljø i karantæne indtil
--     slettebeslutninger er genanvendt. Den pinner suppressionsjournalens hoved,
--     så en trunkeret journal og en efterfølgende sletning opdages før frigivelse.
--
-- Alle tabeller bærer `tenant_id`, så tenant-viewet i db.mjs afgrænser dem.

CREATE TABLE retention_holds (
  hold_id         TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL,
  subject_digest  TEXT NOT NULL,
  data_classes    TEXT NOT NULL,   -- JSON-array
  module_ref      TEXT,
  reason          TEXT NOT NULL,
  placed_by       TEXT NOT NULL,   -- JSON { subject, name, role }
  approved_by     TEXT NOT NULL,   -- JSON { subject, name, role }
  placed_at       TEXT NOT NULL,
  review_at       TEXT,
  status          TEXT NOT NULL CHECK (status IN ('active', 'released')),
  released_by     TEXT,            -- JSON { subject, name, role }
  release_reason  TEXT,
  released_at     TEXT,
  document        TEXT NOT NULL
);
CREATE INDEX idx_retention_holds_tenant ON retention_holds(tenant_id, subject_digest, status);
CREATE INDEX idx_retention_holds_active ON retention_holds(tenant_id, status);

CREATE TABLE retention_deletion_receipts (
  receipt_id       TEXT PRIMARY KEY,
  tenant_id        TEXT NOT NULL,
  subject_digest   TEXT NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('full', 'partial', 'unsupported', 'blocked-by-hold')),
  requested_by     TEXT NOT NULL,
  requested_at     TEXT NOT NULL,
  completed_at     TEXT NOT NULL,
  records_affected INTEGER NOT NULL DEFAULT 0,
  remaining_copies INTEGER NOT NULL DEFAULT 0,
  intent_id        TEXT,
  outcome_id       TEXT,
  document         TEXT NOT NULL
);
CREATE INDEX idx_retention_receipts_tenant ON retention_deletion_receipts(tenant_id, requested_at);

CREATE TABLE retention_restore_gates (
  gate_id             TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL,
  restore_point       TEXT NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('quarantined', 'decisions-applied', 'released')),
  pinned_ledger_head  TEXT,
  applied_ledger_head TEXT,
  applied_entries     INTEGER NOT NULL DEFAULT 0,
  records_erased      INTEGER NOT NULL DEFAULT 0,
  opened_at           TEXT NOT NULL,
  applied_at          TEXT,
  released_at         TEXT,
  released_by         TEXT,
  document            TEXT NOT NULL
);
CREATE INDEX idx_retention_gates_tenant ON retention_restore_gates(tenant_id, status);
