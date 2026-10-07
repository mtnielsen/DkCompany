import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { createJwksResolver, signJwt, verifyJwt } from "../src/jwt.mjs";

const now = () => Date.UTC(2026, 8, 23, 10, 0, 0);
const nowSeconds = Math.floor(now() / 1000);

function rsaKey(kid) {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" });
  return { kid, jwk: { ...jwk, kid, alg: "RS256", use: "sig" }, privateKey };
}

const keyA = rsaKey("key-a");
const keyB = rsaKey("key-b");
const keyC = rsaKey("key-c");

function token(overrides = {}, { alg = "RS256", key = keyA.privateKey, kid = keyA.kid } = {}) {
  return signJwt(
    {
      sub: "user-1",
      iss: "https://id.example.org/realms/platform",
      aud: "dkcompany-portal",
      tenant_id: "acme",
      roles: ["approver"],
      iat: nowSeconds,
      exp: nowSeconds + 300,
      ...overrides,
    },
    { alg, key, kid }
  );
}

const baseConfig = {
  issuer: "https://id.example.org/realms/platform",
  audience: "dkcompany-portal",
  expectedTenant: "acme",
  now,
};

test("gyldigt RS256-token verificeres og bærer subject, roller og tenant", async () => {
  const payload = await verifyJwt(token(), { ...baseConfig, jwks: { keys: [keyA.jwk] } });
  assert.equal(payload.sub, "user-1");
  assert.equal(payload.tenantId, "acme");
  assert.deepEqual(payload.roles, ["approver"]);
});

test("forfalsket signatur afvises", async () => {
  const t = token();
  const [h, p] = t.split(".");
  const forged = `${h}.${p}.${Buffer.from("not-a-signature").toString("base64url")}`;
  await assert.rejects(() => verifyJwt(forged, { ...baseConfig, jwks: { keys: [keyA.jwk] } }), /signatur|ukendt/i);
});

test("forkert audience afvises", async () => {
  await assert.rejects(
    () => verifyJwt(token({ aud: "some-other-app" }), { ...baseConfig, jwks: { keys: [keyA.jwk] } }),
    /audience/
  );
});

test("udløbet token afvises", async () => {
  await assert.rejects(
    () => verifyJwt(token({ exp: nowSeconds - 120 }), { ...baseConfig, jwks: { keys: [keyA.jwk] } }),
    /udløbet/
  );
});

test("token fra en anden kunde afvises", async () => {
  await assert.rejects(
    () => verifyJwt(token({ tenant_id: "other-tenant" }), { ...baseConfig, jwks: { keys: [keyA.jwk] } }),
    /anden tenant/
  );
});

test("ukendt signeringsnøgle afvises", async () => {
  await assert.rejects(
    () => verifyJwt(token({}, { key: keyB.privateKey, kid: "key-b" }), { ...baseConfig, jwks: { keys: [keyA.jwk] } }),
    /ukendt signing key/
  );
});

test("ukendt nøgle afvises selv efter rotation, og rotation accepterer den nye nøgle", async () => {
  let calls = 0;
  const resolver = createJwksResolver({
    initial: { keys: [keyA.jwk] },
    refresh: async () => {
      calls += 1;
      return { keys: [keyB.jwk] };
    },
    now,
  });
  // key-c findes hverken før eller efter genindlæsning → afvises.
  await assert.rejects(() => verifyJwt(token({}, { key: keyC.privateKey, kid: "key-c" }), { ...baseConfig, jwks: resolver }), /ukendt/);
  // key-b hentes ved at genindlæse sættet (nøglerotation).
  const payload = await verifyJwt(token({}, { key: keyB.privateKey, kid: "key-b" }), { ...baseConfig, jwks: resolver });
  assert.equal(payload.sub, "user-1");
  assert.ok(calls >= 1, "forventede at JWKS blev genindlæst");
});

test("alg: none afvises", async () => {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ sub: "x", iss: baseConfig.issuer, aud: baseConfig.audience })).toString("base64url");
  await assert.rejects(() => verifyJwt(`${header}.${payload}.`, { ...baseConfig, jwks: { keys: [keyA.jwk] } }), /algoritme|signatur/);
});

test("forkert issuer afvises", async () => {
  await assert.rejects(
    () => verifyJwt(token({ iss: "https://evil.example.net" }), { ...baseConfig, jwks: { keys: [keyA.jwk] } }),
    /issuer/
  );
});
