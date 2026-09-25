import { test } from "node:test";
import assert from "node:assert/strict";
import { createMattermostAdapter } from "../src/server.mjs";
import { createMattermostClient } from "../src/mattermost.mjs";
import { createMockMattermost } from "../src/mock-mattermost.mjs";
import { createSpiffeAuthenticator } from "../src/auth.mjs";
import { assertionSignature } from "../../../../identity/src/identity.mjs";
import { createMemoryIdempotencyStore } from "../../../../adapter-sdk/src/idempotency.mjs";
import { createFaultPlan, runAdapterHarness } from "../../../../adapter-sdk/src/harness.mjs";

const PROXY_SECRET = "test-proxy-secret";
const AGENT_SPIFFE = "spiffe://platform.example.org/agents/x";
function proxyAssertion(tenantId = "acme") {
  const ts = Math.floor(Date.now() / 1000);
  return `${AGENT_SPIFFE}|${tenantId}|${ts}|${assertionSignature({ spiffeId: AGENT_SPIFFE, tenantId, timestamp: ts }, PROXY_SECRET)}`;
}

const allowPdp = { decide: async () => ({ decision: "allow", requiredEvidence: ["policy-allow"] }) };

test("mattermost-adapteren består den fælles godkendelsesharness (DKC-023)", async () => {
  const mock = createMockMattermost({ posts: [{ id: "p1", userId: "u1", message: "hej fra kunden" }] });
  const mockPort = await mock.listen(0);
  const plan = createFaultPlan();
  const client = plan.wrap(createMattermostClient({ baseUrl: `http://127.0.0.1:${mockPort}`, token: "test-token" }));
  const adapter = createMattermostAdapter({
    authenticate: createSpiffeAuthenticator({ trustDomain: "platform.example.org", trustedProxies: ["127.0.0.1"], proxySecret: PROXY_SECRET }),
    pdp: allowPdp,
    client,
    idempotency: createMemoryIdempotencyStore(),
    upstream: {
      name: "mattermost",
      version: "10.0.0",
      edition: "Enterprise",
      supportedRanges: ["^10.0.0"],
      supportedEditions: ["Enterprise"],
      ping: () => clientPing(mockPort),
    },
  });
  const port = await adapter.listen(0);
  const call = ({ path, method = "POST", headers = {}, body } = {}) =>
    fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { "content-type": "application/json", ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }).then(async (res) => ({ status: res.status, headers: Object.fromEntries(res.headers), body: await res.json().catch(() => null) }));

  try {
    const report = await runAdapterHarness({
      name: "mattermost-adapter",
      call,
      plan,
      profile: {
        mutatingOperation: "deletePost",
        supportedVersion: "10.0.0",
        unsupportedVersion: "11.0.0",
        versionProbe: async (v) => adapter.sdk.negotiate(v),
        backupPath: null, // adapteren erklærer backup unsupported (driftniveau)
        adminBypassPaths: ["/api/v4/config", "/admin/realms/platform"],
      },
      sample: {
        tenant: "acme",
        foreignTenant: "globex",
        identities: { agent: { "x-platform-assertion": proxyAssertion("acme") } },
      },
    });
    assert.equal(report.ok, true, JSON.stringify(report.checks.filter((c) => c.status === "fail"), null, 2));
    const admin = report.checks.find((c) => c.category === "admin-bypass");
    assert.equal(admin.status, "pass", JSON.stringify(admin));
    const backup = report.checks.find((c) => c.category === "backup");
    assert.equal(backup.status, "not-run");
  } finally {
    await adapter.close();
    await mock.close();
  }
});

async function clientPing(port) {
  const res = await fetch(`http://127.0.0.1:${port}/api/v4/system/ping`, { headers: { authorization: "Bearer test-token" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
