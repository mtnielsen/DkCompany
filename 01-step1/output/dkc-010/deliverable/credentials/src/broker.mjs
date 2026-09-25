/**
 * DKC-010 — credential-broker.
 *
 * Brokers opgave er at udstede et **kortlivet, scope-bundet** token til en agent
 * for én bestemt handling. Signeringen sker i en KMS/secret-broker-signerer.
 * Brokeren:
 *
 *   - afviser at udstede når et nødstop er aktivt (fail-closed),
 *   - afviser A4-beskyttede ressourcer og verber rollen ikke må,
 *   - kræver kunde, ressource, verbum, miljø, audience og TTL,
 *   - klemmer TTL til [min, max] og sætter `jti`, `iat`, `nbf`, `exp`,
 *   - fører en udstedelsesjournal (til audit/reconciliation).
 *
 * Modstykket er `verifier.mjs`, som kun har den offentlige nøgle.
 */
import { randomUUID } from "node:crypto";
import { assertSigner, keyResolverFromJwks, signersToJwks } from "./keys.mjs";
import { signJws, verifyJws } from "./jws.mjs";
import { assertIssuableScope } from "./scope.mjs";

export class CredentialBrokerError extends Error {
  constructor(message, code = "BROKER_ERROR") {
    super(message);
    this.name = "CredentialBrokerError";
    this.code = code;
  }
}

export const DEFAULT_TTL_SECONDS = 300;

function createMemoryIssuances() {
  const entries = [];
  return {
    kind: "memory-issuance-ledger",
    record(entry) {
      entries.push(entry);
      return entry;
    },
    list() {
      return [...entries];
    },
  };
}

export function createCredentialBroker({
  signer,
  clock = () => Date.now(),
  issuer = "urn:platform:credential-broker",
  minTtlSeconds = 5,
  maxTtlSeconds = 3600,
  revocations = null,
  killSwitch = null,
  issuances = createMemoryIssuances(),
  audit = null,
} = {}) {
  assertSigner(signer);
  if (minTtlSeconds < 1) throw new CredentialBrokerError("minTtlSeconds skal være >= 1", "bad_ttl");
  if (maxTtlSeconds < minTtlSeconds) throw new CredentialBrokerError("maxTtlSeconds < minTtlSeconds", "bad_ttl");

  const jwks = () => signersToJwks([signer]);

  function issue({ spiffeId, agentRef, role, tenantId, verb, resource, audience, environment = "staging", taskId = null, ttlSeconds = null, onBehalfOf = null } = {}) {
    if (!spiffeId) throw new CredentialBrokerError("issue kræver en spiffeId", "missing_spiffe_id");
    if (!agentRef) throw new CredentialBrokerError("issue kræver en agentRef", "missing_agent_ref");

    // Nødstop og scope-validering er fail-closed og sker FØR signering.
    killSwitch?.assertAllowed({ tenantId, spiffeId });
    assertIssuableScope({ role, verb, resource, tenantId, environment, audience });

    const ttl = Math.max(minTtlSeconds, Math.min(Number(ttlSeconds) || maxTtlSeconds, maxTtlSeconds));
    const now = Math.floor(clock() / 1000);
    const jti = randomUUID();
    const claims = {
      iss: issuer,
      sub: spiffeId,
      aud: [audience],
      jti,
      iat: now,
      nbf: now,
      exp: now + ttl,
      tenant_id: tenantId,
      agent_ref: agentRef,
      role,
      task_id: taskId,
      scope: { verb, resource, environment },
      ...(onBehalfOf ? { on_behalf_of: onBehalfOf } : {}),
    };
    const token = signJws({ signer, claims });
    const issuance = { jti, spiffeId, agentRef, role, tenantId, verb, resource, audience, environment, taskId, issuedAt: new Date(now * 1000).toISOString(), expiresAt: new Date((now + ttl) * 1000).toISOString() };
    issuances.record?.(issuance);
    audit?.append?.({ type: "credential.issued", verb, target: resource, tenantId, payload: { jti, audience, expiresAt: issuance.expiresAt } });
    return { token, claims, jti, issuance };
  }

  /** Verificér uden scope-krav (til revision/fejlfinding). */
  function introspect(token, expectations = {}) {
    const check = verifyJws({ token, resolveKey: keyResolverFromJwks(jwks()), clock });
    if (!check.ok) return { ok: false, claims: check.claims, reasons: check.reasons };
    const reasons = [];
    if (revocations?.isRevoked({ jti: check.claims.jti, spiffeId: check.claims.sub, tenantId: check.claims.tenant_id }).revoked) reasons.push("credentialet er tilbagekaldt");
    try {
      killSwitch?.assertAllowed({ tenantId: check.claims.tenant_id, spiffeId: check.claims.sub });
    } catch (err) {
      reasons.push(err.message);
    }
    return { ok: reasons.length === 0, claims: check.claims, reasons };
  }

  return { kind: "credential-broker", issuer, jwks, issue, introspect, minTtlSeconds, maxTtlSeconds, issuerId: signer.kid };
}
