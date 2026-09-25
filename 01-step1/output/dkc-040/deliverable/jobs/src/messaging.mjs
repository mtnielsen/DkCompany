/**
 * DKC-040 — facade for holdbar beskedudveksling.
 *
 * Samler outbox, inbox, singleton-leases og køsundhed på én databaseforbindelse.
 * Topologien (hvis givet) sætter forsøgsgrænser og backpressure, så
 * konfigurationen og koden ikke kan glide fra hinanden.
 */
import { createSqliteOutbox } from "./outbox.mjs";
import { createSqliteInbox } from "./inbox.mjs";
import { createSingletonLeases } from "./singleton.mjs";
import { createQueueHealth } from "./health.mjs";

export function createMessaging({ db, clock = () => Date.now(), topology = null } = {}) {
  if (!db) throw new Error("createMessaging kræver en database");
  const outboxPolicy = topology?.outbox
    ? {
        maxAttempts: topology.outbox.maxAttempts ?? 8,
        baseDelayMs: topology.outbox.baseDelayMs ?? 500,
        maxDelayMs: topology.outbox.maxDelayMs ?? 60_000,
      }
    : undefined;
  const outbox = createSqliteOutbox({ db, clock, ...(outboxPolicy ? { policy: outboxPolicy } : {}) });
  const inbox = createSqliteInbox({ db, clock, maxAttempts: topology?.inbox?.maxAttempts ?? 8 });
  const singletons = createSingletonLeases({ db, clock });
  const health = createQueueHealth({
    outbox,
    inbox,
    clock,
    limits: {
      maxBacklog: topology?.backpressure?.maxBacklog ?? 1000,
      maxAgeMs: (topology?.backpressure?.maxOldestAgeSeconds ?? 60) * 1000,
    },
  });
  return { outbox, inbox, singletons, health };
}
