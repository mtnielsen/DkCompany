export class AuthError extends Error {
  constructor(message) {
    super(message);
    this.name = "AuthError";
    this.status = 401;
  }
}

/**
 * Adapterens lokale identity-shim. I klyngen kommer workload-identiteten fra
 * SPIRE (SPIFFE Workload API); her læses den fra en header, og trust domain
 * skal matche. Menneske-tokens valideres af den centrale IAM/gateway.
 */
export function createSpiffeAuthenticator({ trustDomain }) {
  return {
    authenticate(authHeader, headers = {}) {
      const spiffeId = headers["x-spiffe-id"];
      if (!spiffeId) throw new AuthError("manglende workload-identitet");
      if (trustDomain && !spiffeId.startsWith(`spiffe://${trustDomain}/`)) throw new AuthError("spiffeId er uden for trust domain");
      return { kind: "agent", id: spiffeId, spiffeId };
    },
  };
}

export function createAuthenticator(authenticators) {
  return {
    authenticate(authHeader, headers) {
      let lastError;
      for (const a of authenticators) {
        try {
          return a.authenticate(authHeader, headers);
        } catch (err) {
          lastError = err;
        }
      }
      throw lastError ?? new AuthError("kunne ikke autentificere");
    },
  };
}
