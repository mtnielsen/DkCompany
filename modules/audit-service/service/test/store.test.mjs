import { test } from "node:test";
import assert from "node:assert/strict";
import { createAuditLog, createSubjectStore } from "../src/store.mjs";

test("audit-loggen er en intakt hash-kæde", () => {
  const log = createAuditLog();
  log.append({ type: "a", principal: { kind: "human", id: "u" } });
  log.append({ type: "b", principal: { kind: "agent", id: "a" } });
  const result = log.verifyChain();
  assert.deepEqual(result, { ok: true, length: 2 });
  assert.equal(log.events[1].prevHash, log.events[0].hash);
});

test("manipulation af et gammelt event brækker kæden", () => {
  const log = createAuditLog();
  log.append({ type: "a", principal: { kind: "human", id: "u" }, payload: { amount: 1 } });
  log.append({ type: "b", principal: { kind: "human", id: "u" } });
  log.events[0].payload.amount = 999;
  const result = log.verifyChain();
  assert.equal(result.ok, false);
  assert.equal(result.brokenAt, 1);
});

test("subject-store finder og sletter på identifikator", () => {
  const store = createSubjectStore();
  store.add({ subjects: [{ type: "email", value: "a@example.org" }] });
  store.add({ subjects: [{ type: "email", value: "b@example.org" }] });
  assert.equal(store.locate([{ type: "email", value: "a@example.org" }]).length, 1);
  const erased = store.erase([{ type: "email", value: "a@example.org" }]);
  assert.equal(erased.length, 1);
  assert.equal(store.locate([{ type: "email", value: "a@example.org" }]).length, 0);
  assert.equal(store.count(), 1);
});
