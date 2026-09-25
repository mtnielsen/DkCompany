import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  OFFBOARDING_TARGETS,
  createMemoryOffboardingStore,
  createFileOffboardingStore,
  seedRights,
  planOffboarding,
  executeOffboarding,
  offboardingPlanProblems,
} from "../src/index.mjs";

const NOW = Date.parse("2025-09-01T08:00:00Z");
const SUBJECT = "oidc|forlader.bruger";

function rights() {
  return {
    sessions: [{ id: "s1" }],
    "api-tokens": [{ id: "t1" }],
    shares: [{ id: "sh1" }],
    "scheduled-workflows": [{ id: "w1" }],
    "ai-tool-grants": [{ id: "a1" }],
  };
}

test("offboarding lukker alle fem rettighedsklasser inden fristen", () => {
  const store = createMemoryOffboardingStore();
  seedRights(store, SUBJECT, rights());
  const plan = planOffboarding({ subject: SUBJECT, deadlineSeconds: 600, now: NOW });
  const result = executeOffboarding({ plan, store, now: () => NOW + 1000 });
  assert.equal(result.status, "complete");
  assert.equal(result.completeByDeadline, true);
  assert.equal(result.outstanding.length, 0);
  assert.equal(result.actions.filter((a) => a.status === "done").length, OFFBOARDING_TARGETS.length);
  for (const target of OFFBOARDING_TARGETS) assert.equal(store.list(target, SUBJECT).every((r) => r.revokedAt), true);
});

test("offboarding er idempotent", () => {
  const store = createMemoryOffboardingStore();
  seedRights(store, SUBJECT, rights());
  const plan = planOffboarding({ subject: SUBJECT, deadlineSeconds: 600, now: NOW });
  executeOffboarding({ plan, store, now: () => NOW + 1000 });
  const second = executeOffboarding({ plan, store, now: () => NOW + 2000 });
  assert.equal(second.status, "complete");
  assert.equal(second.actions.filter((a) => a.status === "already-revoked").length, OFFBOARDING_TARGETS.length);
});

test("en overskredet frist efterlader rettigheder og giver ikke complete", () => {
  const store = createMemoryOffboardingStore();
  seedRights(store, SUBJECT, rights());
  const plan = planOffboarding({ subject: SUBJECT, deadlineSeconds: 60, now: NOW });
  const result = executeOffboarding({ plan, store, now: () => NOW + 120_000 });
  assert.notEqual(result.status, "complete");
  assert.ok(result.actions.some((a) => a.status === "failed"));
  assert.ok(result.outstanding.length > 0);
});

test("fil-lageret bevarer tilstanden over en genstart", () => {
  const dir = mkdtempSync(join(tmpdir(), "dkc060-offboard-"));
  const store = createFileOffboardingStore({ dir });
  seedRights(store, SUBJECT, { sessions: [{ id: "s1" }], "api-tokens": [{ id: "t1" }] });
  store.revoke("sessions", "s1", "2025-09-01T08:00:05Z");
  const reopened = createFileOffboardingStore({ dir });
  assert.equal(reopened.list("sessions", SUBJECT)[0].revokedAt, "2025-09-01T08:00:05Z");
  assert.equal(reopened.list("api-tokens", SUBJECT)[0].revokedAt, null);
});

test("semantikken afviser en complete-plan med udestående rettigheder", () => {
  const store = createMemoryOffboardingStore();
  seedRights(store, SUBJECT, rights());
  const plan = planOffboarding({ subject: SUBJECT, deadlineSeconds: 600, now: NOW });
  const result = executeOffboarding({ plan, store, now: () => NOW + 1000 });
  assert.equal(offboardingPlanProblems(result).length, 0);
  assert.ok(offboardingPlanProblems({ ...result, outstanding: ["sessions:s1"] }).some((p) => /udestående/.test(p.message)));
  assert.ok(offboardingPlanProblems({ ...result, completeByDeadline: false }).some((p) => /gennemført/.test(p.message)));
});
