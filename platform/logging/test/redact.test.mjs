import { test } from "node:test";
import assert from "node:assert/strict";
import { redactLogRecord, assertNoSecrets, assertNoHiddenReasoning, MINIMIZED } from "../src/redact.mjs";

test("fjerner hemmeligheder på feltnavn og værdimønster", () => {
  const { record, redactions } = redactLogRecord({ authorization: "Bearer abcdefghijklmnop", note: "ok", nested: { apiKey: "sk-1234567890abcdef" } });
  assert.equal(record.authorization, "[REDACTED]");
  assert.equal(record.nested.apiKey, "[REDACTED]");
  assert.ok(redactions.length >= 2);
});

test("fjerner skjult modelræsonnering helt", () => {
  const { record, reasoningRemoved } = redactLogRecord({ model: { name: "x" }, chainOfThought: "private trin", inner: { reasoning: "hemmelig" } });
  assert.equal(record.chainOfThought, undefined);
  assert.equal(record.inner.reasoning, undefined);
  assert.deepEqual(reasoningRemoved.sort(), ["/chainOfThought", "/inner/reasoning"]);
});

test("minimerer persondata i frie datablokke og bevarer digest", () => {
  const { record, personalDataDigest, personalFields } = redactLogRecord({
    observation: { source: "s", freshness: "fresh", value: { email: "kunde@example.org", count: 3 } },
    human: { subject: "oidc|anna", role: "approver" },
  });
  assert.equal(record.observation.value.email, MINIMIZED);
  assert.equal(record.observation.value.count, 3);
  // Den pseudonyme principal bevares.
  assert.equal(record.human.subject, "oidc|anna");
  assert.ok(personalDataDigest);
  assert.ok(personalFields.includes("/observation/value/email"));
});

test("assertNoSecrets og assertNoHiddenReasoning er fail-closed", () => {
  assert.throws(() => assertNoSecrets({ password: "hunter2" }), /hemmelighed/);
  assert.doesNotThrow(() => assertNoSecrets({ note: "ren" }));
  assert.throws(() => assertNoHiddenReasoning({ reasoning: "skjult" }), /ræsonnering/);
  assert.doesNotThrow(() => assertNoHiddenReasoning({ summary: "kort" }));
});
