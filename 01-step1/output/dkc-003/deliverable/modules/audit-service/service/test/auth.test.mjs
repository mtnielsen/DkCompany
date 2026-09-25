import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign as rsaSign } from "node:crypto";
import { createOidcAuthenticator, createSpiffeAuthenticator, AuthError } from "../src/auth.mjs";
import { assertionSignature } from "../../../../identity/src/identity.mjs";

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function makeSigner() {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };
  return {
    jwk,
    sign(payload) {
      const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "k1" }));
      const body = b64url(JSON.stringify(payload));
      const signature = b64url(rsaSign("RSA-SHA256", Buffer.from(`${header}.${body}`), privateKey));
      return `${header}.${body}.${signature}`;
    },
  };
}

const basePayload = () => ({
  sub: "oidc|anna",
  iss: "https://id.example.org",
  aud: "audit-service",
  exp: Math.floor(Date.now() / 1000) + 3600,
  tenant_id: "acme",
});

function authenticatorFor(signer, overrides = {}) {
  return createOidcAuthenticator({
    issuer: "https://id.example.org",
    audience: "audit-service",
    jwks: { keys: [signer.jwk] },
    ...overrides,
  });
}

test("gyldigt OIDC-token giver en principal", async () => {
  const signer = makeSigner();
  const principal = await authenticatorFor(signer).authenticate(`Bearer ${signer.sign(basePayload())}`);
  assert.equal(principal.kind, "human");
  assert.equal(principal.id, "oidc|anna");
  assert.equal(principal.tenantId, "acme");
});

test("forkert audience afvises", async () => {
  const signer = makeSigner();
  await assert.rejects(() => authenticatorFor(signer).authenticate(`Bearer ${signer.sign({ ...basePayload(), aud: "someone-else" })}`), /audience/);
});

test("forkert issuer afvises", async () => {
  const signer = makeSigner();
  await assert.rejects(() => authenticatorFor(signer).authenticate(`Bearer ${signer.sign({ ...basePayload(), iss: "https://evil.example.org" })}`), /issuer/);
});

test("udløbet token afvises", async () => {
  const signer = makeSigner();
  await assert.rejects(() => authenticatorFor(signer).authenticate(`Bearer ${signer.sign({ ...basePayload(), exp: Math.floor(Date.now() / 1000) - 3600 })}`), /udløbet/);
});

test("manipuleret signatur afvises", async () => {
  const signer = makeSigner();
  const [h, p] = signer.sign(basePayload()).split(".");
  await assert.rejects(() => authenticatorFor(signer).authenticate(`Bearer ${h}.${p}.bm9wZQ`), /signatur/);
});

test("token uden Bearer afvises", async () => {
  const signer = makeSigner();
  await assert.rejects(() => authenticatorFor(signer).authenticate(signer.sign(basePayload())), AuthError);
});

test("forfalsket x-spiffe-id afvises", async () => {
  const auth = createSpiffeAuthenticator({ trustDomain: "platform.example.org" });
  await assert.rejects(() => auth.authenticate(undefined, { "x-spiffe-id": "spiffe://platform.example.org/agents/x" }), /verificerbar/);
});

test("workload-identitet kommer fra mTLS-SVID eller betroet proxy", async () => {
  const auth = createSpiffeAuthenticator({ trustDomain: "platform.example.org", trustedProxies: ["127.0.0.1"], proxySecret: "s" });
  const viaMtls = await auth.authenticate(undefined, {}, { peerCertificate: { subjectaltname: "URI:spiffe://platform.example.org/agents/x" } });
  assert.equal(viaMtls.kind, "agent");
  assert.equal(viaMtls.transport, "mtls");

  const ts = Math.floor(Date.now() / 1000);
  const assertion = `spiffe://platform.example.org/agents/x||${ts}|${assertionSignature({ spiffeId: "spiffe://platform.example.org/agents/x", tenantId: "", timestamp: ts }, "s")}`;
  const viaProxy = await auth.authenticate(undefined, { "x-platform-assertion": assertion }, { remoteAddress: "127.0.0.1" });
  assert.equal(viaProxy.transport, "trusted-proxy");

  await assert.rejects(() => auth.authenticate(undefined, { "x-platform-assertion": assertion }, { remoteAddress: "10.0.0.9" }), /utillid/);
  await assert.rejects(() => auth.authenticate(undefined, {}, { peerCertificate: { subjectaltname: "URI:spiffe://evil.example.org/agents/x" } }), /trust domain/);
});

test("demo-shim kan ikke starte i produktionsprofil", () => {
  assert.throws(() => createSpiffeAuthenticator({ trustDomain: "platform.example.org", profile: "production", demo: { enabled: true } }), /produktionsprofil/);
});
