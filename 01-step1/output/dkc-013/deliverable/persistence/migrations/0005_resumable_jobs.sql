-- DKC-013, version 5: genoptagelige, idempotente jobs.
--
-- Migrationen er additiv og bagudkompatibel. De nye kolonner på `jobs` har
-- defaults, så eksisterende rækker (og DKC-008's simple jobstore) forbliver
-- gyldige. DKC-013's jobkø lægger en eksplicit tilstandsmaskine, leases med
-- fencing-token, idempotency-keys, begrænsede forsøg og en dead-letter-kø
-- ovenpå de samme rækker.
--
-- `job_attempts` er det sporbare forsøgs-spor: hvert lease/eksekveringsforsøg
-- får en række med start/slut, udfald, fejl, policy-version og approval-ID.
-- Dermed kan et genstartet job vise præcis hvad der skete undervejs.
-- `job_dead_letters` fastholder de jobs der ikke må gentages automatisk.

-- 1) Nye felter på jobrækken.
ALTER TABLE jobs ADD COLUMN classification TEXT;
ALTER TABLE jobs ADD COLUMN idempotency_key TEXT;
ALTER TABLE jobs ADD COLUMN max_attempts INTEGER NOT NULL DEFAULT 3;
ALTER TABLE jobs ADD COLUMN next_attempt_at TEXT;
ALTER TABLE jobs ADD COLUMN lease_token INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN lease_until TEXT;
ALTER TABLE jobs ADD COLUMN dead_letter_at TEXT;
ALTER TABLE jobs ADD COLUMN dead_letter_reason TEXT;
ALTER TABLE jobs ADD COLUMN parent_id TEXT;
ALTER TABLE jobs ADD COLUMN compensation_for TEXT;

-- Idempotency-key er unik pr. tenant. Samme logiske job leveret to gange kan
-- derfor ikke oprette to rækker og dermed ikke udføre en irreversibel ændring
-- to gange.
CREATE UNIQUE INDEX idx_jobs_idempotency ON jobs(tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_jobs_due ON jobs(tenant_id, status, next_attempt_at);

-- 2) Sporbart forsøgs-spor.
CREATE TABLE job_attempts (
  tenant_id           TEXT    NOT NULL,
  job_id              TEXT    NOT NULL,
  attempt             INTEGER NOT NULL,
  classification      TEXT,
  state               TEXT    NOT NULL,   -- leasing | running | succeeded | failed | unknown | retry-scheduled | dead-letter
  lease_token         INTEGER,
  started_at          TEXT    NOT NULL,
  finished_at         TEXT,
  outcome             TEXT,
  error               TEXT,
  policy_bundle_version TEXT,
  approval_id         TEXT,
  execution_id        TEXT,
  PRIMARY KEY (tenant_id, job_id, attempt)
);
CREATE INDEX idx_job_attempts_state ON job_attempts(tenant_id, state);

-- 3) Dead-letter-kø. Et job der ikke må gentages automatisk gemmes her sammen
-- med den fulde jobrække, så en operatør kan inspicere og genindlæse det.
CREATE TABLE job_dead_letters (
  tenant_id   TEXT    NOT NULL,
  job_id      TEXT    NOT NULL,
  classification TEXT,
  reason      TEXT    NOT NULL,
  attempts    INTEGER NOT NULL,
  job         TEXT    NOT NULL,
  created_at  TEXT    NOT NULL,
  redriven_at TEXT,
  PRIMARY KEY (tenant_id, job_id)
);
CREATE INDEX idx_job_dead_letters_created ON job_dead_letters(tenant_id, created_at);
