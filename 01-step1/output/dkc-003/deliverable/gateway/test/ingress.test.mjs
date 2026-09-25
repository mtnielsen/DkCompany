import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { forwardHeaders, resolveIngressPrincipal, stripAllIdentityHeaders } from "../src/ingress.mjs";
import { createPlatformAuthenticator, createWorkloadVerifier } from "../../identity/src/identity.mjs";
import { signJwt } from "../../identity/src/jwt.mjs";

const now = () => Date.UTC(2026, 8, 23, 10, 0, 0);
const nowSeconds = Math.floor(now() / 1000);
const proxySecret = "gateway-secret";
const gatewaySpiffeId = "spiffe://platform.example.org/ns/gateway";

function oidc() {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256" };
  const token = signJwt(
    { sub: "user-1", iss: "https://id.example.org/realms/platform", aud: "portal", tenant_id: "acme", roles: ["approver"], exp: nowSeconds + 300 },
    { alg: "RS256", key: privateKey, kid: "k1" }
  );
  return { issuer: "https://id.example.org/realms/platform", audience: "portal", expectedTenant: "acme", jwks: { keys: [jwk] }, now, token };
}

test("ingress fjerner alle klientleverede identitetsheadere", () => {
  const clean = stripAllIdentityHeaders({
    "x-spiffe-id": "spiffe://platform.example.org/evil",
    "x-platform-principal": "human|admin|acme|admin|0|forged",
    authorization: "Bearer x",
    "content-type": "application/json",
  });
  assert.deepEqual(Object.keys(clean).sort(), ["authorization", "content-type"]);
});

test("gateway verificerer token og videresender signeret principal uden token", async () => {
  const cfg = oidc();
  const principal = await resolveIngressPrincipal({ headers: { authorization: `Bearer ${cfg.token}` }, oidc: cfg, now });
  assert.equal(principal.id, "user-1");
  assert.equal(principal.tenantId, "acme");

  const forwarded = forwardHeaders({
    headers: { authorization: `Bearer ${cfg.token}`, "x-spiffe-id": "spiffe://platform.example.org/evil", "content-type": "application/json" },
    principal,
    proxySecret,
    gatewaySpiffeId,
    now,
  });
  assert.equal(forwarded.authorization, undefined);
  assert.equal(forwarded["x-spiffe-id"], undefined);
  assert.ok(forwarded["x-platform-principal"]);
  assert.ok(forwarded["x-platform-assertion"]);
});

test("downstream afviser direkte adgang, men accepterer gatewayens principal", async () => {
  const cfg = oidc();
  const downstream = createPlatformAuthenticator({
    profile: "production",
    workload: createWorkloadVerifier({ trustDomain: "platform.example.org", trustedProxies: ["127.0.0.1"], proxySecret, now }),
  });

  // Direkte adgang med brugerens token (uden om gatewayen) afvises.
  await assert.rejects(() => downstream.authenticate(`Bearer ${cfg.token}`, {}, { remoteAddress: "10.0.0.9" }), /verificere|workload/);

  // Gennem gatewayen: signeret principal accepteres.
  const principal = await resolveIngressPrincipal({ headers: { authorization: `Bearer ${cfg.token}` }, oidc: cfg, now });
  const forwarded = forwardHeaders({ headers: { authorization: `Bearer ${cfg.token}` }, principal, proxySecret, gatewaySpiffeId, now });
  const verified = await downstream.authenticate(undefined, forwarded, { remoteAddress: "127.0.0.1" });
  assert.equal(verified.id, "user-1");
  assert.deepEqual(verified.roles, ["approver"]);
  assert.equal(verified.transport, "trusted-proxy");
});

test("forfalsket principal-assertion afvises", async () => {
  const downstream = createPlatformAuthenticator({
    profile: "production",
    workload: createWorkloadVerifier({ trustDomain: "platform.example.org", trustedProxies: ["127.0.0.1"], proxySecret, now }),
  });
  await assert.rejects(
    () => downstream.authenticate(undefined, { "x-platform-principal": "human|admin|acme|admin|0|forged" }, { remoteAddress: "127.0.0.1" }),
    /signatur/
  );
});
