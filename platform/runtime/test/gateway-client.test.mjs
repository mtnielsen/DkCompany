/**
 * DKC-012 — runtime-workloadens eneste modelvej er gateway-klienten.
 *
 * Klienten kan ikke vælge leverandør eller budget; den angiver dataklasse og
 * en idempotency-key, og serveren afregner. Streaming og afbrydelse
 * videresendes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createGatewayClient } from "../src/clients.mjs";

function listen(handler) {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

test("gateway-klienten sender dataklasse og idempotency-key", async () => {
  let seen = null;
  const { server, port } = await listen((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen = { headers: req.headers, body: JSON.parse(body) };
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: "ok" } }], usage: { total_tokens: 3 }, model: "m", modelVersion: "1", dataClass: "internal" }));
    });
  });
  try {
    const client = createGatewayClient({ endpoint: `http://127.0.0.1:${port}/v1/chat/completions` });
    const result = await client.complete({ agentRef: "agent-a", model: "m", messages: [{ role: "user", content: "hej" }], maxTokens: 10, idempotencyKey: "idem-1", dataClass: "internal" });
    assert.equal(result.text, "ok");
    assert.equal(seen.headers["idempotency-key"], "idem-1");
    assert.equal(seen.headers["x-data-class"], "internal");
    assert.equal(seen.body.data_class, "internal");
    assert.equal(seen.body.provider, undefined, "workloaden må ikke kunne angive leverandør");
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("gateway-klienten læser et SSE-stream", async () => {
  const { server, port } = await listen((req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "Hej" } }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "!" } }] })}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
  });
  try {
    const client = createGatewayClient({ endpoint: `http://127.0.0.1:${port}/v1/chat/completions` });
    const chunks = [];
    const result = await client.complete({ agentRef: "agent-a", model: "m", messages: [], maxTokens: 10, onToken: (t) => chunks.push(t) });
    assert.deepEqual(chunks, ["Hej", "!"]);
    assert.equal(result.text, "Hej!");
  } finally {
    await new Promise((r) => server.close(r));
  }
});
