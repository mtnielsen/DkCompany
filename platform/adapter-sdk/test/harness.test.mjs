import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createAdapterSdk } from "../src/sdk.mjs";
import { createFaultPlan, runAdapterHarness, HARNESS_CATEGORIES } from "../src/harness.mjs";
import { createMemoryIdempotencyStore } from "../src/idempotency.mjs";

function makeUpstreamState() {
  return {
    posts: { order: ["p1"], posts: { p1: { id: "p1", message: "hej" } } },
    user: { id: "u1", email: "kunde@example.org" },
  };
}

function makeClient(state) {
  return {
    ping: async () => ({ status: "OK" }),
    getUserByEmail: async () => state.user,
    getPostsForUser: async () => ({ order: [...state.posts.order], posts: { ...state.posts.posts } }),
    deletePost: async (id) => {
      state.posts.order = state.posts.order.filter((p) => p !== id);
      delete state.posts.posts[id];
      return { status: "OK" };
    },
  };
}

async function setup() {
  const state = makeUpstreamState();
  const plan = createFaultPlan();
  const faulty = plan.wrap(makeClient(state));
  const sdk = createAdapterSdk({
    serviceName: "harness-adapter",
    idempotency: createMemoryIdempotencyStore(),
    upstream: { name: "upstream", version: "10.0.0", supportedRanges: ["^10.0.0"], supportedEditions: ["Enterprise"], edition: "Enterprise" },
    authenticate: async (auth, headers) => {
      if (!headers.authorization) throw new Error("manglende identitet");
      return { kind: "agent", id: "spiffe://platform.example.org/agents/harness", tenantId: headers["x-principal-tenant"] ?? "acme" };
    },
    pdp: { decide: async () => ({ decision: "allow", requiredEvidence: ["policy-allow"] }) },
  });
  const server = createServer((req, res) => {
    const pathname = new URL(req.url, "http://localhost").pathname;
    if (req.method === "GET" && pathname === "/healthz") return sdk.health().then(({ code, body }) => sdk.respond(res, code, body));
    if (req.method === "POST" && pathname === "/v1/privacy/locate") {
      return sdk.guard(req, res, "subject.locate", async () => ({ count: state.posts.order.length }));
    }
    if (req.method === "POST" && pathname === "/v1/privacy/erase") {
      return sdk.guard(req, res, "subject.erase", async () => {
        for (const id of state.posts.order) await faulty.deletePost(id);
        return { recordsAffected: 1, partial: true, note: "backups er ikke rørt" };
      });
    }
    if (req.method === "POST" && pathname === "/v1/ops/backup") {
      return sdk.guard(req, res, "backup", async () => ({ supported: false, partial: true, note: "backup er driftniveau" }));
    }
    return sdk.respond(res, 404, { error: "not found" });
  });
  const port = await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
  const call = ({ path, method = "POST", headers = {}, body } = {}) =>
    fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { "content-type": "application/json", ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }).then(async (res) => ({ status: res.status, headers: Object.fromEntries(res.headers), body: await res.json().catch(() => null) }));
  return { sdk, plan, call, state, close: () => new Promise((resolve) => server.close(resolve)) };
}

test("harness dækker alle seks godkendelseskategorier og består mod en korrekt adapter", async () => {
  const { plan, call, close } = await setup();
  try {
    const report = await runAdapterHarness({
      name: "harness-adapter",
      call,
      plan,
      profile: {
        mutatingOperation: "deletePost",
        supportedVersion: "10.0.0",
        unsupportedVersion: "11.0.0",
        versionProbe: async (v) => (await import("../src/version.mjs")).negotiateUpstreamVersion({ upstreamVersion: v, supportedRanges: ["^10.0.0"], supportedEditions: ["Enterprise"], edition: "Enterprise" }),
        backupPath: "/v1/ops/backup",
        backupConformance: "partial",
        adminBypassPaths: ["/admin/realms", "/api/v4/config"],
      },
      sample: {
        tenant: "acme",
        foreignTenant: "globex",
        identities: { agent: { authorization: "Bearer test", "x-principal-tenant": "acme" } },
      },
    });
    assert.equal(report.ok, true, JSON.stringify(report.checks.filter((c) => c.status === "fail"), null, 2));
    for (const category of ["api-error", "rate-limit", "version-change", "backup", "negative-access", "idempotency", "admin-bypass"]) {
      const found = report.checks.filter((c) => c.category === category);
      assert.ok(found.length >= 1, `manglende kategori ${category}`);
      assert.ok(found.every((c) => c.status !== "fail"), `kategori ${category} fejlede`);
    }
    assert.ok(HARNESS_CATEGORIES.length === 6);
  } finally {
    await close();
  }
});

test("harness fanger en adapter der svarer 200 på en upstream-fejl", async () => {
  const { plan, call, close } = await setup();
  try {
    // Ødelæg adapteren: returnér 200 selv når upstream fejler.
    const badCall = async (req) => {
      const res = await call(req);
      if (res.status === 502) return { status: 200, headers: {}, body: { result: { recordsAffected: 1 } } };
      return res;
    };
    const report = await runAdapterHarness({
      name: "broken-adapter",
      call: badCall,
      plan,
      profile: { mutatingOperation: "deletePost", adminBypassPaths: ["/admin/realms"] },
      sample: { identities: { agent: { authorization: "Bearer test", "x-principal-tenant": "acme" } } },
    });
    assert.equal(report.ok, false);
    assert.ok(report.checks.some((c) => c.category === "api-error" && c.status === "fail"));
  } finally {
    await close();
  }
});
