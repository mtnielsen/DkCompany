import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { disasterRecoveryPlanProblems, loadDisasterRecoveryPlan, loadRecoveryAccessProfile } from "../src/dr/plan.mjs";
import { recoveryAccessProblems } from "../src/dr/access.mjs";
import { validateDisasterRecoveryPlan } from "../../conformance/src/disaster-recovery.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function clone() {
  return structuredClone(loadDisasterRecoveryPlan(repoRoot));
}

test("den kanoniske plan og recovery-adgangsprofil validerer", () => {
  const plan = loadDisasterRecoveryPlan(repoRoot);
  const profile = loadRecoveryAccessProfile(repoRoot);
  assert.deepEqual(disasterRecoveryPlanProblems(plan), []);
  assert.deepEqual(recoveryAccessProblems(profile), []);
  const result = validateDisasterRecoveryPlan(plan);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("3-2-1-1-0-tallene skal stemme med de faktiske kopier", () => {
  const plan = clone();
  plan.principle.copies = 99;
  assert.ok(disasterRecoveryPlanProblems(plan).some((p) => p.path === "/principle/copies"));
});

test("primærklyngens driftscredentials må ikke kunne slette beskyttede backups", () => {
  const plan = clone();
  plan.primaryCluster.canDeleteProtectedBackups = true;
  assert.ok(disasterRecoveryPlanProblems(plan).some((p) => p.path === "/primaryCluster/canDeleteProtectedBackups"));
  const plan2 = clone();
  plan2.primaryCluster.forbiddenOperations = ["retention-shorten"];
  assert.ok(disasterRecoveryPlanProblems(plan2).some((p) => p.path === "/primaryCluster/forbiddenOperations"));
});

test("den offline/immutable kopi må ikke dele credentials med primærdriften", () => {
  const plan = clone();
  const offline = plan.copies.find((c) => c.copyType === "offline-immutable");
  offline.credentialsRef = plan.primaryCluster.credentialsRef;
  assert.ok(disasterRecoveryPlanProblems(plan).some((p) => /credentialsRef/.test(p.path) && /immutable/.test(p.message)));
});

test("tabet af IAM, DNS og secret-store skal indgå i både miljø og brugerflow", () => {
  const plan = clone();
  plan.recoveryEnvironment.dependencies = plan.recoveryEnvironment.dependencies.filter((d) => d.component !== "iam");
  plan.userFlow.includesDependencies = plan.userFlow.includesDependencies.filter((c) => c !== "secret-store");
  const problems = disasterRecoveryPlanProblems(plan);
  assert.ok(problems.some((p) => p.path === "/recoveryEnvironment/dependencies"));
  assert.ok(problems.some((p) => p.path === "/userFlow/includesDependencies"));
});

test("PITR kræver WAL, applikationskonsistens og ACL-afstemning", () => {
  const plan = clone();
  plan.pitr.pitrEnabled = false;
  plan.pitr.aclReconciliation.required = false;
  plan.pitr.snapshotAloneIsInsufficient = false;
  const problems = disasterRecoveryPlanProblems(plan);
  assert.ok(problems.some((p) => p.path === "/pitr/pitrEnabled"));
  assert.ok(problems.some((p) => p.path === "/pitr/aclReconciliation/required"));
  assert.ok(problems.some((p) => p.path === "/pitr/snapshotAloneIsInsufficient"));
});

test("recovery-adgangen må ikke give primærklyngens driftsrolle adgang", () => {
  const profile = structuredClone(loadRecoveryAccessProfile(repoRoot));
  profile.accessPolicy.allowedRoles.push(profile.primaryOperations.roleId);
  assert.ok(recoveryAccessProblems(profile).some((p) => /primærklyngens driftsrolle/.test(p.message)));
});
