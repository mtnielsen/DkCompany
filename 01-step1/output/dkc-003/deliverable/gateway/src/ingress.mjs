/**
 * DKC-003 — ingress-proxy.
 *
 * Gatewayen er den eneste vej ind. Den fjerner alle klientleverede
 * identitetsheadere, verificerer OIDC-tokenet og videresender en signeret
 * principal-assertion. Tokenet selv videresendes ikke, og downstream-tjenester
 * accepterer kun den signerede assertion fra en betroet adresse.
 */
import { AuthenticationError } from "../../identity/src/errors.mjs";
import { assertionSignature, principalAssertion, stripIdentityHeaders } from "../../identity/src/identity.mjs";
import { verifyJwt } from "../../identity/src/jwt.mjs";

/** Fjern også klientleverede assertions; de må kun komme fra gatewayen. */
export function stripAllIdentityHeaders(headers = {}) {
  const clean = stripIdentityHeaders(headers);
  delete clean["x-platform-assertion"];
  delete clean["x-platform-principal"];
  return clean;
}

/** Verificér brugerens token ved ingress og udled principalen. */
export async function resolveIngressPrincipal({ headers, oidc, now }) {
  const clean = stripAllIdentityHeaders(headers);
  const auth = clean.authorization;
  if (!oidc || typeof auth !== "string" || !auth.startsWith("Bearer ")) {
    throw new AuthenticationError("ingen verificerbar identitet ved ingress");
  }
  const payload = await verifyJwt(auth.slice("Bearer ".length).trim(), { ...oidc, ...(now ? { now } : {}) });
  if (!payload.tenantId) throw new AuthenticationError("token mangler tenantbinding");
  return { kind: "human", id: payload.sub, tenantId: payload.tenantId, roles: payload.roles ?? [] };
}

/**
 * Byg de headere, gatewayen sender videre: ingen klientidentitet, intet token,
 * men en signeret principal-assertion (og en workload-assertion for gatewayen).
 */
export function forwardHeaders({ headers, principal, proxySecret, gatewaySpiffeId, now = () => Date.now() }) {
  const clean = stripAllIdentityHeaders(headers);
  delete clean.authorization;
  const timestamp = Math.floor(now() / 1000);
  clean["x-platform-principal"] = principalAssertion(principal, { secret: proxySecret, now });
  clean["x-platform-assertion"] = `${gatewaySpiffeId}|${principal.tenantId ?? ""}|${timestamp}|${assertionSignature(
    { spiffeId: gatewaySpiffeId, tenantId: principal.tenantId, timestamp },
    proxySecret
  )}`;
  return clean;
}
