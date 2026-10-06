import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateLogRecord, validateLoggingPolicy, validateLogAccessDecision } from "../src/logging.mjs";
import { repoRoot } from "../src/schemas.mjs";

const example = (name) => JSON.parse(readFileSync(join(repoRoot, "contracts", "examples", name), "utf8"));
const clone = (name) => structuredClone(example(name));

test("den kanoniske loggepolitik validerer og matcher eksemplet", () => {
  const policy = example("logging-policy.example.json");
  assert.equal(validateLoggingPolicy(policy).ok, true);
  const canonical = JSON.parse(readFileSync(join(repoRoot, "logging", "logging-policy.json"), "utf8"));
  assert.deepEqual(policy, canonical);
});

test("sensor-, model- og verificerede logposter validerer", () => {
  for (const name of ["log-record.example.json", "log-record.model.example.json", "log-record.verified.example.json"]) {
    const result = validateLogRecord(example(name));
    assert.equal(result.ok, true, `${name}: ${JSON.stringify(result.errors)}`);
  }
});

test("logadgangsbeslutningen validerer", () => {
  assert.equal(validateLogAccessDecision(example("log-access-decision.example.json")).ok, true);
});

test("en modelpost der blander en sensorobservation afvises", () => {
  const broken = clone("log-record.model.example.json");
  broken.observation = { source: "otel", freshness: "fresh", value: {} };
  const result = validateLogRecord(broken);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /observation/.test(e.path)));
});

test("en muterende modelhandling uden holdbar kvittering afvises", () => {
  const broken = clone("log-record.model.example.json");
  delete broken.receipt;
  const result = validateLogRecord(broken);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /receipt/.test(e.path)));
});

test("en logpost med en hemmelighed afvises", () => {
  const broken = clone("log-record.example.json");
  broken.observation.value = { password: "hunter2" };
  const result = validateLogRecord(broken);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /hemmelighed/.test(e.message)));
});

test("en politik uden WORM-krav for persondata afvises", () => {
  const broken = clone("logging-policy.example.json");
  broken.archive.requireImmutableFor = [];
  broken.archive.targets = broken.archive.targets.map((t) => ({ ...t, immutable: false }));
  const result = validateLoggingPolicy(broken);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /immutabelt|WORM/.test(e.message)));
});

test("en nægtet logadgang der returnerer poster afvises", () => {
  const broken = clone("log-access-decision.example.json");
  broken.decision = "deny";
  broken.reason = "manglende rolle";
  broken.recordsReturned = 3;
  const result = validateLogAccessDecision(broken);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /recordsReturned/.test(e.path)));
});
