/**
 * DKC-013 — reconciliation og kompensation.
 *
 * Et `unknown` outcome må ikke genudføres. Reconcileren undersøger den eksterne
 * sandhed gennem action-journalens resolver. Kan sandheden ikke afgøres, og
 * handlingen er reversibel, kan en kompensationshandling indsættes som et nyt
 * job — den kører gennem den fulde runtimegrænse som ethvert andet job.
 * Irreversible handlinger kompenseres ikke automatisk; de eskaleres.
 */
import { classifyVerb, compensationFor } from "./classification.mjs";

export function createJobReconciler({ journal, queue = null, resolvers = {}, clock = () => Date.now() } = {}) {
  if (!journal) throw new Error("createJobReconciler kræver en action-journal");

  function reconcileIdempotency({ tenantId = null, idempotencyId, verb = null } = {}) {
    const resolver = (verb && resolvers[verb]) || resolvers["*"] || null;
    return journal.reconcile({
      tenantId,
      idempotencyId,
      resolve: resolver ? (intent) => resolver(intent) : null,
    });
  }

  function compensate({ tenantId, job, verb, reason = "unknown outcome" } = {}) {
    if (!queue) return { ok: false, reason: "ingen jobkø konfigureret til kompensation" };
    const compensationVerb = compensationFor(verb);
    if (!compensationVerb) return { ok: false, reason: `ingen kendt kompensation for '${verb}'` };
    const template = job?.payload?.task;
    const first = template?.actions?.[0];
    if (!template || !first) return { ok: false, reason: "jobbet mangler en task at kompensere" };

    const compensationTask = {
      ...structuredClone(template),
      taskId: `${job.id}-compensation`,
      objective: `kompensation for '${job.id}': ${reason}`,
      actions: [{ verb: compensationVerb, target: first.target, environment: first.environment, evidence: first.evidence ?? [] }],
    };
    const submitted = queue.submit(tenantId ?? job.tenant_id, {
      idempotencyKey: `compensation:${job.id}`,
      kind: "compensation",
      payload: { task: compensationTask },
      classification: classifyVerb(compensationVerb),
      compensationFor: job.id,
      maxAttempts: 1,
    });
    return { ok: true, verb: compensationVerb, job: submitted.job, deduplicated: submitted.deduplicated, submittedAt: new Date(clock()).toISOString() };
  }

  return { reconcileIdempotency, compensate };
}
