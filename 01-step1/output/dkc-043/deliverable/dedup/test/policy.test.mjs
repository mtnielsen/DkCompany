import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDedupPolicy, dedupPolicyProblems, dedupProviderProblems } from "../src/policy.mjs";
import { validateDedupPolicy } from "../../conformance/src/dedup.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function clone() {
  return structuredClone(loadDedupPolicy(repoRoot));
}

test("den kanoniske dedup-politik validerer med skema og semantik", () => {
  const policy = loadDedupPolicy(repoRoot);
  assert.deepEqual(dedupPolicyProblems(policy), []);
  assert.deepEqual(dedupProviderProblems(policy, repoRoot), []);
  const result = validateDedupPolicy(policy);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("eksemplet er identisk med den kanoniske politik", () => {
  const example = JSON.parse(readFileSync(join(repoRoot, "contracts", "examples", "dedup-policy.example.json"), "utf8"));
  assert.deepEqual(example, loadDedupPolicy(repoRoot));
});

test("tværkundededuplikering afvises", () => {
  const policy = clone();
  policy.crossTenantDedup = true;
  assert.ok(dedupPolicyProblems(policy).some((p) => p.path === "/crossTenantDedup"));
  const domain = clone();
  domain.domains[0].boundary.crossTenantDedup = true;
  assert.ok(dedupPolicyProblems(domain).some((p) => p.path.includes("crossTenantDedup")));
});

test("forretningsposter må aldrig flettes automatisk", () => {
  const policy = clone();
  const business = policy.domains.find((d) => d.category === "business-records");
  business.mergeSemantics = "content-addressed-chunks";
  business.enabled = true;
  const problems = dedupPolicyProblems(policy);
  assert.ok(problems.some((p) => p.path === "/domains/business-records/mergeSemantics"));
  assert.ok(problems.some((p) => p.path === "/domains/business-records/enabled"));
});

test("jobhændelser må kun deduplikeres på idempotency-nøgle", () => {
  const policy = clone();
  const events = policy.domains.find((d) => d.category === "job-events");
  events.mergeSemantics = "content-addressed-chunks";
  assert.ok(dedupPolicyProblems(policy).some((p) => p.path === "/domains/job-events/mergeSemantics"));
});

test("primær dedup kræver validering når den er slået til", () => {
  const policy = clone();
  const primary = policy.domains.find((d) => d.category === "primary-objects");
  primary.enabled = true;
  delete primary.validation;
  const problems = dedupPolicyProblems(policy);
  assert.ok(problems.some((p) => p.path === "/domains/primary-objects/validation"));
});

test("garbage collection og besparelsesgate kan ikke slækkes", () => {
  const noLease = clone();
  noLease.garbageCollection.leaseRequiredForPrune = false;
  assert.ok(dedupPolicyProblems(noLease).some((p) => p.path === "/garbageCollection/leaseRequiredForPrune"));
  const noRestore = clone();
  noRestore.savingsGate.requireFullRestore = false;
  assert.ok(dedupPolicyProblems(noRestore).some((p) => p.path === "/savingsGate/requireFullRestore"));
  const keyInStore = clone();
  keyInStore.keys.storeContainsKey = true;
  assert.ok(dedupPolicyProblems(keyInStore).some((p) => p.path === "/keys/storeContainsKey"));
});
