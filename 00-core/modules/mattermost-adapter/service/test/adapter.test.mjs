import { test } from "node:test";
import assert from "node:assert/strict";
import { createMattermostAdapter } from "../src/server.mjs";
import { createMattermostClient } from "../src/mattermost.mjs";
import { createMockMattermost } from "../src/mock-mattermost.mjs";
import { createSpiffeAuthenticator } from "../src/auth.mjs";
import { GovernanceUnavailable } from "../src/pdp-client.mjs";

const allowPdp = { decide: async () => ({ decision: "allow", requiredEvidence: ["policy-allow"] }) };
const denyPdp = { decide: async () => ({ decision: "deny", reasons: ["nej"], matchedRules: ["r"] }) };
const downPdp = { decide: async () => { throw new GovernanceUnavailable("timeout"); } };

async function setup(pdp) {
  const mock = createMockMattermost();
  const mockPort = await mock.listen(0);
  const adapter = createMattermostAdapter({
    authenticate: createSpiffeAuthenticator({ trustDomain: "platform.example.org" }),
    pdp,
    client: createMattermostClient({ baseUrl: `http://127.0.0.1:${mockPort}`, token: "test-token" }),
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

test("health spejler upstreams ping", async () => {
  const { call, close } = await setup(allowPdp);
  try {
    const res = await call("/healthz", { method: "GET" });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).upstream, "mattermost");
  } finally {
    await close();
  }
});

test("locate finder brugerens opslag via e-mail", async () => {
  const { call, close } = await setup(allowPdp);
  try {
    const res = await call("/v1/privacy/locate", { body: { identifiers: [{ type: "email", value: "kunde@example.org" }], evidence: ["policy-allow"] } });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.result.count, 2);
  } finally {
    await close();
  }
});

test("export returnerer opslagene", async () => {
  const { call, close } = await setup(allowPdp);
  try {
    const body = await (await call("/v1/privacy/export", { body: { identifiers: [{ type: "email", value: "kunde@example.org" }], evidence: ["policy-allow"] } })).json();
    assert.equal(body.result.count, 2);
    assert.ok(body.result.records.some((r) => r.message === "hej fra kunden"));
  } finally {
    await close();
  }
});

test("erase sletter opslag, men erkender partial", async () => {
  const { mock, call, close } = await setup(allowPdp);
  try {
    const res = await call("/v1/privacy/erase", { body: { identifiers: [{ type: "email", value: "kunde@example.org" }], evidence: ["policy-allow"] } });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.result.recordsAffected, 2);
    assert.equal(body.result.partial, true);
    assert.ok(body.result.note.includes("backup"));
    assert.equal(mock.posts.length, 0, "upstreams opslag skal være slettet");
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
    assert.equal(mock.posts.length, 2, "intet må slettes uden governance");
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
