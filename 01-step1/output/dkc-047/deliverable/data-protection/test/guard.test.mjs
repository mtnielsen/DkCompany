/**
 * DKC-047 — beskyttelsesguarden: tre adskilte forbud.
 *
 * Beviser at AI-ændringsforbud, WORM-retention og AI-læseforbud ikke smelter
 * sammen: en AI må læse ai-read-only men ikke ændre den; append-only tillader
 * append men ikke update/delete; retention-locked er immutable; og no-AI-access
 * udelukker alle flows, også retrieval, prompts, logs og træning/analyse.
 * Desuden at app-, admin- og restore-adaptere deler samme regel.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPolicy, loadRegister, createProtectedDataGuard } from "../src/registry.mjs";
import { evaluateProtectedData, guardAdapterCall, authorizeReclassification, transitionProblems } from "../src/guard.mjs";

const policy = loadPolicy();
const anna = { subject: "oidc|anna.andersen", name: "Anna Andersen", role: "Platform Owner" };
const agent = { kind: "agent", id: "spiffe://platform.example.org/agents/x" };
const human = { kind: "human", id: "oidc|anna.andersen" };

const record = (over = {}) => ({
  id: "rec",
  dataClass: "ai-read-only",
  noAiAccess: false,
  reclassifiers: [anna],
  humanProcess: {},
  ...over,
});

const evaluate = (operation, over = {}, principal = agent) =>
  evaluateProtectedData({ principal, operation, record: record(over), policy });

test("ai-read-only: AI må læse, men ikke ændre", () => {
  for (const op of ["read", "retrieve", "prompt", "train", "analyze", "log-access"]) {
    assert.equal(evaluate(op).allowed, true, `'${op}' skulle være tilladt`);
  }
  for (const op of ["append", "update", "delete", "copy", "export", "restore", "reclassify", "pointer-update", "key-rotate"]) {
    assert.equal(evaluate(op).allowed, false, `'${op}' skulle være afvist`);
  }
});

test("append-only: AI må tilføje, men ikke ændre eller slette", () => {
  const over = { dataClass: "append-only" };
  assert.equal(evaluate("append", over).allowed, true);
  assert.equal(evaluate("read", over).allowed, true);
  assert.equal(evaluate("update", over).allowed, false);
  assert.equal(evaluate("delete", over).allowed, false);
});

test("retention-locked: WORM — AI må kun læse/hente", () => {
  const over = { dataClass: "retention-locked" };
  assert.equal(evaluate("read", over).allowed, true);
  assert.equal(evaluate("retrieve", over).allowed, true);
  assert.equal(evaluate("append", over).allowed, false);
  assert.equal(evaluate("update", over).allowed, false);
  assert.equal(evaluate("prompt", over).allowed, false);
});

test("no-AI-access er et selvstændigt flag og udelukker alle AI-flows", () => {
  const over = { dataClass: "ordinary", noAiAccess: true };
  for (const op of ["read", "retrieve", "prompt", "train", "analyze", "log-access", "append", "update", "delete", "copy", "export", "restore"]) {
    assert.equal(evaluate(op, over).allowed, false, `'${op}' skulle være blokeret af no-AI-access`);
  }
});

test("app-, admin- og restore-adaptere kan ikke omgå beskyttelsen", () => {
  for (const adapter of ["app", "admin", "restore"]) {
    const result = guardAdapterCall({ adapter, principal: agent, operation: "update", record: record(), policy });
    assert.equal(result.allowed, false, `'${adapter}'-adapteren slap igennem`);
    assert.ok(result.reasons.some((r) => r.includes(adapter)));
  }
});

test("AI kan ikke omklassificere eller omskrive den autoritative pointer", () => {
  assert.equal(evaluate("reclassify").allowed, false);
  assert.equal(evaluate("pointer-update").allowed, false);
  const rc = authorizeReclassification({ principal: agent, record: record(), newClass: "ordinary", policy });
  assert.equal(rc.allowed, false);
});

test("kun et navngivet menneske i reclassifiers må omklassificere", () => {
  const outsider = authorizeReclassification({ principal: { kind: "human", id: "oidc|bo.bertelsen" }, record: record(), newClass: "ordinary", policy });
  assert.equal(outsider.allowed, false);
  const owner = authorizeReclassification({ principal: human, record: record(), newClass: "ordinary", policy });
  assert.equal(owner.allowed, true);
  assert.ok(owner.obligations.includes("human-process:newVersion"));
});

test("transitionProblems kræver at beskyttelsen bevares", () => {
  assert.deepEqual(transitionProblems(record(), record()), []);
  assert.ok(transitionProblems(record(), { dataClass: "ordinary", noAiAccess: false }).length > 0);
  assert.ok(transitionProblems(record(), { dataClass: "ai-read-only", noAiAccess: true }).length > 0);
  assert.ok(transitionProblems(record(), null).length > 0);
});

test("registeret kan slå beskyttede targets op og guard'e dem", () => {
  const register = loadRegister();
  const guard = createProtectedDataGuard({ register, policy });
  assert.equal(guard.resolve("policy-bundle").dataClass, "retention-locked");
  assert.equal(guard.resolve("tenants/current").id, "tenant-records");
  assert.equal(guard.resolve("helt-ukendt"), null);
  assert.equal(guard.evaluate({ principal: agent, operation: "update", target: "policy-bundle" }).allowed, false);
  assert.equal(guard.evaluate({ principal: agent, operation: "read", target: "tenant-records" }).allowed, true);
});
