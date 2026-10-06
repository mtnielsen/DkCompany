import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createAdapterSdk } from "../src/sdk.mjs";
import { createSpiffeAuthenticator } from "../../modules/keycloak-adapter/service/src/auth.mjs";
import { createKeycloakAdapter } from "../../modules/keycloak-adapter/service/src/server.mjs";
import { createMattermostAdapter } from "../../modules/mattermost-adapter/service/src/server.mjs";

const allowPdp = { decide: async () => ({ decision: "allow", requiredEvidence: ["policy-allow"] }) };
const demoPrincipal = { kind: "human", id: "demo|tester", tenantId: "acme", roles: ["operator"], demo: true };
const evidence = { evidence: ["policy-allow"] };

function callTo(port) {
  return (path, { method = "POST", headers = {}, body } = {}) =>
    fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { "content-type": "application/json", ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }).then(async (res) => ({ status: res.status, body: await res.json().catch(() => null) }));
}

test("demo-shim kan ikke konstrueres i produktionsprofil", () => {
  assert.throws(() => createSpiffeAuthenticator({ trustDomain: "platform.example.org", demo: { enabled: true, id: "demo|x" } }), /demo-shim/);
});

test("SDK afviser en demo-principal i produktion og tillader den i test", async () => {
  const makeServer = (profile) =>
    createServer((req, res) => {
      const sdk = createAdapterSdk({ serviceName: "demo-adapter", profile, authenticate: async () => demoPrincipal, pdp: allowPdp });
      sdk.guard(req, res, "subject.locate", async () => ({ count: 0, matches: [] }));
    });
  const prod = makeServer("production");
  const testProfile = makeServer("test");
  const prodPort = await new Promise((resolve) => prod.listen(0, "127.0.0.1", () => resolve(prod.address().port)));
  const testPort = await new Promise((resolve) => testProfile.listen(0, "127.0.0.1", () => resolve(testProfile.address().port)));
  try {
    const denied = await callTo(prodPort)("/v1/privacy/locate", { body: evidence });
    assert.equal(denied.status, 401);
    assert.equal(denied.body.code, "demo_forbidden");
    const allowed = await callTo(testPort)("/v1/privacy/locate", { body: evidence });
    assert.equal(allowed.status, 200);
  } finally {
    await new Promise((r) => prod.close(r));
    await new Promise((r) => testProfile.close(r));
  }
});

function keycloakClient() {
  return {
    ping: async () => ({}),
    getUserByEmail: async () => ({ id: "u1", email: "syntetisk@example.org" }),
    getUserSessions: async () => [],
    getUserEvents: async () => [],
    deleteUser: async () => {},
  };
}

test("keycloak-adapteren afviser en demo-principal uden for testprofilen", async () => {
  const adapter = createKeycloakAdapter({ authenticate: async () => demoPrincipal, pdp: allowPdp, client: keycloakClient(), profile: "production" });
  const port = await adapter.listen(0);
  try {
    const res = await callTo(port)("/v1/privacy/locate", { body: evidence });
    assert.equal(res.status, 401);
    assert.equal(res.body.code, "demo_forbidden");
  } finally {
    await adapter.close();
  }
});

test("mattermost-adapteren afviser en demo-principal uden for testprofilen", async () => {
  const client = {
    ping: async () => ({}),
    getUserByEmail: async () => ({ id: "u1" }),
    getPostsForUser: async () => ({ order: [], posts: {} }),
    deletePost: async () => {},
  };
  const adapter = createMattermostAdapter({ authenticate: async () => demoPrincipal, pdp: allowPdp, client, profile: "production" });
  const port = await adapter.listen(0);
  try {
    const res = await callTo(port)("/v1/privacy/locate", { body: evidence });
    assert.equal(res.status, 401);
    assert.equal(res.body.code, "demo_forbidden");
  } finally {
    await adapter.close();
  }
});
