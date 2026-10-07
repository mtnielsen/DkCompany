/**
 * DKC-012 — netværkstest for model-egress.
 *
 * Starter en rigtig leverandør-efterligning på loopback. Gatewayen (med
 * egress-vagten) kan nå den; en agent-workload med sin egen identitet afvises
 * *før* netværkskaldet, og serveren modtager intet. Dermed er den direkte
 * leverandørvej blokeret ved identitetsgrænsen, ikke ved en prompt.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createOpenAiCompatibleProvider } from "../src/providers/openai-compatible.mjs";
import { createEgressGuard, createGuardedFetch, ModelEgressBlocked } from "../src/egress.mjs";

function listen(handler) {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

test("gatewayen kan nå leverandøren, men en workload afvises før netværket", async () => {
  let providerRequests = 0;
  const { server, port } = await listen((req, res) => {
    providerRequests += 1;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok" } }], usage: { total_tokens: 2 } }));
  });
  try {
    const guard = createEgressGuard({ allowedHosts: ["127.0.0.1"], gatewayPrincipals: ["spiffe://platform.example.org/ns/gateway"] });

    // 1) Gatewayen må kalde leverandøren.
    const gatewayProvider = createOpenAiCompatibleProvider({ baseUrl: `http://127.0.0.1:${port}/v1`, egressGuard: guard });
    const result = await gatewayProvider.complete({ model: "m", messages: [{ role: "user", content: "hej" }], maxTokens: 5 });
    assert.equal(result.text, "ok");
    assert.equal(providerRequests, 1);

    // 2) En workload med sin egen SPIFFE-identitet afvises, før fetch kaldes.
    const workloadFetch = createGuardedFetch({ guard, caller: { kind: "workload", id: "spiffe://platform.example.org/agents/dummy-ok-upgrader" } });
    await assert.rejects(
      () => workloadFetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST" }),
      (err) => err instanceof ModelEgressBlocked && err.reason === "forbidden-caller"
    );
    assert.equal(providerRequests, 1, "workloaden må ikke have nået leverandøren");
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("en ukendt leverandørvært afvises også for gatewayen", async () => {
  const guard = createEgressGuard({ allowedHosts: ["api.openai.com"] });
  assert.throws(() => guard.assertAllowed({ url: "https://evil.example.org/v1", caller: { kind: "gateway" } }), (err) => err instanceof ModelEgressBlocked && err.reason === "host-not-allowed");
  assert.equal(guard.isAllowed("https://api.openai.com/v1", { kind: "gateway" }), true);
  assert.equal(guard.isAllowed("https://api.openai.com/v1", { kind: "workload" }), false);
});
