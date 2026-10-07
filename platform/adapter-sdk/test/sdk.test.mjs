import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createAdapterSdk } from "../src/sdk.mjs";
import { GovernanceUnavailableError } from "../src/errors.mjs";
import { createMemoryIdempotencyStore } from "../src/idempotency.mjs";

const allowPdp = { decide: async () => ({ decision: "allow", requiredEvidence: ["policy-allow"] }) };
const denyPdp = { decide: async () => ({ decision: "deny", reasons: ["nej"] }) };
const downPdp = { decide: async () => { throw new GovernanceUnavailableError("PDP timeout"); } };

async function setup({ pdp = allowPdp, idempotency = null, upstream = null, authenticate, handler } = {}) {
  const events = [];
  const sdk = createAdapterSdk({
    serviceName: "test-adapter",
    version: "1.0.0",
    authenticate: authenticate ?? (async (auth, headers) => {
      if (headers["x-test-identity"] === "none") throw new Error("manglende identitet");
      return { kind: "agent", id: "spiffe://platform.example.org/agents/test", tenantId: headers["x-test-tenant"] ?? "acme" };
    }),
    pdp,
    idempotency,
    upstream,
    onEvent: (e) => events.push(e),
  });
  const server = createServer((req, res) => {
    const pathname = new URL(req.url, "http://localhost").pathname;
    if (req.method === "GET" && pathname === "/healthz") return sdk.health().then(({ code, body }) => sdk.respond(res, code, body));
    if (req.method === "POST" && pathname === "/erase") return sdk.guard(req, res, "subject.erase", handler);
    if (req.method === "POST" && pathname === "/unsupported") {
      return sdk.guard(req, res, "subject.erase", handler, { upstreamVersion: "11.0.0" });
    }
    return sdk.respond(res, 404, { error: "not found" });
  });
  const port = await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
  const call = (path, { method = "POST", headers = {}, body } = {}) =>
    fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { "content-type": "application/json", ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }).then(async (res) => ({ status: res.status, headers: Object.fromEntries(res.headers), body: await res.json().catch(() => null) }));
  return { sdk, events, call, close: () => new Promise((resolve) => server.close(resolve)) };
}

const evidence = { evidence: ["policy-allow"] };

test("health er ok når upstream pinger", async () => {
  const { call, close } = await setup({ upstream: { name: "up", ping: async () => {} } });
  try {
    const res = await call("/healthz", { method: "GET" });
    assert.equal(res.status, 200);
    assert.equal(res.body.upstream, "up");
  } finally {
    await close();
  }
});

test("manglende verificerbar identitet giver 401", async () => {
  const { call, close } = await setup({ handler: async () => ({ ok: true }) });
  try {
    const res = await call("/erase", { headers: { "x-test-identity": "none" }, body: evidence });
    assert.equal(res.status, 401);
  } finally {
    await close();
  }
});

test("tenant udledes af principalen og en fremmed påstand afvises", async () => {
  const { call, close } = await setup({ handler: async () => ({ ok: true }) });
  try {
    const res = await call("/erase", { body: { ...evidence, tenantId: "globex" } });
    assert.equal(res.status, 403);
    assert.equal(res.body.code, "tenant_mismatch");
  } finally {
    await close();
  }
});

test("deny giver 403 og fail-closed PDP-nedbrud giver 503", async () => {
  const denied = await setup({ pdp: denyPdp, handler: async () => ({ ok: true }) });
  const down = await setup({ pdp: downPdp, handler: async () => ({ ok: true }) });
  try {
    assert.equal((await denied.call("/erase", { body: evidence })).status, 403);
    const res = await down.call("/erase", { body: evidence });
    assert.equal(res.status, 503);
    assert.equal(res.body.failMode, "closed");
  } finally {
    await denied.close();
    await down.close();
  }
});

test("idempotens: replay udfører ikke handlingen igen, og konflikt giver 409", async () => {
  let calls = 0;
  const { call, close } = await setup({
    idempotency: createMemoryIdempotencyStore(),
    handler: async () => { calls += 1; return { recordsAffected: 1 }; },
  });
  try {
    const body = { ...evidence, idempotencyKey: "k-1" };
    const first = await call("/erase", { body });
    const second = await call("/erase", { body });
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(second.body.replayed, true);
    assert.equal(calls, 1, "upstream må kun kaldes én gang");
    const conflict = await call("/erase", { body: { ...body, target: "andet" } });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.code, "idempotency_conflict");
  } finally {
    await close();
  }
});

test("versionsskift afvises før PDP, når versionen ikke er understøttet", async () => {
  const { call, close } = await setup({
    upstream: { name: "up", version: "10.0.0", supportedRanges: ["^10.0.0"], supportedEditions: ["Enterprise"], edition: "Enterprise" },
    handler: async () => ({ ok: true }),
  });
  try {
    const supported = await call("/erase", { body: evidence });
    assert.equal(supported.status, 200);
    const unsupported = await call("/unsupported", { body: evidence });
    assert.equal(unsupported.status, 409);
    assert.equal(unsupported.body.code, "version_unsupported");
  } finally {
    await close();
  }
});

test("rate limit bevares som 429 med Retry-After", async () => {
  const error = new Error("for mange kald");
  error.status = 429;
  error.retryAfterSeconds = 42;
  const { call, close } = await setup({ handler: async () => { throw error; } });
  try {
    const res = await call("/erase", { body: evidence });
    assert.equal(res.status, 429);
    assert.equal(res.headers["retry-after"], "42");
  } finally {
    await close();
  }
});
