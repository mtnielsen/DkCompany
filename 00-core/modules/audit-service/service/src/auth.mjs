import { createPublicKey, verify as cryptoVerify } from "node:crypto";

export class AuthError extends Error {
  constructor(message) {
    super(message);
    this.name = "AuthError";
    this.status = 401;
  }
}

function b64urlDecode(input) {
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

/**
 * OIDC-autentifikation. Verificerer RS256-signatur, issuer, audience og exp.
 * Identitet kommer udefra — servicen har ingen egen brugerdatabase.
 * `jwks` er et JWK-set ({ keys: [...] }), typisk hentet fra IAM.
 */
export function createOidcAuthenticator({ issuer, audience, jwks, clockSkewSeconds = 30, now = () => Date.now() }) {
  return {
    kind: "oidc",
    authenticate(headerValue) {
      if (!headerValue?.startsWith("Bearer ")) throw new AuthError("manglende Bearer-token");
      const token = headerValue.slice("Bearer ".length).trim();
      const parts = token.split(".");
      if (parts.length !== 3) throw new AuthError("token er ikke et JWT");
      const [headerPart, payloadPart, signaturePart] = parts;

      let header;
      let payload;
      try {
        header = JSON.parse(b64urlDecode(headerPart).toString("utf8"));
        payload = JSON.parse(b64urlDecode(payloadPart).toString("utf8"));
      } catch {
        throw new AuthError("kunne ikke afkode JWT");
      }
      if (header.alg !== "RS256") throw new AuthError(`uunderstøttet algoritme '${header.alg}'`);

      const jwk = jwks.keys.find((k) => !header.kid || k.kid === header.kid);
      if (!jwk) throw new AuthError("ukendt signing key");
      const key = createPublicKey({ key: jwk, format: "jwk" });
      const ok = cryptoVerify("RSA-SHA256", Buffer.from(`${headerPart}.${payloadPart}`), key, b64urlDecode(signaturePart));
      if (!ok) throw new AuthError("ugyldig signatur");

      const nowSeconds = Math.floor(now() / 1000);
      if (typeof payload.exp === "number" && payload.exp + clockSkewSeconds < nowSeconds) throw new AuthError("token er udløbet");
      if (payload.iss !== issuer) throw new AuthError("forkert issuer");
      const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
      if (audience && !aud.includes(audience)) throw new AuthError("forkert audience");
      if (!payload.sub) throw new AuthError("token mangler sub");

      return {
        kind: "human",
        id: payload.sub,
        tenantId: payload.tenant_id,
        groups: payload.groups ?? [],
        autonomyClass: undefined,
      };
    },
  };
}

/**
 * Lokal workload-identitet (SPIFFE) til kørsel uden for k8s. I klyngen kommer
 * identiteten fra SPIRE/Workload API; her læses den fra en header, og
 * trust domain skal matche. Bevidst kun til dev/test.
 */
export function createSpiffeAuthenticator({ trustDomain, allowHeader = true }) {
  return {
    kind: "spiffe",
    authenticate(headerValue, headers = {}) {
      const spiffeId = headers["x-spiffe-id"];
      if (!allowHeader || !spiffeId) throw new AuthError("manglende workload-identitet");
      if (!spiffeId.startsWith(`spiffe://${trustDomain}/`)) throw new AuthError("spiffeId er uden for trust domain");
      return { kind: "agent", id: spiffeId, spiffeId };
    },
  };
}

/** Kæde: prøv OIDC, fald tilbage til SPIFFE. */
export function createAuthenticator(authenticators) {
  return {
    authenticate(headerValue, headers) {
      let lastError;
      for (const a of authenticators) {
        try {
          return a.authenticate(headerValue, headers);
        } catch (err) {
          lastError = err;
        }
      }
      throw lastError ?? new AuthError("ingen authenticator kunne autentificere");
    },
  };
}
