import { test } from "node:test";
import assert from "node:assert/strict";
import { createKeycloakAdapter } from "../src/server.mjs";
import { createKeycloakClient } from "../src/keycloak.mjs";
import { createMockKeycloak } from "../src/mock-keycloak.mjs";
import { createSpiffeAuthenticator } from "../src/auth.mjs";
import { GovernanceUnavailable } from "../src/pdp-client.mjs";

const allowPdp = { decide: async () => ({ decision: "allow", requiredEvidence: ["policy-allow"] }) };
const denyPdp = { decide: async () => ({ decision: "deny", reasons: ["nej"], matchedRules: ["r"] }) };
const downPdp = { decide: async () => { throw new GovernanceUnavailable("timeout"); } };

async function setup(pdp) {
  const mock = createMockKeycloak();
  const mockPort = await mock.listen(0);
  const adapter = createKeycloakAdapter({
    authenticate: createSpiffeAuthenticator({ trustDomain: "platform.example.org" }),
    pdp,
    client: createKeycloakClient({ baseUrl: `http://127.0.0.1:${mockPort}`, realm: "platform", token: "test-token" }),
  });
  const port = await adapter.listen(0);
  const call = (path, { method = "POST", body, headers = {} } = {}) =>
    fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { "content-type": "application/json", "x-spiffe-id": "spiffe://platform.example.org/agents/x", ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  return { mock, port, call, close: async () => { await adapter.close(); await mock.close(); } };
}

test("health spejler upstreams realm-info", async () => {
  const { call, close } = await setup(allowPdp);
  try {
    const res = await call("/healthz", { method: "GET" });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).upstream, "keycloak");
  } finally {
    await close();
  }
});

test("locate finder bruger, sessioner og hændelser via e-mail", async () => {
  const { call, close } = await setup(allowPdp);
  try {
    const res = await call("/v1/privacy/locate", { body: { identifiers: [{ type: "email", value: "kunde@example.org" }], evidence: ["policy-allow"] } });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.result.count, 3, "1 bruger + 1 session + 1 hændelse");
    assert.equal(body.result.matches[0].subjectId, "u1");
  } finally {
    await close();
  }
});

test("export returnerer bruger, sessioner og hændelser", async () => {
  const { call, close } = await setup(allowPdp);
  try {
    const body = await (await call("/v1/privacy/export", { body: { identifiers: [{ type: "email", value: "kunde@example.org" }], evidence: ["policy-allow"] } })).json();
    assert.equal(body.result.count, 3);
    assert.ok(body.result.records.some((r) => r.type === "user" && r.value.email === "kunde@example.org"));
    assert.ok(body.result.records.some((r) => r.type === "event"));
  } finally {
    await close();
  }
});

test("erase sletter brugeren, men erkender partial og lader event-loggen stå", async () => {
  const { mock, call, close } = await setup(allowPdp);
  try {
    const res = await call("/v1/privacy/erase", { body: { identifiers: [{ type: "email", value: "kunde@example.org" }], evidence: ["policy-allow"] } });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.result.recordsAffected, 1);
    assert.equal(body.result.partial, true);
    assert.match(body.result.note, /event-store/i);
    assert.equal(mock.users.size, 0, "brugeren skal være slettet upstream");
    assert.equal(mock.events.length, 1, "event-loggen er den ærlige partial-grænse");
  } finally {
    await close();
  }
});

test("deny stopper handlingen", async () => {
  const { call, close } = await setup(denyPdp);
  try {
    const res = await call("/v1/privacy/erase", { body: { identifiers: [{ type: "email", value: "kunde@example.org" }] } });
    assert.equal(res.status, 403);
  } finally {
    await close();
  }
});

test("utilgængelig PDP betyder ingen sletning (fail-closed)", async () => {
  const { mock, call, close } = await setup(downPdp);
  try {
    const res = await call("/v1/privacy/erase", { body: { identifiers: [{ type: "email", value: "kunde@example.org" }] } });
    assert.equal(res.status, 503);
    assert.equal(mock.users.size, 1, "intet må slettes uden governance");
  } finally {
    await close();
  }
});

test("manglende workload-identitet afvises", async () => {
  const { port, close } = await setup(allowPdp);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/v1/privacy/locate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identifiers: [{ type: "email", value: "kunde@example.org" }] }),
    });
    assert.equal(res.status, 401);
  } finally {
    await close();
  }
});
