/**
 * DKC-003 — fælles OIDC/JWT-verifikation.
 *
 * Verificerer signatur, issuer, audience, udløb/not-before og tenantbinding.
 * Understøtter nøglerotation via et JWKS-resolver, der kan genindlæse sættet,
 * når et ukendt `kid` ses. Afviser altid `alg: none` og ukendte nøgler.
 */
import { createHmac, createPublicKey, createSecretKey, createSign, verify as cryptoVerify } from "node:crypto";
import { AuthenticationError } from "./errors.mjs";

const ALGORITHMS = {
  RS256: { type: "rsa", hash: "RSA-SHA256" },
  RS384: { type: "rsa", hash: "RSA-SHA384" },
  RS512: { type: "rsa", hash: "RSA-SHA512" },
  ES256: { type: "ec", hash: "sha256" },
  ES384: { type: "ec", hash: "sha384" },
  ES512: { type: "ec", hash: "sha512" },
  HS256: { type: "hmac", hash: "sha256", bits: 256 },
  HS384: { type: "hmac", hash: "sha384", bits: 384 },
  HS512: { type: "hmac", hash: "sha512", bits: 512 },
};

function b64urlDecode(input) {
  return Buffer.from(String(input).replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function decodeJson(part, label) {
  try {
    return JSON.parse(b64urlDecode(part).toString("utf8"));
  } catch {
    throw new AuthenticationError(`kunne ikke afkode JWT ${label}`);
  }
}

function signingKeyFor(alg, key) {
  if (ALGORITHMS[alg].type === "hmac") {
    if (typeof key === "string") return createSecretKey(Buffer.from(key, "utf8"));
    if (key?.k) return createSecretKey(b64urlDecode(key.k));
    throw new AuthenticationError("HS256 kræver en delt hemmelighed");
  }
  if (key?.kty) return createPublicKey({ key, format: "jwk" });
  return key;
}

/**
 * JWKS-resolver med rotation. `refresh` kaldes ved koldt start og når et ukendt
 * `kid` ses (eller cachen er udløbet).
 */
export function createJwksResolver({ initial, refresh, cacheTtlMs = 300_000, now = () => Date.now() } = {}) {
  let cache = initial ? { keys: initial.keys ?? initial } : null;
  let fetchedAt = initial ? now() : 0;

  async function load(force = false) {
    if (cache && !force && now() - fetchedAt < cacheTtlMs) return cache;
    if (!refresh) return cache;
    const next = await refresh();
    cache = { keys: next.keys ?? next };
    fetchedAt = now();
    return cache;
  }

  return {
    kind: "jwks-resolver",
    async keys({ force = false } = {}) {
      const set = await load(force);
      if (!set) throw new AuthenticationError("ingen JWKS tilgængelig");
      return set.keys;
    },
    async findKey(kid) {
      let set = await load(false);
      if (!set) throw new AuthenticationError("ingen JWKS tilgængelig");
      let key = selectKey(set.keys, kid);
      if (!key && kid) {
        set = await load(true); // nøglerotation: genindlæs og prøv igen
        key = selectKey(set.keys, kid);
      }
      return key ?? null;
    },
  };
}

function selectKey(keys, kid) {
  if (!Array.isArray(keys)) return null;
  if (kid) return keys.find((k) => k.kid === kid) ?? null;
  return keys.length === 1 ? keys[0] : null;
}

/** Verificér et JWT. Returnerer payloaden, eller kaster `AuthenticationError`. */
export async function verifyJwt(token, { issuer, audience, jwks, hmacSecret, expectedTenant, tenantClaim = "tenant_id", clockSkewSeconds = 30, now = () => Date.now() } = {}) {
  if (typeof token !== "string" || token.length === 0) throw new AuthenticationError("manglende token");
  const parts = token.split(".");
  if (parts.length !== 3) throw new AuthenticationError("token er ikke et JWT");
  const [headerPart, payloadPart, signaturePart] = parts;

  const header = decodeJson(headerPart, "header");
  const payload = decodeJson(payloadPart, "payload");
  if (!header.alg || header.alg === "none") throw new AuthenticationError("usikker eller manglende signeringsalgoritme");
  const algorithm = ALGORITHMS[header.alg];
  if (!algorithm) throw new AuthenticationError(`uunderstøttet algoritme '${header.alg}'`);

  let key = null;
  if (algorithm.type === "hmac") {
    if (!hmacSecret) throw new AuthenticationError("HS256 er ikke konfigureret");
    key = hmacSecret;
  } else {
    const resolver = jwks;
    if (!resolver) throw new AuthenticationError("ingen JWKS konfigureret");
    const candidate = resolver.kind === "jwks-resolver" ? await resolver.findKey(header.kid) : selectKey(resolver.keys ?? resolver, header.kid);
    if (!candidate) throw new AuthenticationError(`ukendt signing key '${header.kid ?? "<intet kid>"}'`);
    key = candidate;
  }

  let ok;
  try {
    ok = cryptoVerify(algorithm.hash, Buffer.from(`${headerPart}.${payloadPart}`), signingKeyFor(header.alg, key), b64urlDecode(signaturePart));
  } catch (err) {
    throw new AuthenticationError(`kunne ikke verificere signatur: ${err.message}`);
  }
  if (!ok) throw new AuthenticationError("ugyldig signatur");

  const nowSeconds = Math.floor(now() / 1000);
  if (typeof payload.exp === "number" && payload.exp + clockSkewSeconds < nowSeconds) throw new AuthenticationError("token er udløbet");
  if (typeof payload.nbf === "number" && payload.nbf - clockSkewSeconds > nowSeconds) throw new AuthenticationError("token er ikke gyldigt endnu");
  if (!payload.sub) throw new AuthenticationError("token mangler sub");
  if (issuer && payload.iss !== issuer) throw new AuthenticationError("forkert issuer");
  if (audience) {
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!aud.includes(audience)) throw new AuthenticationError("forkert audience");
  }
  if (expectedTenant !== undefined && expectedTenant !== null) {
    if (payload[tenantClaim] !== expectedTenant) throw new AuthenticationError("token tilhører en anden tenant");
  }

  const roles = payload.roles ?? payload.realm_access?.roles ?? [];
  const groups = payload.groups ?? [];
  return {
    ...payload,
    tenantId: payload[tenantClaim],
    roles,
    groups,
  };
}

/** Signér et JWT (til tests og lokale dev-tools). Understøtter HS256 og RS256. */
export function signJwt(payload, { alg = "HS256", key, kid, header = {} } = {}) {
  const h = { alg, typ: "JWT", ...(kid ? { kid } : {}), ...header };
  const encode = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const signingInput = `${encode(h)}.${encode({ iat: Math.floor(Date.now() / 1000), ...payload })}`;
  let signature;
  if (alg === "HS256") {
    signature = createHmac("sha256", key).update(signingInput).digest("base64url");
  } else if (alg === "RS256") {
    signature = createSign("RSA-SHA256").update(signingInput).sign(key, "base64url");
  } else {
    throw new AuthenticationError(`signJwt understøtter ikke '${alg}'`);
  }
  return `${signingInput}.${signature}`;
}
