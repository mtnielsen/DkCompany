import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign as rsaSign } from "node:crypto";
import { createOidcAuthenticator, createSpiffeAuthenticator, AuthError } from "../src/auth.mjs";

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

test("gyldigt OIDC-token giver en principal", () => {
  const signer = makeSigner();
  const principal = authenticatorFor(signer).authenticate(`Bearer ${signer.sign(basePayload())}`);
  assert.equal(principal.kind, "human");
  assert.equal(principal.id, "oidc|anna");
  assert.equal(principal.tenantId, "acme");
});

test("forkert audience afvises", () => {
  const signer = makeSigner();
  const token = signer.sign({ ...basePayload(), aud: "someone-else" });
  assert.throws(() => authenticatorFor(signer).authenticate(`Bearer ${token}`), /audience/);
});

test("forkert issuer afvises", () => {
  const signer = makeSigner();
  const token = signer.sign({ ...basePayload(), iss: "https://evil.example.org" });
  assert.throws(() => authenticatorFor(signer).authenticate(`Bearer ${token}`), /issuer/);
});

test("udløbet token afvises", () => {
  const signer = makeSigner();
  const token = signer.sign({ ...basePayload(), exp: Math.floor(Date.now() / 1000) - 3600 });
  assert.throws(() => authenticatorFor(signer).authenticate(`Bearer ${token}`), /udløbet/);
});

test("manipuleret signatur afvises", () => {
  const signer = makeSigner();
  const [h, p] = signer.sign(basePayload()).split(".");
  assert.throws(() => authenticatorFor(signer).authenticate(`Bearer ${h}.${p}.bm9wZQ`), /signatur/);
});

test("token uden Bearer afvises", () => {
  const signer = makeSigner();
  assert.throws(() => authenticatorFor(signer).authenticate(signer.sign(basePayload())), AuthError);
});

test("SPIFFE-workload-identitet skal ligge i trust domain", () => {
  const auth = createSpiffeAuthenticator({ trustDomain: "platform.example.org" });
  const principal = auth.authenticate(undefined, { "x-spiffe-id": "spiffe://platform.example.org/agents/x" });
  assert.equal(principal.kind, "agent");
  assert.throws(() => auth.authenticate(undefined, { "x-spiffe-id": "spiffe://evil.example.org/agents/x" }), /trust domain/);
  assert.throws(() => auth.authenticate(undefined, {}), /workload-identitet/);
});
