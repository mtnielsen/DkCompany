import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { assertionSignature, createPlatformAuthenticator, createWorkloadVerifier } from "../src/identity.mjs";
import { signJwt } from "../src/jwt.mjs";
import { createCsrfToken, createRateLimiter, issueSession } from "../src/session.mjs";
import { startSecureServer } from "../src/server.mjs";

const now = () => Date.UTC(2026, 8, 23, 10, 0, 0);
const nowSeconds = Math.floor(now() / 1000);
const sessionSecret = "session-secret";
const proxySecret = "proxy-secret";

async function startServer(t, { maxBytes = 4096, limit = 100 } = {}) {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256" };
  const sign = (overrides = {}) =>
    signJwt(
      { sub: "user-9", iss: "https://id.example.org/realms/platform", aud: "portal", tenant_id: "acme", roles: ["approver"], exp: nowSeconds + 300, ...overrides },
      { alg: "RS256", key: privateKey, kid: "k1" }
    );

  const authenticator = createPlatformAuthenticator({
    profile: "production",
    oidc: { issuer: "https://id.example.org/realms/platform", audience: "portal", expectedTenant: "acme", jwks: { keys: [jwk] }, now },
    workload: createWorkloadVerifier({ trustDomain: "platform.example.org", trustedProxies: ["127.0.0.1"], proxySecret, now }),
  });
  const server = startSecureServer({
    authenticator,
    sessionSecret,
    maxBytes,
    rateLimiter: createRateLimiter({ limit, windowMs: 1000, now: () => 0 }),
    allowedOrigins: ["https://portal.example.org"],
    handler: async ({ principal, body }) => ({ status: 200, body: { principal, echo: body } }),
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const { port } = server.address();
  return { base: `http://127.0.0.1:${port}`, sign };
}

test("verificeret OIDC-identitet udleder subject og roller; forfalsket header ignoreres", async (t) => {
  const { base, sign } = await startServer(t);
  const res = await fetch(`${base}/v1/whoami`, {
    headers: { authorization: `Bearer ${sign()}`, "x-forwarded-user": "admin", "x-spiffe-id": "spiffe://platform.example.org/evil" },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.principal.id, "user-9");
  assert.deepEqual(body.principal.roles, ["approver"]);
  assert.equal(body.principal.transport, "oidc");
});

test("direkte adgang med forfalsket x-spiffe-id afvises", async (t) => {
  const { base } = await startServer(t);
  const res = await fetch(`${base}/v1/whoami`, { headers: { "x-spiffe-id": "spiffe://platform.example.org/evil" } });
  assert.equal(res.status, 401);
});

test("forkert audience, udløbet token og fremmed tenant afvises", async (t) => {
  const { base, sign } = await startServer(t);
  for (const bad of [sign({ aud: "other" }), sign({ exp: nowSeconds - 100 }), sign({ tenant_id: "other" })]) {
    const res = await fetch(`${base}/v1/whoami`, { headers: { authorization: `Bearer ${bad}` } });
    assert.equal(res.status, 401, JSON.stringify(await res.json()));
  }
});

test("betroet proxy kan bære workload-identitet via signeret assertion", async (t) => {
  const { base } = await startServer(t);
  const ts = Math.floor(now() / 1000);
  const assertion = `spiffe://platform.example.org/ns/gateway|acme|${ts}|${assertionSignature({ spiffeId: "spiffe://platform.example.org/ns/gateway", tenantId: "acme", timestamp: ts }, proxySecret)}`;
  const res = await fetch(`${base}/v1/whoami`, { headers: { "x-platform-assertion": assertion } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.principal.transport, "trusted-proxy");
});

test("overstort request afvises med 413", async (t) => {
  const { base, sign } = await startServer(t, { maxBytes: 256 });
  const res = await fetch(`${base}/v1/data`, {
    method: "POST",
    headers: { authorization: `Bearer ${sign()}`, "content-type": "application/json" },
    body: JSON.stringify({ blob: "x".repeat(1024) }),
  });
  assert.equal(res.status, 413);
});

test("uautoriseret cross-origin write afvises med 403", async (t) => {
  const { base, sign } = await startServer(t);
  const res = await fetch(`${base}/v1/data`, {
    method: "POST",
    headers: { authorization: `Bearer ${sign()}`, "content-type": "application/json", origin: "https://evil.example.net" },
    body: "{}",
  });
  assert.equal(res.status, 403);
});

test("cookie-session kræver CSRF-token på writes", async (t) => {
  const { base, sign } = await startServer(t);
  const sessionValue = issueSession({ principal: { kind: "human", id: "user-9", tenantId: "acme", roles: ["approver"] }, secret: sessionSecret, now });
  const cookie = `platform_session=${sessionValue}`;
  const without = await fetch(`${base}/v1/data`, {
    method: "POST",
    headers: { authorization: `Bearer ${sign()}`, "content-type": "application/json", cookie },
    body: "{}",
  });
  assert.equal(without.status, 403);
  const withToken = await fetch(`${base}/v1/data`, {
    method: "POST",
    headers: { authorization: `Bearer ${sign()}`, "content-type": "application/json", cookie, "x-csrf-token": createCsrfToken(sessionValue, sessionSecret) },
    body: "{}",
  });
  assert.equal(withToken.status, 200);
});

test("rate limit giver 429", async (t) => {
  const { base, sign } = await startServer(t, { limit: 1 });
  const first = await fetch(`${base}/v1/whoami`, { headers: { authorization: `Bearer ${sign()}` } });
  assert.equal(first.status, 200);
  const second = await fetch(`${base}/v1/whoami`, { headers: { authorization: `Bearer ${sign()}` } });
  assert.equal(second.status, 429);
});
