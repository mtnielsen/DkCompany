/**
 * DKC-010 — tilbagekaldelse af rettigheder.
 *
 * Et credential kan tilbagekaldes på tre niveauer:
 *   - **credential** (jti) — det enkelte token,
 *   - **agent** (spiffeId) — alle tokens for én agentidentitet,
 *   - **tenant** (tenantId) — alle tokens for én kunde.
 *
 * Verifikationssiden tjekker listen ved hver modtagelse, så et tilbagekaldt
 * token afvises selvom signaturen og TTL stadig er gyldige. Listen kan være
 * in-memory eller holdbar via en `store` (persistenslaget).
 */
function keyFor({ scope, jti, spiffeId, tenantId }) {
  if (scope === "credential") return `jti:${jti}`;
  if (scope === "agent") return `agent:${spiffeId}`;
  if (scope === "tenant") return `tenant:${tenantId}`;
  throw new Error(`ukendt revocation-scope '${scope}'`);
}

function createMemoryStore() {
  const map = new Map();
  return {
    kind: "memory-revocation-store",
    put(entry) {
      map.set(entry.key, entry);
      return entry;
    },
    get(key) {
      return map.get(key) ?? null;
    },
    all() {
      return [...map.values()];
    },
    remove(key) {
      return map.delete(key);
    },
  };
}

export function createRevocationList({ store = createMemoryStore(), clock = () => Date.now(), kind = "revocation-list" } = {}) {
  if (!store) throw new Error("createRevocationList kræver en store");

  function revoke({ jti = null, spiffeId = null, tenantId = null, scope = "credential", reason = null, revokedBy = null, ttlSeconds = null } = {}) {
    if (!["credential", "agent", "tenant"].includes(scope)) throw new Error(`ukendt scope '${scope}'`);
    if (scope === "credential" && !jti) throw new Error("credential-revocation kræver jti");
    if (scope === "agent" && !spiffeId) throw new Error("agent-revocation kræver spiffeId");
    if (scope === "tenant" && !tenantId) throw new Error("tenant-revocation kræver tenantId");
    const now = clock();
    const entry = {
      key: keyFor({ scope, jti, spiffeId, tenantId }),
      scope,
      jti,
      spiffeId,
      tenantId,
      reason,
      revokedBy,
      revokedAt: new Date(now).toISOString(),
      expiresAt: ttlSeconds ? new Date(now + ttlSeconds * 1000).toISOString() : null,
    };
    store.put(entry);
    return entry;
  }

  function isRevoked({ jti = null, spiffeId = null, tenantId = null, now = clock() } = {}) {
    const candidates = [];
    if (jti) candidates.push(`jti:${jti}`);
    if (spiffeId) candidates.push(`agent:${spiffeId}`);
    if (tenantId) candidates.push(`tenant:${tenantId}`);
    for (const key of candidates) {
      const entry = store.get(key);
      if (!entry) continue;
      if (entry.expiresAt && Date.parse(entry.expiresAt) <= now) {
        store.remove(key);
        continue;
      }
      return { revoked: true, entry };
    }
    return { revoked: false, entry: null };
  }

  function prune({ now = clock() } = {}) {
    let removed = 0;
    for (const entry of store.all()) {
      if (entry.expiresAt && Date.parse(entry.expiresAt) <= now) {
        if (store.remove(entry.key)) removed += 1;
      }
    }
    return { removed };
  }

  return {
    kind,
    store,
    revoke,
    isRevoked,
    prune,
    list() {
      return store.all();
    },
  };
}
