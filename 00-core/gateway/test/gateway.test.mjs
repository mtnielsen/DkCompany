import { test } from "node:test";
import assert from "node:assert/strict";
import { createGateway, GatewayError } from "../src/gateway.mjs";
import { createEchoProvider, createFailingProvider } from "../src/provider.mjs";

const routes = [
  { id: "agent-a-sonnet", agentRef: "agent-a", provider: "anthropic", model: "claude-sonnet", modelVersion: "2025-01", maxTokens: 100000, maxCostEur: 100, enabled: true },
  { id: "agent-tiny-budget", agentRef: "agent-tiny", provider: "anthropic", model: "claude-sonnet", modelVersion: "2025-01", maxTokens: 5, maxCostEur: 100, enabled: true },
  { id: "agent-b-disabled", agentRef: "agent-b", provider: "openai", model: "gpt", modelVersion: "x", enabled: false },
];

test("route findes: modelkald går gennem gatewayen og versionslogges", async () => {
  const calls = [];
  const gateway = createGateway({ routes, provider: createEchoProvider(), onCall: (c) => calls.push(c) });
  const result = await gateway.complete({ agentRef: "agent-a", messages: [{ role: "user", content: "hej" }] });
  assert.equal(result.modelVersion, "2025-01");
  assert.equal(result.route, "agent-a-sonnet");
  assert.ok(result.tokens > 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].modelVersion, "2025-01");
  assert.equal(gateway.usage.get("agent-a").calls, 1);
});

test("agent uden route kan ikke nå en model", async () => {
  let providerCalled = false;
  const provider = { complete: async () => { providerCalled = true; return { text: "x", tokens: 1, costEur: 0 }; } };
  const gateway = createGateway({ routes, provider });
  await assert.rejects(() => gateway.complete({ agentRef: "unknown-agent", messages: [] }), (e) => e instanceof GatewayError && e.status === 403);
  assert.equal(providerCalled, false, "leverandøren må ikke kaldes uden route");
});

test("deaktiveret route giver ingen modeladgang", async () => {
  const gateway = createGateway({ routes, provider: createEchoProvider() });
  await assert.rejects(() => gateway.complete({ agentRef: "agent-b", messages: [] }), (e) => e.status === 403);
});

test("model der ikke matcher agentens route afvises", async () => {
  const gateway = createGateway({ routes, provider: createEchoProvider() });
  await assert.rejects(() => gateway.complete({ agentRef: "agent-a", model: "gpt", messages: [] }), (e) => e.status === 403);
});

test("budgetoverskridelse giver 429 og eskalerer", async () => {
  const gateway = createGateway({ routes, provider: createEchoProvider() });
  await gateway.complete({ agentRef: "agent-tiny", messages: [{ role: "user", content: "et eller andet" }] });
  await assert.rejects(() => gateway.complete({ agentRef: "agent-tiny", messages: [{ role: "user", content: "igen" }] }), (e) => e.status === 429);
});

test("leverandørfejl bliver 502", async () => {
  const gateway = createGateway({ routes, provider: createFailingProvider() });
  await assert.rejects(() => gateway.complete({ agentRef: "agent-a", messages: [] }), (e) => e.status === 502);
});

test("HTTP-endpoint håndhæver route og budget", async () => {
  const gateway = createGateway({ routes, provider: createEchoProvider() });
  const port = await gateway.listen(0);
  try {
    const ok = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-agent-ref": "agent-a" },
      body: JSON.stringify({ model: "claude-sonnet", messages: [{ role: "user", content: "hej" }] }),
    });
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.equal(body.modelVersion, "2025-01");
    assert.ok(body.choices[0].message.content.includes("echo"));

    const forbidden = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-agent-ref": "ghost" },
      body: JSON.stringify({ messages: [] }),
    });
    assert.equal(forbidden.status, 403);

    const exhausted = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-agent-ref": "agent-tiny" },
      body: JSON.stringify({ messages: [{ role: "user", content: "x" }] }),
    });
    assert.equal(exhausted.status, 200);
    const over = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-agent-ref": "agent-tiny" },
      body: JSON.stringify({ messages: [{ role: "user", content: "y" }] }),
    });
    assert.equal(over.status, 429);
    assert.equal((await over.json()).escalate, true);
  } finally {
    await gateway.close();
  }
});
