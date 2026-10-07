/**
 * DKC-040 — synlig køtilstand, backpressure og poison-isolation.
 *
 * En kø må aldrig se sund ud fordi et kald fejlede. `createQueueHealth` læser
 * den faktiske backlog og alder fra outbox/inbox og rapporterer `unknown` (ikke
 * `healthy`) hvis lageret ikke kan læses. Backpressure aktiveres når backloggen
 * eller alderen overstiger de vedtagne grænser, så udgivere pauses frem for at
 * vokse ubegrænset. Dead-letter-køen er tenantafgrænset, så én kundes poison
 * message ikke blokerer de øvrige.
 */
export function assessBacklog({ backlog, oldestAgeMs, maxBacklog, maxAgeMs }) {
  const problems = [];
  if (backlog > maxBacklog) problems.push(`backlog ${backlog} overstiger grænsen ${maxBacklog}`);
  if (oldestAgeMs > maxAgeMs) problems.push(`ældste uafklarede begivenhed er ${oldestAgeMs}ms, over grænsen ${maxAgeMs}ms`);
  return {
    healthy: problems.length === 0,
    backlog,
    oldestAgeMs,
    paused: problems.length > 0,
    reason: problems.length ? problems.join("; ") : "inden for grænserne",
  };
}

export function createQueueHealth({ outbox, inbox = null, limits = {}, clock = () => Date.now() } = {}) {
  if (!outbox) throw new Error("createQueueHealth kræver en outbox");
  const maxBacklog = limits.maxBacklog ?? 1000;
  const maxAgeMs = limits.maxAgeMs ?? 60_000;

  return {
    kind: "queue-health",
    limits: { maxBacklog, maxAgeMs },

    /** Læs den faktiske køtilstand. Fejler læsningen, er svaret `unknown`. */
    snapshot(tenantId) {
      try {
        const backlog = outbox.backlog(tenantId);
        const oldestAgeMs = outbox.oldestPendingAgeMs(tenantId, { now: clock() });
        const assessment = assessBacklog({ backlog, oldestAgeMs, maxBacklog, maxAgeMs });
        return { observed: true, unknown: false, ...assessment };
      } catch (err) {
        return {
          observed: false,
          unknown: true,
          healthy: false,
          paused: true,
          backlog: null,
          oldestAgeMs: null,
          reason: `køtilstanden kunne ikke læses: ${err.message}`,
        };
      }
    },

    /** Skal udgivere pauses for tenanten? */
    shouldPausePublishers(tenantId) {
      return this.snapshot(tenantId).paused;
    },

    /** Dead-lettere pr. consumer for tenanten (poison-isolation). */
    deadLetters(tenantId, consumer) {
      return inbox ? inbox.deadLetters(tenantId, consumer) : [];
    },
  };
}
