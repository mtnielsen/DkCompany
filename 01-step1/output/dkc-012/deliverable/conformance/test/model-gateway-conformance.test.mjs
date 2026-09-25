/**
 * DKC-012 — konformanstests for modelgateway og bindende budgetter.
 *
 * Dækker de fem acceptkriterier:
 *   1. klienten kan ikke hæve budgettet eller vælge en forbudt leverandør,
 *   2. samtidige kald kan ikke bruge samme resterende budget,
 *   3. timeout, streaming-afbrydelse og retry afregnes korrekt,
 *   4. ukendt dataklasse afvises, og rå persondata logges ikke som standard,
 *   5. direkte model-egress fra en workload er blokeret.
 *
 * Leverandøren er en rigtig HTTP-server på loopback, ikke en mock.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createGateway, GatewayError } from "../../gateway/src/gateway.mjs";
import { createOpenAiCompatibleProvider } from "../../gateway/src/providers/openai-compatible.mjs";
import { createEgressGuard, createGuardedFetch, ModelEgressBlocked } from "../../gateway/src/egress.mjs";
import { openDatabase } from "../../persistence/src/db.mjs";
import { createMigrator } from "../../persistence/src/migrations.mjs";
import { createSqliteBudgetStore } from "../../persistence/src/adapters/budgets.mjs";
import { createSqliteGatewayCallStore } from "../../persistence/src/adapters/gateway-calls.mjs";

const ROUTES = [
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
    timeoutMs: 200,
    costPerTokenEur: 0.001,
    enabled: true,
  },
  {
    id: "agent-p-sonnet",
    agentRef: "agent-p",
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
    timeoutMs: 200,
    costPerTokenEur: 0.001,
    enabled: true,
  },
];

function listen(handler) {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

function stores() {
  const db = openDatabase({ path: ":memory:" });
  createMigrator({ db }).apply();
  return { budgetStore: createSqliteBudgetStore({ db }), callStore: createSqliteGatewayCallStore({ db }) };
}

function gatewayWith(port, { budgetStore, callStore, onCall, routes = ROUTES } = {}) {
  const provider = createOpenAiCompatibleProvider({
    baseUrl: `http://127.0.0.1:${port}/v1`,
    apiKey: "test",
    costPerTokenEur: 0.001,
    defaultTimeoutMs: 200,
    egressGuard: createEgressGuard({ allowedHosts: ["127.0.0.1"] }),
  });
  return createGateway({ routes, provider, budgetStore, callStore, onCall });
}

test("accept 1: klienten kan ikke hæve budgettet eller vælge en forbudt leverandør", async () => {
  const { server, port } = await listen((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: "ok" } }], usage: { total_tokens: 2 } }));
  });
  try {
    const gateway = gatewayWith(port, stores());
    await assert.rejects(() => gateway.complete({ agentRef: "agent-a", messages: [], maxTokens: 9999 }), (e) => e.status === 403 && e.code === "max_output_forbidden");
    await assert.rejects(() => gateway.complete({ agentRef: "agent-a", messages: [], provider: "openai" }), (e) => e.status === 403 && e.code === "provider_forbidden");
    const ok = await gateway.complete({ tenantId: "acme", agentRef: "agent-a", messages: [{ role: "user", content: "hej" }] });
    assert.equal(ok.text, "ok");
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("accept 2: samtidige kald kan ikke bruge samme resterende budget", async () => {
  const { server, port } = await listen((req, res) => {
    setTimeout(() => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: "ok" } }], usage: { total_tokens: 5 } }));
    }, 50);
  });
  try {
    const gateway = gatewayWith(port, stores());
    const first = gateway.complete({ tenantId: "acme", agentRef: "agent-a", messages: [{ role: "user", content: "a" }] });
    const second = gateway.complete({ tenantId: "acme", agentRef: "agent-a", messages: [{ role: "user", content: "b" }] });
    await assert.rejects(() => second, (e) => e instanceof GatewayError && e.status === 429);
    await first;
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("accept 3a: timeout afregner delvist forbrug og frigiver resten", async () => {
  const { server, port } = await listen((req, res) => {
    // Svarer aldrig → provider-timeout.
    req.on("close", () => res.destroy());
  });
  try {
    const { budgetStore: bs, callStore } = stores();
    const gateway = gatewayWith(port, { budgetStore: bs, callStore });
    await assert.rejects(() => gateway.complete({ tenantId: "acme", agentRef: "agent-a", messages: [{ role: "user", content: "hej" }], idempotencyKey: "to" }), (e) => e.status === 504);
    assert.equal(bs.get("acme", "agent-a-sonnet").reservedTokens, 0, "reservationen skal være frigivet efter timeout");
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("accept 3b: streaming-afbrydelse afregner det modtagne og retry genoptages", async () => {
  let connection = 0;
  const { server, port } = await listen((req, res) => {
    connection += 1;
    if (connection === 1) {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "halvt" } }] })}\n\n`);
      // Afbrydes af klienten.
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: "færdig" } }], usage: { total_tokens: 4 } }));
  });
  try {
    const { budgetStore, callStore } = stores();
    const gateway = gatewayWith(port, { budgetStore, callStore });
    const controller = new AbortController();
    await assert.rejects(
      () =>
        gateway.complete({
          tenantId: "acme",
          agentRef: "agent-a",
          messages: [{ role: "user", content: "hej" }],
          idempotencyKey: "stream-1",
          stream: true,
          signal: controller.signal,
          onToken: () => controller.abort(),
        }),
      (e) => e.status === 499
    );
    const partial = budgetStore.get("acme", "agent-a-sonnet");
    assert.ok(partial.tokens > 0, "det modtagne skal afregnes");
    assert.equal(partial.reservedTokens, 0);
    // Retry med samme nøgle efter frigivelse genoptages og afregnes.
    const retry = await gateway.complete({ tenantId: "acme", agentRef: "agent-a", messages: [{ role: "user", content: "hej" }], idempotencyKey: "stream-1" });
    assert.equal(retry.text, "færdig");
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("accept 4: ukendt dataklasse afvises og rå persondata logges ikke", async () => {
  const { server, port } = await listen((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: "svar" } }], usage: { total_tokens: 2 } }));
  });
  try {
    const calls = [];
    const gateway = gatewayWith(port, { ...stores(), onCall: (c) => calls.push(c) });
    await assert.rejects(() => gateway.complete({ agentRef: "agent-a", messages: [], dataClass: "ukendt" }), (e) => e.status === 422);
    await gateway.complete({ tenantId: "acme", agentRef: "agent-p", messages: [{ role: "user", content: "kunde@example.org" }], dataClass: "personal" });
    assert.ok(!JSON.stringify(calls).includes("kunde@example.org"));
    assert.equal(calls[0].personalData, true);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("accept 5: direkte model-egress fra en workload er blokeret", async () => {
  let providerRequests = 0;
  const { server, port } = await listen((req, res) => {
    providerRequests += 1;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: "ok" } }], usage: { total_tokens: 2 } }));
  });
  try {
    const guard = createEgressGuard({ allowedHosts: ["127.0.0.1"], gatewayPrincipals: ["spiffe://platform.example.org/ns/gateway"] });
    const gatewayFetch = createGuardedFetch({ guard, caller: { kind: "gateway" } });
    const workloadFetch = createGuardedFetch({ guard, caller: { kind: "workload", id: "spiffe://platform.example.org/agents/dummy-ok-upgrader" } });

    const viaGateway = await gatewayFetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(viaGateway.status, 200);
    assert.equal(providerRequests, 1);

    await assert.rejects(
      () => workloadFetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST", body: "{}" }),
      (e) => e instanceof ModelEgressBlocked
    );
    assert.equal(providerRequests, 1, "workloaden må ikke have nået leverandøren");
  } finally {
    await new Promise((r) => server.close(r));
  }
});
