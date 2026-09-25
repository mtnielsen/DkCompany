-- DKC-008, version 2: opgradering fra v1.
--
-- Migrationen er additiv og bagudkompatibel: eksisterende rækker bevares, og de
-- nye kolonner får sikre defaults. Den demonstrerer det dokumenterede
-- opgraderingsforløb (v1 → v2) og er den slags schemaændring en fremtidig
-- version vil bruge.
--
--   * jobs: prioritet + heartbeat, så en død worker kan opdages og jobbet
--     genoptages uden at ændre de eksisterende kolonner.
--   * audit_events: trace_id, så audit kan korreleres med telemetri.
--   * budgets: et hårdt loft, hvis det er sat.
--   * approval_requests: eksplicit consumption-markør uden at røre `data`.

ALTER TABLE jobs ADD COLUMN priority INTEGER NOT NULL DEFAULT 100;
ALTER TABLE jobs ADD COLUMN heartbeat_at TEXT;
CREATE INDEX idx_jobs_lease ON jobs(status, leased_at);

ALTER TABLE audit_events ADD COLUMN trace_id TEXT;

ALTER TABLE budgets ADD COLUMN ceiling_tokens INTEGER;

ALTER TABLE approval_requests ADD COLUMN consumed_at TEXT;
