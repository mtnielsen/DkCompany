/**
 * DKC-010 — credential-verifier (modtagersiden).
 *
 * Verifieren har kun den **offentlige** nøgle (JWKS) og kan derfor ikke udstede
 * rettigheder. Den afviser fail-closed hvis:
 *
 *   - signaturen/`alg`/`kid`/tidsclaims er ugyldige (se `jws.mjs`),
 *   - `iss` ikke er den forventede udsteder,
 *   - `aud` ikke indeholder modtagerens audience (tokenet hører til en anden executor),
 *   - `sub` ikke er den forventede agent,
 *   - kunden, verbet, ressourcen eller miljøet falder uden for credentialets scope,
 *   - `jti`/agenten/kunden er tilbagekaldt,
 *   - et nødstop er aktivt for agenten/kunden/globalt.
 */
import { keyResolverFromJwks } from "./keys.mjs";
import { verifyJws } from "./jws.mjs";
import { scopeAllows } from "./scope.mjs";

export function createCredentialVerifier({
  jwks = null,
  resolveKey = null,
  clock = () => Date.now(),
  issuer = null,
  revocations = null,
  killSwitch = null,
  maxSkewSeconds = 5,
} = {}) {
  const resolver = resolveKey ?? (jwks ? keyResolverFromJwks(jwks) : null);
  if (!resolver) throw new Error("createCredentialVerifier kræver et jwks eller en resolveKey");

  function verify(token, expectations = {}) {
    const check = verifyJws({ token, resolveKey: resolver, clock, maxSkewSeconds });
    const reasons = [...check.reasons];
    const claims = check.claims;
    if (!claims) return { ok: false, claims: null, reasons };

    if (issuer && claims.iss !== issuer) reasons.push(`uventet udsteder '${claims.iss}'`);

    if (expectations.audience && !(claims.aud ?? []).includes(expectations.audience)) {
      reasons.push(`tokenet er udstedt til '${(claims.aud ?? []).join(", ")}', ikke '${expectations.audience}'`);
    }
    if (expectations.spiffeId && claims.sub !== expectations.spiffeId) {
      reasons.push(`tokenet tilhører '${claims.sub}', ikke '${expectations.spiffeId}'`);
    }

    const scopeCheck = scopeAllows({ ...(claims.scope ?? {}), tenantId: claims.tenant_id }, {
      verb: expectations.verb,
      resource: expectations.resource,
      environment: expectations.environment,
      tenantId: expectations.tenantId,
    });
    reasons.push(...scopeCheck.problems);

    const revoked = revocations ? revocations.isRevoked({ jti: claims.jti, spiffeId: claims.sub, tenantId: claims.tenant_id }) : { revoked: false };
    if (revoked.revoked) reasons.push(`credentialet er tilbagekaldt (${revoked.entry?.scope ?? "ukendt"})`);

    if (killSwitch) {
      try {
        killSwitch.assertAllowed({ tenantId: claims.tenant_id, spiffeId: claims.sub });
      } catch (err) {
        reasons.push(err.message);
      }
    }

    return { ok: reasons.length === 0, claims, reasons };
  }

  return { kind: "credential-verifier", verify, jwks: () => jwks, issuer };
}
