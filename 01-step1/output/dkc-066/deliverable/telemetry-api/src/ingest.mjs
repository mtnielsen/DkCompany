/**
 * DKC-066 — autentificeret indtagning med server-side scope.
 *
 * Indtagningen er den eneste skrivevej. Den:
 *
 *   1. **udleder scope server-side** fra den verificerede principal
 *      (`requireTenantContext`); et tenantpåstand i envelopen må ikke afvige,
 *   2. afviser ukendte/ubetroede kilder og signaler uden deres strukturerede del,
 *   3. afviser malformede og for gamle (uden for retention) hændelser,
 *   4. opdager dubletter og replays via id → digest,
 *   5. anvender en kardinalitetsgrænse i lageret og en token-bucket/backpressure
 *      på indtagsraten,
 *   6. markerer forældede (men gyldige) hændelser `late`, så de ikke indgår i
 *      friskheds-/pass-beregningen.
 *
 * Modulet rører ikke audit. Den obligatoriske audit har sin egen holdbare vej
 * (DKC-009); et telemetritab kan derfor ikke deaktivere den.
 */
import { requireTenantContext } from "../../identity/src/tenant.mjs";
import { envelopeProblems, envelopeDigest } from "./envelope.mjs";

const ENVIRONMENTS = new Set(["dev", "staging", "prod"]);

/** Udled den autoritative scope. Kaster ved tenant-mismatch eller manglende kontekst. */
export function deriveScope({ principal, envelope, now = Date.now() }) {
  const claimed = envelope?.scope?.tenantId ? [envelope.scope.tenantId] : [];
  const context = requireTenantContext({ principal, claimed, source: "telemetry-ingest" });
  const environment = envelope?.scope?.environment ?? principal?.environment ?? "staging";
  if (!ENVIRONMENTS.has(environment)) throw new Error(`ukendt miljø '${environment}'`);
  return { tenantId: context.tenantId, environment, service: envelope?.scope?.service ?? principal?.service ?? null, crossTenant: context.crossTenant };
}

/** Er ressource-ID'ens tenant den samme som den udledte scope (globale tilladt)? */
export function resourceMatchesScope(resourceId, tenantId, { allowGlobal = true } = {}) {
  if (!resourceId) return false;
  const match = /^res:\/\/([a-z0-9][a-z0-9-]{1,62})\//.exec(resourceId);
  const owner = match?.[1];
  return owner === tenantId || (allowGlobal && owner === "platform");
}

export function createIngestor({ store, registry, clock = () => Date.now(), limits = {} } = {}) {
  if (!store) throw new Error("createIngestor kræver et lager");
  const cfg = {
    maxEnvelopesPerSecond: limits.maxEnvelopesPerSecond ?? registry?.bounds?.maxEnvelopesPerSecond ?? 500,
    maxBuffer: limits.maxBuffer ?? registry?.bounds?.maxBuffer ?? 10000,
    maxEnvelopeBytes: limits.maxEnvelopeBytes ?? registry?.bounds?.maxEnvelopeBytes ?? 262144,
    maxSkewSeconds: limits.maxSkewSeconds ?? 300,
    maxAgeSeconds: limits.maxAgeSeconds ?? 3600,
    rateWindowSeconds: limits.rateWindowSeconds ?? 1,
  };
  const seen = new Map(); // id → { digest, at }
  const rateWindow = [];
  const counters = { accepted: 0, duplicate: 0, rejected: 0, backpressure: 0, late: 0, cardinality: 0, expired: 0 };
  const lastContext = { tenantId: null, environment: null, service: null };

  function rateLimited(now) {
    const cutoff = now - cfg.rateWindowSeconds * 1000;
    while (rateWindow.length && rateWindow[0] < cutoff) rateWindow.shift();
    if (rateWindow.length >= cfg.maxEnvelopesPerSecond * cfg.rateWindowSeconds) return true;
    rateWindow.push(now);
    return false;
  }

  return {
    ingest({ principal, envelope, receivedAt = null } = {}) {
      const now = clock();
      const base = { id: envelope?.id ?? null, receivedAt: receivedAt ?? new Date(now).toISOString() };

      if (rateLimited(now)) {
        counters.backpressure += 1;
        return { ...base, status: "backpressure", accepted: false, reason: "indtagsraten overstiger grænsen", retryAfterSeconds: 1 };
      }
      if (store.stats().size >= cfg.maxBuffer) {
        counters.backpressure += 1;
        return { ...base, status: "backpressure", accepted: false, reason: "bufferen er fuld", retryAfterSeconds: 1 };
      }
      let serialized;
      try {
        serialized = JSON.stringify(envelope ?? {});
      } catch {
        serialized = "";
      }
      if (Buffer.byteLength(serialized, "utf8") > cfg.maxEnvelopeBytes) {
        counters.rejected += 1;
        return { ...base, status: "rejected", accepted: false, reason: "envelopen overstiger den maksimale størrelse" };
      }

      const check = envelopeProblems(envelope, { now, registry, maxSkewSeconds: cfg.maxSkewSeconds, maxAgeSeconds: cfg.maxAgeSeconds });
      if (check.problems.length) {
        counters.rejected += 1;
        return { ...base, status: "rejected", accepted: false, violations: check.problems.map((p) => `${p.path} ${p.message}`.trim()) };
      }
      if (!check.trusted) {
        counters.rejected += 1;
        return { ...base, status: "rejected", accepted: false, reason: `kilden '${envelope.source?.id}' er ikke betroet` };
      }

      // Dublet/replay.
      const digest = envelopeDigest(envelope);
      const previous = seen.get(envelope.id);
      if (previous) {
        if (previous.digest === digest) {
          counters.duplicate += 1;
          return { ...base, status: "duplicate", accepted: false, reason: "hændelsen er allerede indtaget" };
        }
        counters.rejected += 1;
        return { ...base, status: "rejected", accepted: false, reason: "id'et er genbrugt med nyt indhold (replay)" };
      }

      // Server-side scope.
      let scope;
      try {
        scope = deriveScope({ principal, envelope, now });
      } catch (e) {
        counters.rejected += 1;
        return { ...base, status: "rejected", accepted: false, reason: `scope kunne ikke udledes: ${e.message}` };
      }
      if (!resourceMatchesScope(envelope.resource, scope.tenantId)) {
        counters.rejected += 1;
        return { ...base, status: "rejected", accepted: false, reason: "ressourcen tilhører ikke den udledte tenant" };
      }

      const record = {
        ...envelope,
        scope,
        late: check.late,
        ingestedAt: new Date(now).toISOString(),
        receivedAt: base.receivedAt,
        correlation: check.correlation,
        sourceTrusted: true,
      };
      const result = store.append(record);
      if (!result.stored) {
        if (result.reason === "cardinality") counters.cardinality += 1;
        else if (result.reason === "expired") counters.expired += 1;
        else counters.rejected += 1;
        return { ...base, status: "rejected", accepted: false, reason: result.reason, scope };
      }
      seen.set(envelope.id, { digest, at: now });
      if (check.late) counters.late += 1;
      counters.accepted += 1;
      lastContext.tenantId = scope.tenantId;
      lastContext.environment = scope.environment;
      lastContext.service = scope.service;
      return { ...base, status: check.late ? "accepted-late" : "accepted", accepted: true, scope, late: check.late, correlation: check.correlation };
    },
    stats() {
      return { ...counters, buffer: store.stats().size, ...lastContext };
    },
  };
}
