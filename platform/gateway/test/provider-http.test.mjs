/**
 * DKC-012 — den reelle OpenAI-kompatible leverandøradapter mod en rigtig
 * HTTP-server på loopback (ingen mock-objekter): non-streaming, streaming,
 * timeout og afbrydelse med delvist forbrug.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createOpenAiCompatibleProvider, ProviderTimeoutError, ProviderCancelledError } from "../src/providers/openai-compatible.mjs";
import { createEgressGuard } from "../src/egress.mjs";

function listen(handler) {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

function providerFor(port, extra = {}) {
  return createOpenAiCompatibleProvider({
    baseUrl: `http://127.0.0.1:${port}/v1`,
    apiKey: "test-key",
    costPerTokenEur: 0.001,
    egressGuard: createEgressGuard({ allowedHosts: ["127.0.0.1"] }),
    ...extra,
  });
}

test("non-streaming kald læser svar og forbrug over rigtig HTTP", async () => {
  const { server, port } = await listen((req, res) => {
    assert.equal(req.url, "/v1/chat/completions");
    assert.equal(req.headers.authorization, "Bearer test-key");
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const parsed = JSON.parse(body);
      assert.equal(parsed.model, "claude-sonnet");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "hej verden" }, finish_reason: "stop" }], usage: { prompt_tokens: 4, completion_tokens: 6, total_tokens: 10 } }));
    });
  });
  try {
    const provider = providerFor(port);
    const result = await provider.complete({ model: "claude-sonnet", messages: [{ role: "user", content: "hej" }], maxTokens: 100 });
    assert.equal(result.text, "hej verden");
    assert.equal(result.tokens, 10);
    assert.equal(result.costEur, 0.01);
    assert.equal(result.finishReason, "stop");
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("streaming kalder onToken og opsummerer forbruget", async () => {
  const { server, port } = await listen((req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "Hej" } }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: " verden" } }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 } })}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
  });
  try {
    const provider = providerFor(port);
    const tokens = [];
    const result = await provider.complete({ model: "claude-sonnet", messages: [{ role: "user", content: "hej" }], maxTokens: 100, stream: true, onToken: (t) => tokens.push(t) });
    assert.deepEqual(tokens, ["Hej", " verden"]);
    assert.equal(result.text, "Hej verden");
    assert.equal(result.tokens, 7);
    assert.equal(result.finishReason, "stop");
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("timeout kaster ProviderTimeoutError (fail-closed)", async () => {
  const { server, port } = await listen((req, res) => {
    // Svarer aldrig; lader forbindelsen hænge.
    req.on("close", () => res.destroy());
  });
  try {
    const provider = providerFor(port, { defaultTimeoutMs: 60 });
    await assert.rejects(
      () => provider.complete({ model: "m", messages: [{ role: "user", content: "hej" }], maxTokens: 10 }),
      (err) => err instanceof ProviderTimeoutError
    );
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("afbrudt stream kaster ProviderCancelledError med delvist forbrug", async () => {
  const { server, port } = await listen((req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "halvt" } }] })}\n\n`);
    // Streamer aldrig videre; klienten afbryder.
  });
  try {
    const provider = providerFor(port);
    const controller = new AbortController();
    const tokens = [];
    const promise = provider.complete({
      model: "m",
      messages: [{ role: "user", content: "hej" }],
      maxTokens: 10,
      stream: true,
      signal: controller.signal,
      onToken: (t) => {
        tokens.push(t);
        controller.abort();
      },
    });
    await assert.rejects(promise, (err) => err instanceof ProviderCancelledError && err.partial?.text === "halvt");
    assert.deepEqual(tokens, ["halvt"]);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
