/**
 * DKC-012 — reviewerens reelle leverandør går gennem gatewayen.
 *
 * Reviewer-agenten får en provider med `review()`, men selve modelkaldet går
 * gennem gatewayens serverstyrede route. Testen beviser at:
 *   - adapteren videresender til gatewayen (og ikke til en leverandør),
 *   - reviewerens providernavn er den anden leverandør,
 *   - reviewer kan flagge men aldrig godkende.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createReviewerProvider } from "../../gateway/src/reviewer-provider.mjs";
import { createReviewerAgent } from "../src/reviewer.mjs";

test("reviewerens provider kalder gatewayen og kan kun flagge", async () => {
  const calls = [];
  const complete = async (options) => {
    calls.push(options);
    return { text: JSON.stringify({ verdict: "flag", findings: ["manglende rollback"] }), tokens: 12, costEur: 0.012 };
  };
  const provider = createReviewerProvider({ complete, providerName: "openai", agentRef: "dummy-ok-reviewer", model: "gpt-4o" });
  const reviewer = createReviewerAgent({ provider, providerName: "openai", authorProvider: "anthropic", model: "gpt-4o", authorModel: "claude-sonnet" });
  const result = await reviewer.review({ change: { uri: "change://1" }, rawData: { diff: "-a +b" } });
  assert.equal(result.verdict, "flag");
  assert.equal(result.provider, "openai");
  assert.equal(result.sawAuthorRationale, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].agentRef, "dummy-ok-reviewer");
  assert.equal(calls[0].dataClass, "internal");
});

test("revieweren må ikke bruge samme leverandør som forfatteren", () => {
  const provider = createReviewerProvider({ complete: async () => ({ text: "{}" }), providerName: "anthropic" });
  assert.throws(() => createReviewerAgent({ provider, providerName: "anthropic", authorProvider: "anthropic" }), /anden leverandør/);
});
