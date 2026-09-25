/**
 * Kompatibilitets-API for modulerne. Modulernes gamle `auth.mjs` re-eksporterer
 * herfra, så der findes én implementering. Rå identitetsheadere accepteres ikke
 * længere; workload-identitet kommer fra mTLS-SVID eller en signeret
 * proxy-assertion.
 */
import { AuthenticationError } from "./errors.mjs";
import { verifyJwt } from "./jwt.mjs";
import { createWorkloadVerifier } from "./identity.mjs";

export class AuthError extends AuthenticationError {}

function toAuthError(err) {
  if (err instanceof AuthError) return err;
  return new AuthError(err?.message ?? String(err));
}

export function createOidcAuthenticator(config = {}) {
  return {
    kind: "oidc",
    async authenticate(authHeader) {
      const header = Array.isArray(authHeader) ? authHeader[0] : authHeader;
      try {
        if (typeof header !== "string" || !header.startsWith("Bearer ")) throw new AuthenticationError("manglende Bearer-token");
        const payload = await verifyJwt(header.slice("Bearer ".length).trim(), config);
        if (config.expectedTenant === undefined && !payload.tenantId && config.requireTenant !== false) {
          throw new AuthenticationError("token mangler tenantbinding");
        }
        return { kind: "human", id: payload.sub, oidcSub: payload.sub, tenantId: payload.tenantId, roles: payload.roles, groups: payload.groups, transport: "oidc" };
      } catch (err) {
        throw toAuthError(err);
      }
    },
  };
}

export function createSpiffeAuthenticator(config = {}) {
  const { profile = "production", demo, ...workload } = config;
  if (demo?.enabled && profile !== "test") {
    throw new Error("demo-shim må ikke være aktiveret i produktionsprofil");
  }
  const verifier = createWorkloadVerifier(workload);
  return {
    kind: "spiffe",
    async authenticate(authHeader, headers = {}, context = {}) {
      try {
        return await verifier.verify({ ...context, headers });
      } catch (err) {
        if (profile === "test" && demo?.enabled) {
          return {
            kind: demo.kind ?? "agent",
            id: demo.id ?? "demo|local",
            spiffeId: demo.id ?? "demo|local",
            tenantId: demo.tenantId,
            roles: demo.roles ?? [],
            transport: "demo-shim",
            demo: true,
          };
        }
        throw toAuthError(err);
      }
    },
  };
}

export function createAuthenticator(authenticators) {
  const chain = Array.isArray(authenticators) ? authenticators : [authenticators];
  return {
    kind: "chain",
    async authenticate(authHeader, headers = {}, context = {}) {
      let last;
      for (const a of chain) {
        try {
          return await a.authenticate(authHeader, headers, context);
        } catch (err) {
          last = err;
        }
      }
      throw last ?? new AuthenticationError("ingen authenticator kunne autentificere");
    },
  };
}
