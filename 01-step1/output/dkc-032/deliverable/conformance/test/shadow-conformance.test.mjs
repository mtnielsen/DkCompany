/**
 * DKC-032 — konformanstest for AI i skyggetilstand og begrænset autonomi.
 *
 * Tester skema + semantik på den faktiske bevilling og eksemplerne, at et brud
 * afvises, og at den kørte rapport er deterministisk, at skyggetilstanden ikke
 * udfører mutationer, og at gaten er pass. En målt kørsel mod en levende model
 * og stagingklynge er og forbliver NOT RUN.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../src/schemas.mjs";
import { validateAutonomyGrant, validateShadowRun } from "../src/shadow.mjs";
import { autonomyPolicyProblems, shadowRunProblems } from "../../shadow/src/policy.mjs";
import { runShadowSuite } from "../../shadow/src/runner.mjs";
import { renderShadowReport } from "../../shadow/src/report.mjs";

const policy = JSON.parse(readFileSync(join(repoRoot, "shadow/autonomy-policy.json"), "utf8"));
const grantExample = JSON.parse(readFileSync(join(repoRoot, "contracts/examples/autonomy-grant.example.json"), "utf8"));
const runExample = JSON.parse(readFileSync(join(repoRoot, "contracts/examples/shadow-run.example.json"), "utf8"));

test("den faktiske autonomibevilling validerer mod skema og semantik", () => {
  const result = validateAutonomyGrant(policy);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("bevillings- og skyggekørsels-eksemplerne validerer", () => {
  assert.equal(validateAutonomyGrant(grantExample).ok, true, JSON.stringify(validateAutonomyGrant(grantExample).errors));
  assert.equal(validateShadowRun(runExample).ok, true, JSON.stringify(validateShadowRun(runExample).errors));
});

test("et irreversibelt verbum i bevillingens scope afvises", () => {
  const broken = { ...policy, scope: { ...policy.scope, verbs: [...policy.scope.verbs, "migrate"] } };
  assert.ok(autonomyPolicyProblems(broken).length > 0);
});

test("en begrænset autonomi uden gentaget evaluering afvises", () => {
  const broken = { ...policy, evaluation: { ...policy.evaluation, runs: policy.evaluation.runs.slice(0, 1), minEvaluationRuns: 3 } };
  assert.ok(autonomyPolicyProblems(broken).length > 0);
});

test("en skyggekørsel med en mutation afvises", () => {
  const broken = { ...runExample, mutationCount: 1, metrics: { ...runExample.metrics, executedMutations: 1 } };
  assert.ok(shadowRunProblems(broken).length > 0);
});

test("den kørte rapport er deterministisk, nul-mutation og gaten er pass", async () => {
  const report = await runShadowSuite(repoRoot);
  assert.equal(report.gate.status, "pass", JSON.stringify(report.gate.reasons));
  assert.equal(report.shadow.mutationCount, 0);
  assert.equal(report.shadow.verdict, "pass");
  assert.ok(report.limitedAutonomy.metrics.executedMutations > 0);
  assert.ok(renderShadowReport(report).includes("AI i skyggetilstand"));
  assert.equal(report.shadow.eventsReplayed, 48);
  assert.equal(report.limitedAutonomy.eventsReplayed, 48);
});
