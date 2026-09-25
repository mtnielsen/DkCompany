/**
 * DKC-043 — dedup af jobhændelser.
 *
 * Jobhændelser deduplikeres udelukkende på en eksplicit idempotency-nøgle
 * (tenant + begivenheds-id + ressource + version) inden for et tidsvindue.
 * Indholdet flettes aldrig: to begivenheder med samme payload men forskellige
 * id'er er to forskellige hændelser, og en gentagen levering af samme
 * idempotency-nøgle undertrykkes kun inden for vinduet. Det bevarer
 * forretningsbetydningen og gør genlevering sikkert uden at skjule dubletter.
 */
import { normalizeTenantId } from "../../identity/src/tenant.mjs";
import { eventDigest } from "../../jobs/src/events.mjs";

export class EventDedupError extends Error {
  constructor(message, code = "event_dedup_error") {
    super(message);
    this.name = "EventDedupError";
    this.code = code;
  }
}

/** Kanonisk idempotency-nøgle for en CloudEvent-envelope. */
export function eventDedupKey(event) {
  if (!event || typeof event !== "object") throw new EventDedupError("eventDedupKey kræver en begivenhed");
  const tenant = normalizeTenantId(event.tenantid);
  const resource = event.data?.resource;
  if (!resource || typeof resource.type !== "string" || typeof resource.id !== "string" || !Number.isInteger(resource.version)) {
    throw new EventDedupError("begivenheden mangler en tenantbundet ressource med version", "missing_resource");
  }
  return `${tenant}:${event.id}:${resource.type}:${resource.id}:${resource.version}`;
}

/**
 * @param {object} options
 * @param {number} [options.windowSeconds]
 * @param {Function} [options.clock]
 */
export function createEventDeduper({ windowSeconds = 86400, clock = () => Date.now() } = {}) {
  const seen = new Map();

  function prune(now) {
    for (const [key, entry] of seen) {
      if (entry.expiresAt <= now) seen.delete(key);
    }
  }

  return {
    kind: "event-deduper",
    windowSeconds,

    /** Beslut om en begivenhed skal leveres, eller er en gentagelse. */
    decide(event, { now = clock() } = {}) {
      prune(now);
      const key = eventDedupKey(event);
      const existing = seen.get(key);
      if (existing) {
        return { deliver: false, duplicate: true, key, firstSeenAt: existing.firstSeenAt, digest: eventDigest(event) };
      }
      const entry = { firstSeenAt: new Date(now).toISOString(), expiresAt: now + windowSeconds * 1000, digest: eventDigest(event) };
      seen.set(key, entry);
      return { deliver: true, duplicate: false, key, firstSeenAt: entry.firstSeenAt, digest: entry.digest };
    },

    /** Er nøglen allerede set inden for vinduet? */
    has(event, { now = clock() } = {}) {
      prune(now);
      return seen.has(eventDedupKey(event));
    },

    size() {
      return seen.size;
    },
  };
}
