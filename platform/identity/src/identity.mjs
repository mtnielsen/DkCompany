/**
 * DKC-003 — verificerbar identitet for mennesker og workloads.
 *
 * Reglen der ikke kan forhandles: en klientleveret header (fx `x-spiffe-id`)
 * beviser intet. Workload-identitet kommer fra en mTLS-SVID eller fra en
 * betroet proxy, der forwards en signeret assertion. Demo-shim kræver
 * eksplicit testprofil og kan ikke starte i produktionsprofil.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { AuthenticationError } from "./errors.mjs";
import { verifyJwt } from "./jwt.mjs";

/** Headere en klient aldrig må kunne bruge til at påstå identitet. */
export const CLIENT_IDENTITY_HEADERS = [
  "x-spiffe-id",
  "x-forwarded-user",
  "x-forwarded-groups",
  "x-auth-request-user",
  "x-auth-request-email",
  "x-auth-request-groups",
  "x-remote-user",
  "x-user",
  "x-actor",
  "x-tenant-id",
  "x-authenticated-user",
  "x-svid",
];

export function stripIdentityHeaders(headers = {}) {
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!CLIENT_IDENTITY_HEADERS.includes(key.toLowerCase())) out[key] = value;
  }
  return out;
}

/** Parse en SPIFFE-ID ud af et X.509-certifikats URI-SAN. */
export function spiffeIdFromCertificate(cert) {
  if (!cert) return null;
  const san = cert.subjectaltname ?? "";
  const match = san.match(/URI:(spiffe:\/\/[^,\s]+)/);
  return match ? match[1] : null;
}

export function parseTrustDomain(spiffeId) {
  const m = /^spiffe:\/\/([^/]+)\//.exec(spiffeId ?? "");
  return m ? m[1] : null;
}

export function assertionSignature({ spiffeId, tenantId, timestamp }, secret) {
  return createHmac("sha256", secret).update(`${spiffeId}|${tenantId ?? ""}|${timestamp}`).digest("base64url");
}

/** Signeret principal-assertion, så en betroet proxy kan videresende den verificerede bruger. */
export function principalAssertion(principal, { secret, now = () => Date.now() } = {}) {
  const ts = Math.floor(now() / 1000);
  const fields = [principal.kind, principal.id, principal.tenantId ?? "", (principal.roles ?? []).join(","), ts];
  const sig = createHmac("sha256", secret).update(fields.join("|")).digest("base64url");
  return `${fields.join("|")}|${sig}`;
}

export function verifyPrincipalAssertion(value, { secret, clockSkewSeconds = 30, now = () => Date.now() } = {}) {
  if (!value) throw new AuthenticationError("manglende principal-assertion");
  const parts = String(value).split("|");
  if (parts.length < 6) throw new AuthenticationError("ugyldig principal-assertion");
  const sig = parts.pop();
  const [kind, id, tenantId, roles, timestamp] = parts;
  const expected = createHmac("sha256", secret).update([kind, id, tenantId ?? "", roles ?? "", timestamp].join("|")).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new AuthenticationError("ugyldig principal-assertion-signatur");
  if (Math.abs(Math.floor(now() / 1000) - Number(timestamp)) > clockSkewSeconds) throw new AuthenticationError("principal-assertion er for gammel");
  return { kind, id, tenantId: tenantId || undefined, roles: roles ? roles.split(",") : [] };
}

export function verifyProxyAssertion(value, { secret, trustDomain, clockSkewSeconds = 30, now = () => Date.now() } = {}) {
  if (!value) throw new AuthenticationError("manglende proxy-assertion");
  const [spiffeId, tenantId, timestamp, signature] = String(value).split("|");
  if (!spiffeId || !timestamp || !signature) throw new AuthenticationError("ugyldig proxy-assertion");
  const expected = assertionSignature({ spiffeId, tenantId, timestamp }, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new AuthenticationError("ugyldig proxy-assertion-signatur");
  if (Math.abs(Math.floor(now() / 1000) - Number(timestamp)) > clockSkewSeconds) throw new AuthenticationError("proxy-assertion er for gammel");
  const td = parseTrustDomain(spiffeId);
  if (trustDomain && td !== trustDomain) throw new AuthenticationError("proxy-assertion er uden for trust domain");
  return { kind: "agent", id: spiffeId, spiffeId, tenantId: tenantId || undefined };
}

function isTrustedProxy(remoteAddress, trustedProxies = []) {
  if (!remoteAddress) return false;
  return trustedProxies.some((p) => remoteAddress === p || remoteAddress.endsWith(p) || p === "*");
}

/**
 * Workload-verifikation. Rækkefølge:
 *   1. mTLS-SVID på socket (foretrukket)
 *   2. Signeret assertion fra en betroet proxy
 * Rå `x-spiffe-id` ignoreres altid.
 */
export function createWorkloadVerifier({ trustDomain, trustedProxies = [], proxySecret, clockSkewSeconds = 30, now = () => Date.now() } = {}) {
  return {
    kind: "workload",
    verify(context = {}) {
      const cert = context.peerCertificate ?? null;
      const svid = spiffeIdFromCertificate(cert);
      if (svid) {
        const td = parseTrustDomain(svid);
        if (trustDomain && td !== trustDomain) throw new AuthenticationError("SVID er uden for trust domain");
        return { kind: "agent", id: svid, spiffeId: svid, transport: "mtls" };
      }

      const principalHeader = context.headers?.["x-platform-principal"];
      if (principalHeader) {
        if (!isTrustedProxy(context.remoteAddress, trustedProxies)) {
          throw new AuthenticationError("principal-assertion fra utillidtværdig adresse");
        }
        if (!proxySecret) throw new AuthenticationError("principal-assertion er ikke konfigureret");
        return { ...verifyPrincipalAssertion(principalHeader, { secret: proxySecret, clockSkewSeconds, now }), transport: "trusted-proxy" };
      }

      const assertion = context.headers?.["x-platform-assertion"];
      if (assertion) {
        if (!isTrustedProxy(context.remoteAddress, trustedProxies)) {
          throw new AuthenticationError("proxy-assertion fra utillidtværdig adresse");
        }
        if (!proxySecret) throw new AuthenticationError("proxy-assertion er ikke konfigureret");
        return { ...verifyProxyAssertion(assertion, { secret: proxySecret, trustDomain, clockSkewSeconds, now }), transport: "trusted-proxy" };
      }

      throw new AuthenticationError("manglende verificerbar workload-identitet");
    },
  };
}

function isValidProfile(profile) {
  return profile === "test" || profile === "production";
}

/**
 * Kombineret authenticator. Læser aldrig klientleverede identitetsheadere.
 * Demo-shim er kun aktiv i `profile: "test"`.
 */
export function createPlatformAuthenticator({ oidc, workload, demo, profile = "production" } = {}) {
  if (!isValidProfile(profile)) throw new Error(`ukendt profil '${profile}' (brug 'test' eller 'production')`);
  if (profile === "production" && demo?.enabled) {
    throw new Error("demo-shim må ikke være aktiveret i produktionsprofil");
  }

  const oidcConfig = oidc ?? null;
  const workloadVerifier = workload ?? null;

  return {
    kind: "platform",
    profile,
    async authenticate(authHeader, headers = {}, context = {}) {
      if (oidcConfig) {
        const header = Array.isArray(authHeader) ? authHeader[0] : authHeader;
        if (typeof header === "string" && header.startsWith("Bearer ")) {
          const payload = await verifyJwt(header.slice("Bearer ".length).trim(), { ...oidcConfig, ...(context.now ? { now: context.now } : {}) });
          if (!payload.tenantId) throw new AuthenticationError("token mangler tenantbinding");
          return {
            kind: "human",
            id: payload.sub,
            oidcSub: payload.sub,
            tenantId: payload.tenantId,
            roles: payload.roles,
            groups: payload.groups,
            issuer: payload.iss,
            transport: "oidc",
          };
        }
      }

      let workloadError;
      if (workloadVerifier) {
        try {
          return await workloadVerifier.verify({ ...context, headers });
        } catch (err) {
          if (!(err instanceof AuthenticationError)) throw err;
          workloadError = err;
          // fald til demo længere nede, hvis profilen tillader det
        }
      }

      if (profile === "test" && demo?.enabled) {
        return {
          kind: demo.kind ?? "human",
          id: demo.id ?? "demo|local",
          tenantId: demo.tenantId ?? "demo",
          roles: demo.roles ?? [],
          groups: demo.groups ?? [],
          transport: "demo-shim",
          demo: true,
        };
      }

      throw workloadError ?? new AuthenticationError("kunne ikke verificere identitet");
    },
  };
}
