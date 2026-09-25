import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import {
  CLIENT_IDENTITY_HEADERS,
  assertionSignature,
  createPlatformAuthenticator,
  createWorkloadVerifier,
  parseTrustDomain,
  spiffeIdFromCertificate,
  stripIdentityHeaders,
  verifyProxyAssertion,
} from "../src/identity.mjs";
import { signJwt } from "../src/jwt.mjs";

const now = () => Date.UTC(2026, 8, 23, 10, 0, 0);
const nowSeconds = Math.floor(now() / 1000);

test("klientleverede identitetsheadere fjernes ved ingress", () => {
  const headers = {
    authorization: "Bearer x",
    "x-spiffe-id": "spiffe://platform.example.org/evil",
    "x-forwarded-user": "admin",
    "content-type": "application/json",
  };
  const clean = stripIdentityHeaders(headers);
  assert.deepEqual(Object.keys(clean).sort(), ["authorization", "content-type"]);
  for (const h of CLIENT_IDENTITY_HEADERS) assert.ok(!(h in clean));
});

test("SPIFFE-ID udledes kun af certifikatets URI-SAN, ikke af headers", () => {
  assert.equal(spiffeIdFromCertificate({ subjectaltname: "DNS:x, URI:spiffe://platform.example.org/ns/a" }), "spiffe://platform.example.org/ns/a");
  assert.equal(spiffeIdFromCertificate(null), null);
  assert.equal(parseTrustDomain("spiffe://platform.example.org/ns/a"), "platform.example.org");
});

test("forfalsket x-spiffe-id afvises", () => {
  const verifier = createWorkloadVerifier({ trustDomain: "platform.example.org" });
  assert.throws(() => verifier.verify({ headers: { "x-spiffe-id": "spiffe://platform.example.org/agent" }, remoteAddress: "10.0.0.9" }), /verificerbar/);
});

test("mTLS-SVID i trust domain accepteres, uden for afvises", () => {
  const verifier = createWorkloadVerifier({ trustDomain: "platform.example.org" });
  const ok = verifier.verify({ peerCertificate: { subjectaltname: "URI:spiffe://platform.example.org/ns/agent" } });
  assert.equal(ok.spiffeId, "spiffe://platform.example.org/ns/agent");
  assert.equal(ok.transport, "mtls");
  assert.throws(() => verifier.verify({ peerCertificate: { subjectaltname: "URI:spiffe://evil.example.net/ns/agent" } }), /trust domain/);
});

test("betroet proxy med signeret assertion accepteres, utillidtværdig adresse afvises", () => {
  const secret = "test-proxy-secret";
  const ts = Math.floor(now() / 1000);
  const assertion = `spiffe://platform.example.org/ns/gateway|acme|${ts}|${assertionSignature({ spiffeId: "spiffe://platform.example.org/ns/gateway", tenantId: "acme", timestamp: ts }, secret)}`;
  const verifier = createWorkloadVerifier({ trustDomain: "platform.example.org", trustedProxies: ["127.0.0.1"], proxySecret: secret, now });
  const ok = verifier.verify({ headers: { "x-platform-assertion": assertion }, remoteAddress: "127.0.0.1" });
  assert.equal(ok.transport, "trusted-proxy");
  assert.equal(ok.tenantId, "acme");
  assert.throws(() => verifier.verify({ headers: { "x-platform-assertion": assertion }, remoteAddress: "10.0.0.9" }), /utillid/);
});

test("proxy-assertion med ugyldig signatur afvises", () => {
  const ts = Math.floor(now() / 1000);
  assert.throws(
    () => verifyProxyAssertion(`spiffe://platform.example.org/ns/gateway|acme|${ts}|bogus`, { secret: "test-proxy-secret", trustDomain: "platform.example.org", now }),
    /signatur/
  );
});

test("demo-shim virker kun i testprofil", async () => {
  const testAuth = createPlatformAuthenticator({ profile: "test", demo: { enabled: true, id: "demo|tester", tenantId: "acme", roles: ["operator"] } });
  const principal = await testAuth.authenticate(undefined, {});
  assert.equal(principal.demo, true);
  assert.equal(principal.transport, "demo-shim");

  const prodAuth = createPlatformAuthenticator({ profile: "production" });
  await assert.rejects(() => prodAuth.authenticate(undefined, {}), /verificere/);

  assert.throws(() => createPlatformAuthenticator({ profile: "production", demo: { enabled: true } }), /demo-shim/);
});

test("menneske-identitet udledes af verificeret OIDC-token", async () => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256" };
  const token = signJwt(
    { sub: "user-7", iss: "https://id.example.org/realms/platform", aud: "portal", tenant_id: "acme", roles: ["approver"], exp: nowSeconds + 300 },
    { alg: "RS256", key: privateKey, kid: "k1" }
  );
  const auth = createPlatformAuthenticator({
    profile: "production",
    oidc: { issuer: "https://id.example.org/realms/platform", audience: "portal", expectedTenant: "acme", jwks: { keys: [jwk] }, now },
  });
  const principal = await auth.authenticate(`Bearer ${token}`, {});
  assert.equal(principal.id, "user-7");
  assert.deepEqual(principal.roles, ["approver"]);
  assert.equal(principal.transport, "oidc");
});
