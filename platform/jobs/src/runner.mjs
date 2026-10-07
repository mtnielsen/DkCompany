/**
 * DKC-013 — job-runner.
 *
 * Runneren er bindeleddet mellem den holdbare jobkø og agent-runtimen. Den:
 *
 *   1. leaser næste forfaldne job (fencing-token) og markerer det `running`,
 *   2. undersøger **før** et nyt forsøg om et tidligere forsøg på samme job
 *      står `pending`/`unknown`. Er det tilfældet, reconcileres det først — en
 *      irreversibel ændring genudføres aldrig blindt,
 *   3. bygger en task pr. forsøg med et **nyt idempotency-ID** (`<job>:a<N>`),
 *      så en retry får en ny policykontrol og en ny godkendelse, og
 *   4. oversætter runtimens resultat til en jobtilstand og anvender
 *      retry-/dead-letter-politikken.
 */
import { randomUUID } from "node:crypto";
import { classifyJob } from "./classification.mjs";

export function createJobRunner({
  queue,
  runtime,
  journal = null,
  authorizationProvider = null,
  reconciler = null,
  clock = () => Date.now(),
  workerId = `worker-${randomUUID()}`,
  leaseMs = 30_000,
} = {}) {
  if (!queue) throw new Error("createJobRunner kræver en jobkø");
  if (!runtime) throw new Error("createJobRunner kræver en runtime");

  const actionJournal = journal ?? runtime?.actionJournal ?? null;

  function baseKey(job) {
    return job.idempotency_key ?? job.idempotencyKey ?? job.id;
  }

  function attemptKey(job, attempt, index = null) {
    return index === null ? `${baseKey(job)}:a${attempt}` : `${baseKey(job)}:a${attempt}:${index}`;
  }

  function buildTask(job, attempt, auth = null) {
    const template = job.payload?.task;
    if (!template) throw new Error(`job '${job.id}' mangler payload.task`);
    const task = structuredClone(template);
    task.taskId = template.taskId ?? job.id;
    task.tenantId = template.tenantId ?? job.tenant_id;
    task.actions = (template.actions ?? []).map((action, index) => ({
      ...action,
      idempotencyId: action.idempotencyId ?? attemptKey(job, attempt, index),
      ...(auth?.executionId ? { executionId: auth.executionId } : {}),
      ...(auth?.approvalId ? { approvalId: auth.approvalId } : {}),
    }));
    return task;
  }

  /**
   * Undersøg tidligere forsøg på samme job. Returnerer det første uafsluttede
   * (`pending`/`unknown`) eller et tidligere gennemført forsøg.
   */
  function inspectPriorAttempts(job) {
    if (!actionJournal || typeof actionJournal.lookup !== "function") return null;
    const task = job.payload?.task;
    const actions = task?.actions ?? [];
    const actionCount = actions.length || 1;
    let succeeded = null;
    for (let attempt = 1; attempt < job.attempts; attempt += 1) {
      for (let index = 0; index < actionCount; index += 1) {
        const idempotencyId = actions[index]?.idempotencyId ?? attemptKey(job, attempt, index);
        const found = actionJournal.lookup({ tenantId: job.tenant_id, idempotencyId });
        if (!found?.found) continue;
        if (found.state === "pending" || found.state === "unknown") {
          return { type: "unresolved", idempotencyId, state: found.state, intent: found.intent };
        }
        if (found.state === "succeeded") {
          succeeded = { type: "succeeded", idempotencyId, outcome: found.outcome, intent: found.intent };
        }
      }
    }
    return succeeded;
  }

  async function handlePrior(job, classification, { tenantId } = {}) {
    const prior = inspectPriorAttempts(job);
    if (!prior) return { handled: false };
    if (prior.type === "succeeded") {
      const done = await queue.succeed(tenantId, job.id, { attempt: null, result: prior.outcome?.result ?? null, outcome: "replayed" });
      return { handled: true, status: "replayed", job: done.job, prior };
    }
    // Uafsluttet tidligere forsøg: reconcile før noget nyt.
    const verb = prior.intent?.verb ?? job.payload?.task?.actions?.[0]?.verb ?? null;
    const reconciled = reconciler
      ? await reconciler.reconcileIdempotency({ tenantId, idempotencyId: prior.idempotencyId, verb })
      : { ok: false, resolved: false };
    if (reconciled?.resolved && reconciled.state === "succeeded") {
      const done = await queue.succeed(tenantId, job.id, { attempt: null, result: reconciled.outcome?.result ?? null, outcome: "reconciled" });
      return { handled: true, status: "reconciled", job: done.job, prior, reconciled };
    }
    if (classification === "irreversible-write") {
      const dead = queue.deadLetter(tenantId, job.id, { classification, reason: `irreversibelt unknown outcome for '${prior.idempotencyId}' — afventer menneskelig reconciliation` });
      return { handled: true, status: "dead-letter", job: dead.job, prior, reason: "irreversibelt unknown outcome" };
    }
    const compensation = reconciler ? await reconciler.compensate({ tenantId, job, verb, reason: "unknown outcome" }) : { ok: false, reason: "ingen reconciler" };
    if (!compensation.ok) {
      const dead = queue.deadLetter(tenantId, job.id, { classification, reason: `unknown outcome uden kompensation: ${compensation.reason}` });
      return { handled: true, status: "dead-letter", job: dead.job, prior, reason: compensation.reason };
    }
    const done = await queue.succeed(tenantId, job.id, { attempt: null, result: { compensated: compensation.verb, compensationJobId: compensation.job?.id ?? null }, outcome: "compensated" });
    return { handled: true, status: "compensated", job: done.job, prior, compensation };
  }

  async function runLeased(job, { tenantId = job.tenant_id } = {}) {
    const attempt = job.attempts;
    const classification = job.classification ?? classifyJob(job);
    await queue.markRunning(tenantId, job.id, job.lease_token);
    await queue.beginAttempt(tenantId, job.id, { attempt, classification, leaseToken: job.lease_token });

    const prior = await handlePrior(job, classification, { tenantId });
    if (prior.handled) {
      // Sporbart forsøgsspor også for replay/reconciliation.
      await queue.finishAttempt(tenantId, job.id, attempt, { state: prior.status === "dead-letter" ? "dead-letter" : "succeeded", outcome: prior.status, error: prior.status === "dead-letter" ? prior.reason : null });
      return { status: prior.status, job: prior.job, ...prior };
    }

    const auth = authorizationProvider ? await authorizationProvider({ job, attempt, classification }) : null;
    const task = buildTask(job, attempt, auth);

    let result;
    try {
      result = await runtime.runTask(task);
    } catch (err) {
      const outcome = await queue.fail(tenantId, job.id, { attempt, classification, error: err, approvalId: auth?.approvalId, executionId: auth?.executionId });
      return { status: outcome.status, job: outcome.job, decision: outcome.decision, attempt, error: err.message };
    }

    if (result.status === "completed") {
      const done = await queue.succeed(tenantId, job.id, { attempt, result, approvalId: auth?.approvalId, executionId: auth?.executionId });
      return { status: "completed", job: done.job, attempt, result };
    }

    if (result.status === "unknown") {
      const outcome = await queue.unknown(tenantId, job.id, { attempt, classification, error: result.reason ?? "ukendt udfald", approvalId: auth?.approvalId, executionId: auth?.executionId });
      return { status: outcome.status, job: outcome.job, decision: outcome.decision, attempt, reason: result.reason };
    }

    // escalated / refused / denied / halted.
    const retryable = result.status === "escalated";
    const error = new Error(result.reason ?? result.status);
    const outcome = await queue.fail(tenantId, job.id, { attempt, classification, error, retryable, approvalId: auth?.approvalId, executionId: auth?.executionId });
    return { status: outcome.status, job: outcome.job, decision: outcome.decision, attempt, reason: result.reason, runtimeStatus: result.status };
  }

  /** Lease og kør ét job. Returnerer `{ status: "idle" }` hvis køen er tom. */
  async function runOnce({ tenantId, workerId: requestedWorker = workerId, now } = {}) {
    const job = queue.lease(tenantId, requestedWorker, { leaseMs, now });
    if (!job) return { status: "idle", workerId: requestedWorker };
    return runLeased(job, { tenantId: tenantId ?? job.tenant_id });
  }

  /** Kør indtil køen er tom (eller `maxJobs` er nået). */
  async function runUntilIdle({ tenantId, maxJobs = 100 } = {}) {
    const processed = [];
    for (let i = 0; i < maxJobs; i += 1) {
      const outcome = await runOnce({ tenantId });
      if (outcome.status === "idle") break;
      processed.push(outcome);
    }
    return processed;
  }

  return { runOnce, runLeased, runUntilIdle, attemptKey, buildTask, workerId, actionJournal };
}
