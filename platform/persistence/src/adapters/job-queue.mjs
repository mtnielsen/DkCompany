/**
 * DKC-013 — holdbar jobkø med tilstandsmaskine, leases, idempotency-keys,
 * begrænsede forsøg og dead-letter.
 *
 * Adapteren er den vedvarende kerne under `jobs/`. Den deler `jobs`-tabellen
 * med DKC-008's simple jobstore (migration v5 tilføjede de nødvendige kolonner),
 * men lægger en eksplicit protokol ovenpå:
 *
 *   - `submit()` dedupliker på `idempotency_key`, så samme logiske job leveret
 *     to gange ikke kan udføre en irreversibel ændring to gange,
 *   - `lease()` tager en `BEGIN IMMEDIATE`-lås og hæver et fencing-token
 *     (`lease_token`), så en gammel worker ikke kan afslutte et job den har
 *     mistet,
 *   - `startAttempt()`/`finishAttempt()` skriver et sporbart forsøgs-spor,
 *   - `scheduleRetry()` udsætter et nyt forsøg med backoff,
 *   - `deadLetter()` flytter et job der ikke må gentages til en dead-letter-kø,
 *   - `recoverStaleLeases()` genåbner leases fra en død worker.
 */
import { randomUUID } from "node:crypto";
import { normalizeTenantId } from "../../../identity/src/tenant.mjs";

const OPEN_STATES = ["leased", "running"];

function iso(ms) {
  return new Date(ms).toISOString();
}

export function createSqliteJobQueue({ db, clock = () => Date.now(), kind = "sqlite-job-queue" } = {}) {
  if (!db) throw new Error("createSqliteJobQueue kræver en database");

  const insertStmt = db.prepare(`INSERT OR IGNORE INTO jobs(
      tenant_id, id, kind, payload, status, attempts, enqueued_at, updated_at, priority,
      classification, idempotency_key, max_attempts, next_attempt_at, lease_token, parent_id, compensation_for)
    VALUES (?, ?, ?, ?, 'queued', 0, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`);
  const getStmt = db.prepare("SELECT * FROM jobs WHERE tenant_id = ? AND id = ?");
  const getIdemStmt = db.prepare("SELECT * FROM jobs WHERE tenant_id = ? AND idempotency_key = ?");
  const listStmt = db.prepare("SELECT * FROM jobs WHERE tenant_id = ? ORDER BY enqueued_at, id");
  const dueStmt = db.prepare(`SELECT id FROM jobs WHERE tenant_id = ? AND status IN ('queued', 'retry-scheduled')
    AND (next_attempt_at IS NULL OR next_attempt_at <= ?) ORDER BY priority ASC, enqueued_at ASC, id ASC LIMIT 1`);
  const leaseStmt = db.prepare(`UPDATE jobs SET status = 'leased', leased_by = ?, leased_at = ?, heartbeat_at = ?,
    lease_until = ?, lease_token = lease_token + 1, attempts = attempts + 1, updated_at = ?
    WHERE tenant_id = ? AND id = ? AND status IN ('queued', 'retry-scheduled')`);
  const heartbeatStmt = db.prepare(`UPDATE jobs SET heartbeat_at = ?, lease_until = ?, updated_at = ?
    WHERE tenant_id = ? AND id = ? AND lease_token = ? AND status IN ('leased', 'running')`);
  const runningStmt = db.prepare(`UPDATE jobs SET status = 'running', updated_at = ?
    WHERE tenant_id = ? AND id = ? AND lease_token = ? AND status = 'leased'`);
  const finishStmt = db.prepare(`UPDATE jobs SET status = ?, result = ?, error = ?, updated_at = ?,
    leased_by = NULL, leased_at = NULL, heartbeat_at = NULL, lease_until = NULL
    WHERE tenant_id = ? AND id = ?`);
  const retryStmt = db.prepare(`UPDATE jobs SET status = 'retry-scheduled', error = ?, next_attempt_at = ?, updated_at = ?,
    leased_by = NULL, leased_at = NULL, heartbeat_at = NULL, lease_until = NULL
    WHERE tenant_id = ? AND id = ?`);
  const deadLetterStmt = db.prepare(`UPDATE jobs SET status = 'dead-letter', dead_letter_at = ?, dead_letter_reason = ?, updated_at = ?,
    leased_by = NULL, leased_at = NULL, heartbeat_at = NULL, lease_until = NULL
    WHERE tenant_id = ? AND id = ?`);
  const insertDeadLetterStmt = db.prepare(`INSERT OR REPLACE INTO job_dead_letters(tenant_id, job_id, classification, reason, attempts, job, created_at, redriven_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`);
  const getDeadLetterStmt = db.prepare("SELECT * FROM job_dead_letters WHERE tenant_id = ? AND job_id = ?");
  const listDeadLettersStmt = db.prepare("SELECT * FROM job_dead_letters WHERE tenant_id = ? ORDER BY created_at, job_id");
  const redriveStmt = db.prepare(`UPDATE jobs SET status = 'queued', attempts = 0, error = NULL, dead_letter_at = NULL, dead_letter_reason = NULL,
    next_attempt_at = NULL, updated_at = ? WHERE tenant_id = ? AND id = ? AND status = 'dead-letter'`);
  const markRedrivenStmt = db.prepare("UPDATE job_dead_letters SET redriven_at = ?, job = ? WHERE tenant_id = ? AND job_id = ?");
  const staleStmt = db.prepare(`SELECT id FROM jobs WHERE status IN ('leased', 'running')
    AND COALESCE(lease_until, heartbeat_at, leased_at) < ? AND tenant_id = ?`);
  const requeueStmt = db.prepare(`UPDATE jobs SET status = 'queued', leased_by = NULL, leased_at = NULL, heartbeat_at = NULL, lease_until = NULL,
    updated_at = ? WHERE tenant_id = ? AND id = ?`);
  const insertAttemptStmt = db.prepare(`INSERT OR REPLACE INTO job_attempts(
      tenant_id, job_id, attempt, classification, state, lease_token, started_at, finished_at, outcome, error, policy_bundle_version, approval_id, execution_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL)`);
  const finishAttemptStmt = db.prepare(`UPDATE job_attempts SET state = ?, finished_at = ?, outcome = ?, error = ?,
    policy_bundle_version = ?, approval_id = ?, execution_id = ? WHERE tenant_id = ? AND job_id = ? AND attempt = ?`);
  const listAttemptsStmt = db.prepare("SELECT * FROM job_attempts WHERE tenant_id = ? AND job_id = ? ORDER BY attempt");
  const countAttemptsStmt = db.prepare("SELECT COUNT(*) AS n FROM job_attempts WHERE tenant_id = ? AND job_id = ?");

  function parse(row) {
    if (!row) return null;
    return {
      ...row,
      payload: row.payload === null || row.payload === undefined ? null : JSON.parse(row.payload),
      result: row.result === null || row.result === undefined ? null : JSON.parse(row.result),
    };
  }

  function parseAttempt(row) {
    if (!row) return null;
    return {
      tenantId: row.tenant_id,
      jobId: row.job_id,
      attempt: row.attempt,
      classification: row.classification,
      state: row.state,
      leaseToken: row.lease_token,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      outcome: row.outcome,
      error: row.error,
      policyBundleVersion: row.policy_bundle_version,
      approvalId: row.approval_id,
      executionId: row.execution_id,
    };
  }

  function parseDeadLetter(row) {
    if (!row) return null;
    return {
      tenantId: row.tenant_id,
      jobId: row.job_id,
      classification: row.classification,
      reason: row.reason,
      attempts: row.attempts,
      job: JSON.parse(row.job),
      createdAt: row.created_at,
      redrivenAt: row.redriven_at,
    };
  }

  const queue = {
    kind,

    /**
     * Indsend et job. Er der en `idempotencyKey`, og findes den allerede for
     * tenanten, returneres den eksisterende række i stedet for at oprette en ny.
     */
    submit(tenantId, job = {}) {
      const tenant = normalizeTenantId(tenantId);
      const id = job.id ?? randomUUID();
      const at = iso(job.enqueuedAt ?? clock());
      const result = db.transaction(() => {
        if (job.idempotencyKey) {
          const existing = parse(getIdemStmt.get(tenant, job.idempotencyKey));
          if (existing) return { job: existing, deduplicated: true, created: false };
        }
        insertStmt.run(
          tenant,
          id,
          job.kind ?? "task",
          JSON.stringify(job.payload ?? null),
          at,
          at,
          job.priority ?? 100,
          job.classification ?? null,
          job.idempotencyKey ?? null,
          job.maxAttempts ?? 3,
          job.nextAttemptAt ?? null,
          job.parentId ?? null,
          job.compensationFor ?? null
        );
        const created = parse(getStmt.get(tenant, id));
        if (job.idempotencyKey) {
          const winner = parse(getIdemStmt.get(tenant, job.idempotencyKey));
          return { job: winner, deduplicated: winner?.id !== id, created: winner?.id === id };
        }
        return { job: created, deduplicated: false, created: true };
      });
      return result;
    },

    /** Opret kun hvis den ikke findes (bagudkompatibel med DKC-008's jobstore). */
    ensure(tenantId, job = {}) {
      return queue.submit(tenantId, { ...job, idempotencyKey: job.idempotencyKey ?? null }).job;
    },

    get(tenantId, id) {
      return parse(getStmt.get(normalizeTenantId(tenantId), id));
    },

    getByIdempotencyKey(tenantId, key) {
      return parse(getIdemStmt.get(normalizeTenantId(tenantId), key));
    },

    list(tenantId, { status } = {}) {
      return listStmt.all(normalizeTenantId(tenantId)).map(parse).filter((j) => (status ? j.status === status : true));
    },

    /**
     * Lease næste forfaldne job for tenanten. Atomisk på tværs af processer.
     * Returnerer jobbet med det nye `lease_token`.
     */
    lease(tenantId, workerId, { leaseMs = 30_000, now = clock() } = {}) {
      const tenant = normalizeTenantId(tenantId);
      const at = iso(now);
      return db.transaction(() => {
        const candidate = dueStmt.get(tenant, at);
        if (!candidate) return null;
        leaseStmt.run(workerId ?? null, at, at, iso(now + leaseMs), at, tenant, candidate.id);
        return parse(getStmt.get(tenant, candidate.id));
      });
    },

    /** Forlæng en lease. Et gammelt fencing-token afvises. */
    heartbeat(tenantId, id, leaseToken, { leaseMs = 30_000, now = clock() } = {}) {
      const at = iso(now);
      return heartbeatStmt.run(at, iso(now + leaseMs), at, normalizeTenantId(tenantId), id, leaseToken).changes > 0;
    },

    /** Markér at eksekveringen er begyndt (efter lease). */
    markRunning(tenantId, id, leaseToken, { now = clock() } = {}) {
      return runningStmt.run(iso(now), normalizeTenantId(tenantId), id, leaseToken).changes > 0;
    },

    /** Skriv starten af et forsøg til det sporbare spor. */
    startAttempt(tenantId, id, { attempt, classification = null, leaseToken = null, now = clock() } = {}) {
      const tenant = normalizeTenantId(tenantId);
      return db.transaction(() => {
        insertAttemptStmt.run(tenant, id, attempt, classification, "running", leaseToken, iso(now));
        return parseAttempt(listAttemptsStmt.all(tenant, id).find((r) => r.attempt === attempt));
      });
    },

    /** Afslut et forsøg med udfald. */
    finishAttempt(tenantId, id, attempt, { state, outcome = null, error = null, policyBundleVersion = null, approvalId = null, executionId = null, now = clock() } = {}) {
      const tenant = normalizeTenantId(tenantId);
      finishAttemptStmt.run(state, iso(now), outcome, error, policyBundleVersion, approvalId, executionId, tenant, id, attempt);
      return parseAttempt(db.get("SELECT * FROM job_attempts WHERE tenant_id = ? AND job_id = ? AND attempt = ?", tenant, id, attempt));
    },

    attempts(tenantId, id) {
      return listAttemptsStmt.all(normalizeTenantId(tenantId), id).map(parseAttempt);
    },

    attemptCount(tenantId, id) {
      return countAttemptsStmt.get(normalizeTenantId(tenantId), id)?.n ?? 0;
    },

    /** Afslut jobbet som gennemført. */
    complete(tenantId, id, result = null, { now = clock() } = {}) {
      const tenant = normalizeTenantId(tenantId);
      const at = iso(now);
      return db.transaction(() => {
        finishStmt.run("completed", JSON.stringify(result), null, at, tenant, id);
        return parse(getStmt.get(tenant, id));
      });
    },

    /** Afslut jobbet som fejlet (terminalt). */
    fail(tenantId, id, error, { now = clock() } = {}) {
      const tenant = normalizeTenantId(tenantId);
      const at = iso(now);
      const message = error instanceof Error ? error.message : String(error);
      return db.transaction(() => {
        finishStmt.run("failed", null, message, at, tenant, id);
        return parse(getStmt.get(tenant, id));
      });
    },

    /** Markér outcome ukendt (afventer reconciliation). */
    markUnknown(tenantId, id, { error = "ukendt udfald", now = clock() } = {}) {
      const tenant = normalizeTenantId(tenantId);
      const at = iso(now);
      return db.transaction(() => {
        finishStmt.run("unknown", null, error, at, tenant, id);
        return parse(getStmt.get(tenant, id));
      });
    },

    /** Udsæt et nyt forsøg efter backoff. */
    scheduleRetry(tenantId, id, { error = null, nextAttemptAt, now = clock() } = {}) {
      const tenant = normalizeTenantId(tenantId);
      const at = iso(now);
      return db.transaction(() => {
        retryStmt.run(error, nextAttemptAt ?? null, at, tenant, id);
        return parse(getStmt.get(tenant, id));
      });
    },

    /** Flyt et job til dead-letter-køen. */
    deadLetter(tenantId, id, { reason, classification = null, now = clock() } = {}) {
      const tenant = normalizeTenantId(tenantId);
      const at = iso(now);
      return db.transaction(() => {
        const job = parse(getStmt.get(tenant, id));
        if (!job) return null;
        deadLetterStmt.run(at, reason, at, tenant, id);
        insertDeadLetterStmt.run(tenant, id, classification ?? job.classification ?? null, reason, job.attempts, JSON.stringify(job), at);
        return parse(getStmt.get(tenant, id));
      });
    },

    deadLetters(tenantId) {
      return listDeadLettersStmt.all(normalizeTenantId(tenantId)).map(parseDeadLetter);
    },

    getDeadLetter(tenantId, id) {
      return parseDeadLetter(getDeadLetterStmt.get(normalizeTenantId(tenantId), id));
    },

    /** Genindlæs et dead-letter-job for en ny runde (kræver operatørhandling). */
    redrive(tenantId, id, { now = clock() } = {}) {
      const tenant = normalizeTenantId(tenantId);
      const at = iso(now);
      return db.transaction(() => {
        const changed = redriveStmt.run(at, tenant, id).changes;
        if (!changed) return null;
        const job = parse(getStmt.get(tenant, id));
        markRedrivenStmt.run(at, JSON.stringify(job), tenant, id);
        return job;
      });
    },

    /**
     * Genåbn leases der er udløbet (worker død). Returnerer de genåbnede jobs.
     */
    recoverStaleLeases({ tenantId = null, olderThanMs = 60_000, now = clock() } = {}) {
      const cutoff = iso(now - olderThanMs);
      const reopened = [];
      const tenants = tenantId
        ? [normalizeTenantId(tenantId)]
        : db.all(`SELECT DISTINCT tenant_id FROM jobs WHERE status IN ('leased', 'running')`).map((r) => r.tenant_id);
      db.transaction(() => {
        for (const tenant of tenants) {
          for (const row of staleStmt.all(cutoff, tenant)) {
            requeueStmt.run(iso(now), tenant, row.id);
            reopened.push(parse(getStmt.get(tenant, row.id)));
          }
        }
      });
      return reopened;
    },

    count(tenantId, { status } = {}) {
      return listStmt.all(normalizeTenantId(tenantId)).filter((j) => (status ? j.status === status : true)).length;
    },
  };

  return queue;
}

export { OPEN_STATES as QUEUE_OPEN_STATES };
