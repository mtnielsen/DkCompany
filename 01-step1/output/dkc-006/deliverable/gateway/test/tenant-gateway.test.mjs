import { test } from "node:test";
import assert from "node:assert/strict";
import { createGateway } from "../src/gateway.mjs";
import { createEchoProvider } from "../src/provider.mjs";
import { createSpiffeAuthenticator } from "../../identity/src/compat.mjs";
import { assertionSignature } from "../../identity/src/identity.mjs";

const PROXY_SECRET = "test-proxy-secret";
const GATEWAY_SPIFFE = "spiffe://platform.example.org/ns/gateway";

function assertion(tenantId) {
  const ts = Math.floor(Date.now() / 1000);
  return `${GATEWAY_SPIFFE}|${tenantId}|${ts}|${assertionSignature({ spiffeId: GATEWAY_SPIFFE, tenantId, timestamp: ts }, PROXY_SECRET)}`;
}

const routes = [
  { id: "agent-a-acme", tenantId: "acme", agentRef: "agent-a", provider: "anthropic", model: "claude-sonnet", modelVersion: "2025-01", maxTokens: 100000, maxCostEur: 100, enabled: true },
  { id: "agent-a-globex", tenantId: "globex", agentRef: "agent-a", provider: "anthropic", model: "claude-sonnet", modelVersion: "2025-01", maxTokens: 100000, maxCostEur: 100, enabled: true },
];

function gateway() {
  return createGateway({
    routes,
    provider: createEchoProvider(),
    authenticator: createSpiffeAuthenticator({ trustDomain: "platform.example.org", trustedProxies: ["127.0.0.1"], proxySecret: PROXY_SECRET }),
  });
}

test("modelhistorik er tenant-bundet og route-scope håndhæves", async () => {
  const gw = gateway();
  const result = await gw.complete({ tenantId: "acme", agentRef: "agent-a", messages: [{ role: "user", content: "hej" }] });
  assert.equal(result.route, "agent-a-acme");
  assert.equal(gw.history.list("acme", { agentRef: "agent-a" }).length, 1);
  assert.equal(gw.history.list("globex", { agentRef: "agent-a" }).length, 0);
  assert.equal(gw.history.list("acme")[0].tenantId, "acme");
  // Globex-agenten må ikke se acme-historik og har sin egen route.
  assert.equal(gw.usageFor("acme", "agent-a").calls, 1);
  assert.equal(gw.usageFor("globex", "agent-a").calls, 0);
});

test("HTTP: acme-assertion + acme-route virker, men tenant-header-swap afvises", async () => {
  const gw = gateway();
  const port = await gw.listen(0);
  try {
    const ok = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-platform-assertion": assertion("acme"), "x-agent-ref": "agent-a" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hej" }] }),
    });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).route, "agent-a-acme");

    const swapped = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-platform-assertion": assertion("acme"), "x-tenant-id": "globex", "x-agent-ref": "agent-a" },
      body: JSON.stringify({ messages: [] }),
    });
    assert.equal(swapped.status, 403);
    assert.equal((await swapped.json()).code, "tenant_mismatch");

    const noIdentity = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-agent-ref": "agent-a" },
      body: JSON.stringify({ messages: [] }),
    });
    assert.equal(noIdentity.status, 401);
  } finally {
    await gw.close();
  }
});
