/**
 * DKC-012 — gatewayens serverstyrede routing, bindende budget og idempotens.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createGateway, GatewayError } from "../src/gateway.mjs";
import { createEchoProvider } from "../src/provider.mjs";
import { openDatabase } from "../../persistence/src/db.mjs";
import { createMigrator } from "../../persistence/src/migrations.mjs";
import { createSqliteBudgetStore } from "../../persistence/src/adapters/budgets.mjs";
import { createSqliteGatewayCallStore } from "../../persistence/src/adapters/gateway-calls.mjs";

const routes = [
  {
    id: "agent-a-sonnet",
    agentRef: "agent-a",
    provider: "anthropic",
    model: "claude-sonnet",
    modelVersion: "2025-01",
    dataClasses: ["public", "internal", "confidential"],
    maxTokens: 100,
    maxCostEur: 1,
    maxOutputTokens: 50,
    timeoutMs: 5000,
    costPerTokenEur: 0.001,
    enabled: true,
  },
  {
    id: "agent-a-personal",
    agentRef: "agent-a-personal",
    provider: "anthropic",
    model: "claude-sonnet",
    modelVersion: "2025-01",
    dataClasses: ["internal", "personal"],
    approvedDataProcessing: true,
    processor: "anthropic-eu",
    dpaRef: "dpa://x",
    maxTokens: 100,
    maxCostEur: 1,
    maxOutputTokens: 50,
    timeoutMs: 5000,
    costPerTokenEur: 0.001,
    enabled: true,
  },
  {
    id: "agent-b-nodpa",
    agentRef: "agent-b",
    provider: "anthropic",
    model: "claude-sonnet",
    modelVersion: "2025-01",
    dataClasses: ["internal", "personal"],
    approvedDataProcessing: false,
    maxTokens: 100,
    maxCostEur: 1,
    maxOutputTokens: 50,
    timeoutMs: 5000,
    costPerTokenEur: 0.001,
    enabled: true,
  },
];

function fixture() {
  const db = openDatabase({ path: ":memory:" });
  createMigrator({ db }).apply();
  return {
    db,
    budgetStore: createSqliteBudgetStore({ db }),
    callStore: createSqliteGatewayCallStore({ db }),
  };
}

test("ukendt dataklasse afvises (fail-closed)", async () => {
  const gateway = createGateway({ routes, provider: createEchoProvider() });
  await assert.rejects(
    () => gateway.complete({ agentRef: "agent-a", messages: [], dataClass: "hemmelig" }),
    (e) => e instanceof GatewayError && e.status === 422 && e.code === "data_class_unknown"
  );
});

test("personhenførbar dataklasse kræver godkendt databehandling", async () => {
  const gateway = createGateway({ routes, provider: createEchoProvider() });
  await assert.rejects(
    () => gateway.complete({ agentRef: "agent-b", messages: [], dataClass: "personal" }),
    (e) => e instanceof GatewayError && e.status === 403 && e.code === "processing_not_approved"
  );
  const ok = await gateway.complete({ agentRef: "agent-a-personal", messages: [{ role: "user", content: "hej" }], dataClass: "personal" });
  assert.equal(ok.dataClass, "personal");
});

test("klienten kan ikke vælge en forbudt leverandør", async () => {
  const gateway = createGateway({ routes, provider: createEchoProvider() });
  await assert.rejects(
    () => gateway.complete({ agentRef: "agent-a", messages: [], provider: "openai" }),
    (e) => e instanceof GatewayError && e.status === 403 && e.code === "provider_forbidden"
  );
});

test("klienten kan ikke hæve route'ens max-output", async () => {
  const gateway = createGateway({ routes, provider: createEchoProvider() });
  await assert.rejects(
    () => gateway.complete({ agentRef: "agent-a", messages: [], maxTokens: 500 }),
    (e) => e instanceof GatewayError && e.status === 403 && e.code === "max_output_forbidden"
  );
  const smaller = await gateway.complete({ agentRef: "agent-a", messages: [{ role: "user", content: "hej" }], maxTokens: 5 });
  assert.ok(smaller.tokens > 0);
});

test("budgettet reserveres atomisk: samtidige kald kan ikke bruge samme rest", async () => {
  const { budgetStore, callStore } = fixture();
  let releaseProvider;
  const provider = {
    async complete() {
      await new Promise((resolve) => {
        releaseProvider = resolve;
      });
      return { text: "ok", tokens: 10, costEur: 0.01 };
    },
  };
  const gateway = createGateway({ routes, provider, budgetStore, callStore });
  const first = gateway.complete({ tenantId: "acme", agentRef: "agent-a", messages: [{ role: "user", content: "hej" }] });
  const second = gateway.complete({ tenantId: "acme", agentRef: "agent-a", messages: [{ role: "user", content: "igen" }] });
  await assert.rejects(() => second, (e) => e instanceof GatewayError && e.status === 429 && e.code === "budget_exceeded");
  releaseProvider();
  const done = await first;
  assert.equal(done.tokens, 10);
  const record = budgetStore.get("acme", "agent-a-sonnet");
  assert.equal(record.tokens, 10);
  assert.equal(record.reservedTokens, 0);
});

test("idempotency-key: replay uden nyt leverandørkald og uden dobbeltforbrug", async () => {
  const { budgetStore, callStore } = fixture();
  let providerCalls = 0;
  const provider = {
    async complete() {
      providerCalls += 1;
      return { text: "svar", tokens: 10, costEur: 0.01 };
    },
  };
  const gateway = createGateway({ routes, provider, budgetStore, callStore });
  const options = { tenantId: "acme", agentRef: "agent-a", messages: [{ role: "user", content: "hej" }], idempotencyKey: "abc" };
  const first = await gateway.complete({ ...options });
  const replay = await gateway.complete({ ...options });
  assert.equal(providerCalls, 1, "replay må ikke kalde leverandøren igen");
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.text, "svar");
  assert.equal(budgetStore.get("acme", "agent-a-sonnet").tokens, 10, "budgettet må kun forbruges én gang");
});

test("timeout afregner det delvise forbrug og frigiver resten", async () => {
  const { budgetStore, callStore } = fixture();
  const provider = {
    async complete() {
      const err = new Error("timeout");
      err.name = "ProviderTimeoutError";
      err.partial = { text: "halvt", tokens: 5, costEur: 0.005 };
      throw err;
    },
  };
  const gateway = createGateway({ routes, provider, budgetStore, callStore });
  await assert.rejects(
    () => gateway.complete({ tenantId: "acme", agentRef: "agent-a", messages: [{ role: "user", content: "hej" }], idempotencyKey: "t1" }),
    (e) => e instanceof GatewayError && e.status === 504 && e.code === "provider_timeout"
  );
  const record = budgetStore.get("acme", "agent-a-sonnet");
  assert.equal(record.tokens, 5, "det delvise forbrug skal afregnes");
  assert.equal(record.reservedTokens, 0, "reservationen skal være frigivet");
  const call = callStore.get("acme", "t1");
  assert.equal(call.state, "released", "et afbrudt kald skal kunne genforsøges");
});

test("rå samtaleindhold logges ikke, og persondataklasse markeres", async () => {
  const calls = [];
  const gateway = createGateway({ routes, provider: createEchoProvider(), onCall: (c) => calls.push(c) });
  await gateway.complete({ tenantId: "acme", agentRef: "agent-a-personal", messages: [{ role: "user", content: "kunde@example.org" }], dataClass: "personal" });
  const serialized = JSON.stringify(calls);
  assert.ok(!serialized.includes("kunde@example.org"), "rå persondata må ikke logges");
  assert.equal(calls[0].personalData, true);
  assert.equal(calls[0].dataClass, "personal");
  assert.ok(calls[0].requestDigest);
});

test("streaming-request der afvises får en rigtig HTTP-status (ikke 200)", async () => {
  const gateway = createGateway({ routes, provider: createEchoProvider() });
  const port = await gateway.listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-agent-ref": "agent-a" },
      body: JSON.stringify({ messages: [], stream: true, provider: "openai" }),
    });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).code, "provider_forbidden");
  } finally {
    await gateway.close();
  }
});
