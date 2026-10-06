/**
 * DKC-013 — holdbar jobkø med eksplicit tilstandsmaskine og politik.
 *
 * `queue` er den højniveaufacade som runneren taler med. Den lægger
 * tilstandsmaskinen (`state.mjs`) og retry-/dead-letter-politikken
 * (`retry.mjs`) oven på den vedvarende adapter
 * (`persistence/src/adapters/job-queue.mjs`), så en transition eller en
 * retry-beslutning altid går gennem den samme regel.
 */
import { createSqliteJobQueue } from "../../persistence/src/adapters/job-queue.mjs";
import { assertTransition, canTransition, isTerminalState } from "./state.mjs";
import { DEFAULT_RETRY_POLICY, decideOutcome, isRetryableError } from "./retry.mjs";
import { classifyJob } from "./classification.mjs";

export function createJobQueue({ db, clock = () => Date.now(), retryPolicy = DEFAULT_RETRY_POLICY } = {}) {
  const store = createSqliteJobQueue({ db, clock });

  function maxAttemptsFor(job) {
    return job?.max_attempts ?? retryPolicy.maxAttempts;
  }

  function applyDecision(tenantId, id, decision, { classification, error = null, now = clock() } = {}) {
    if (decision.action === "retry") {
      const nextAt = new Date(now + decision.delayMs).toISOString();
      const job = store.scheduleRetry(tenantId, id, { error: error == null ? null : String(error?.message ?? error), nextAttemptAt: nextAt, now });
      return { status: "retry-scheduled", delayMs: decision.delayMs, nextAttemptAt: nextAt, job, decision };
    }
    if (decision.action === "dead-letter" || decision.action === "escalate") {
      const job = store.deadLetter(tenantId, id, { reason: decision.reason, classification, now });
      return { status: "dead-letter", job, decision };
    }
    return { status: "completed", decision };
  }

  const queue = {
    store,
    kind: store.kind,
    retryPolicy,

    submit(tenantId, job = {}) {
      const classification = job.classification ?? classifyJob(job);
      return store.submit(tenantId, { ...job, classification });
    },

    get: (...args) => store.get(...args),
    getByIdempotencyKey: (...args) => store.getByIdempotencyKey(...args),
    list: (...args) => store.list(...args),
    attempts: (...args) => store.attempts(...args),
    deadLetters: (...args) => store.deadLetters(...args),
    getDeadLetter: (...args) => store.getDeadLetter(...args),
    redrive: (...args) => store.redrive(...args),
    recoverStaleLeases: (...args) => store.recoverStaleLeases(...args),

    lease: (...args) => store.lease(...args),
    heartbeat: (...args) => store.heartbeat(...args),

    markRunning(tenantId, id, leaseToken, opts = {}) {
      const job = store.get(tenantId, id);
      if (job && !isTerminalState(job.status)) assertTransition(job.status, "running");
      return store.markRunning(tenantId, id, leaseToken, opts);
    },

    beginAttempt(tenantId, id, { attempt, classification = null, leaseToken = null, now = clock() } = {}) {
      return store.startAttempt(tenantId, id, { attempt, classification, leaseToken, now });
    },

    finishAttempt: (...args) => store.finishAttempt(...args),

    /** Gennemfør et forsøg og jobbet. Idempotent: et terminalt job røres ikke. */
    succeed(tenantId, id, { attempt, result = null, outcome = "succeeded", policyBundleVersion = null, approvalId = null, executionId = null, now = clock() } = {}) {
      const existing = store.get(tenantId, id);
      if (existing && isTerminalState(existing.status)) return { status: existing.status, job: existing, replayed: true };
      if (attempt != null) {
        store.finishAttempt(tenantId, id, attempt, { state: "succeeded", outcome, policyBundleVersion, approvalId, executionId, now });
      }
      const job = store.complete(tenantId, id, result, { now });
      return { status: "completed", job };
    },

    /**
     * Registrér et fejlet forsøg og anvend retry-/dead-letter-politikken.
     * `retryable` kan tvinges af kalderen (fx en eskalering der kan afhjælpes).
     */
    fail(tenantId, id, { attempt, classification, error = null, retryable = undefined, policyBundleVersion = null, approvalId = null, executionId = null, now = clock() } = {}) {
      const job = store.get(tenantId, id);
      const effectiveRetryable = retryable === undefined ? isRetryableError(error) : retryable;
      store.finishAttempt(tenantId, id, attempt, { state: "failed", error: error == null ? null : String(error?.message ?? error), policyBundleVersion, approvalId, executionId, now });
      const decision = decideOutcome({ classification, state: "failed", attempt, maxAttempts: maxAttemptsFor(job), retryable: effectiveRetryable, error });
      return applyDecision(tenantId, id, decision, { classification, error, now });
    },

    /** Registrér et `unknown` outcome og afgør næste skridt. */
    unknown(tenantId, id, { attempt, classification, error = "ukendt udfald", retryable = true, policyBundleVersion = null, approvalId = null, executionId = null, now = clock() } = {}) {
      const job = store.get(tenantId, id);
      store.finishAttempt(tenantId, id, attempt, { state: "unknown", error: String(error), policyBundleVersion, approvalId, executionId, now });
      if (job && !["unknown", "dead-letter"].includes(job.status)) store.markUnknown(tenantId, id, { error: String(error), now });
      const decision = decideOutcome({ classification, state: "unknown", attempt, maxAttempts: maxAttemptsFor(job), retryable, error });
      return applyDecision(tenantId, id, decision, { classification, error, now });
    },

    /** Flyt direkte til dead-letter (fx et irreversibelt unknown uden resolver). */
    deadLetter(tenantId, id, { classification = null, reason, now = clock() } = {}) {
      const job = store.get(tenantId, id);
      if (job && !isTerminalState(job.status)) assertTransition(job.status, "dead-letter");
      const dead = store.deadLetter(tenantId, id, { reason, classification, now });
      return { status: "dead-letter", job: dead, decision: { action: "escalate", reason } };
    },

    count: (...args) => store.count(...args),
    canTransition,
  };

  return queue;
}
