/**
 * DKC-013 — enhedstest af tilstandsmaskine, retry-politik og klassifikation.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { JOB_STATES, allowedTransitions, assertTransition, canTransition, isTerminalState } from "../src/state.mjs";
import { DEFAULT_RETRY_POLICY, decideOutcome, isRetryableError, nextBackoffMs } from "../src/retry.mjs";
import { classifyActions, classifyVerb, compensationFor, isIrreversibleVerb } from "../src/classification.mjs";

test("jobtilstandsmaskinen tillader kun de erklærede overgange", () => {
  assert.equal(canTransition("queued", "leased"), true);
  assert.equal(canTransition("leased", "running"), true);
  assert.equal(canTransition("running", "unknown"), true);
  assert.equal(canTransition("unknown", "dead-letter"), true);
  assert.equal(canTransition("retry-scheduled", "leased"), true);
  assert.equal(canTransition("dead-letter", "queued"), true);
  assert.equal(canTransition("completed", "running"), false);
  assert.equal(canTransition("failed", "queued"), false);
  assert.throws(() => assertTransition("completed", "running"), /ulovlig/);
});

test("terminale tilstande er terminale", () => {
  for (const state of ["completed", "failed", "dead-letter", "cancelled"]) assert.equal(isTerminalState(state), true, state);
  for (const state of JOB_STATES.filter((s) => !["completed", "failed", "dead-letter", "cancelled"].includes(s))) {
    assert.equal(isTerminalState(state), false, state);
  }
});

test("verbumsklassifikation skelner read, reversibel og irreversibel (fail-safe)", () => {
  assert.equal(classifyVerb("observe.read"), "read");
  assert.equal(classifyVerb("diagnose"), "read");
  assert.equal(classifyVerb("restart"), "reversible-write");
  assert.equal(classifyVerb("scale"), "reversible-write");
  assert.equal(classifyVerb("backup"), "reversible-write");
  assert.equal(classifyVerb("upgrade.patch"), "irreversible-write");
  assert.equal(classifyVerb("subject.erase"), "irreversible-write");
  assert.equal(classifyVerb("brand-new.mutating"), "irreversible-write", "ukendt muterende er fail-safe irreversibel");
  assert.equal(classifyVerb(""), "irreversible-write");
});

test("en blandet opgave arver den mest risikable klasse", () => {
  assert.equal(classifyActions([{ verb: "observe.read" }, { verb: "restart" }]), "reversible-write");
  assert.equal(classifyActions([{ verb: "restart" }, { verb: "restore" }]), "irreversible-write");
  assert.equal(classifyActions([{ verb: "observe.read" }]), "read");
  assert.equal(classifyActions([]), "read");
});

test("isIrreversibleVerb og kompensationskort", () => {
  assert.equal(isIrreversibleVerb("restore"), true);
  assert.equal(isIrreversibleVerb("restart"), false);
  assert.equal(compensationFor("upgrade.patch"), "rollback");
  assert.equal(compensationFor("config.apply"), "rollback");
  assert.equal(compensationFor("subject.erase"), null);
});

test("retry er kun forbigående fejl", () => {
  assert.equal(isRetryableError(new Error("connect ECONNRESET")), true);
  assert.equal(isRetryableError(new Error("request timed out")), true);
  assert.equal(isRetryableError(new Error("HTTP 503 service unavailable")), true);
  assert.equal(isRetryableError(new Error("ugyldig signatur")), false);
  assert.equal(isRetryableError(null), false);
});

test("retry-beslutningen eskalerer irreversible unknown og begrænser forsøg", () => {
  assert.equal(decideOutcome({ classification: "irreversible-write", state: "unknown", attempt: 1, maxAttempts: 3 }).action, "escalate");
  assert.equal(decideOutcome({ classification: "irreversible-write", state: "failed", attempt: 1, maxAttempts: 3 }).action, "escalate");
  assert.equal(decideOutcome({ classification: "reversible-write", state: "failed", attempt: 1, maxAttempts: 3, retryable: true }).action, "retry");
  assert.equal(decideOutcome({ classification: "reversible-write", state: "failed", attempt: 3, maxAttempts: 3, retryable: true }).action, "dead-letter");
  assert.equal(decideOutcome({ classification: "read", state: "failed", attempt: 1, maxAttempts: 3, retryable: false }).action, "dead-letter");
  assert.equal(decideOutcome({ classification: "read", state: "unknown", attempt: 2, maxAttempts: 3 }).action, "retry");
  assert.equal(decideOutcome({ classification: "read", state: "completed", attempt: 1 }).action, "complete");
});

test("backoff vokser eksponentielt og er begrænset", () => {
  const policy = { maxAttempts: 5, baseDelayMs: 100, maxDelayMs: 1000, jitter: 0 };
  assert.equal(nextBackoffMs(1, policy, () => 0), 100);
  assert.equal(nextBackoffMs(2, policy, () => 0), 200);
  assert.equal(nextBackoffMs(3, policy, () => 0), 400);
  assert.equal(nextBackoffMs(10, policy, () => 0), 1000);
  assert.equal(DEFAULT_RETRY_POLICY.maxAttempts >= 1, true);
});
