/**
 * DKC-055 — rollepolitikken.
 *
 * Beviser at et manifest med flere roller eller en godkenderrolle afvises, og
 * at rollerne ikke kan overskride deres beføjelser.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ROLE_VERBS,
  ROLES,
  roleAllowsVerb,
  roleMayApprove,
  roleMayDeploy,
  roleMayProduce,
  validateRoleManifest,
} from "../src/roles.mjs";
import { validateManifest } from "../../runtime/src/boundary.mjs";
import { manifestFor } from "../fixtures/manifests.mjs";

test("manifest med flere roller afvises", () => {
  const withRolesField = manifestFor("planner");
  withRolesField.roles = ["planner", "implementer"];
  const a = validateRoleManifest(withRolesField);
  assert.equal(a.ok, false);
  assert.ok(a.errors.some((e) => /roles/.test(e.path)));

  const arrayRole = manifestFor("planner");
  arrayRole.role = ["planner", "implementer"];
  const b = validateRoleManifest(arrayRole);
  assert.equal(b.ok, false);
  assert.ok(b.errors.some((e) => /en enkelt streng/.test(e.message)));
});

test("en godkenderrolle for AI afvises", () => {
  for (const role of ["approver", "ai-approver", "admin", "human-approver"]) {
    const result = validateRoleManifest(manifestFor("planner", { role }));
    assert.equal(result.ok, false, role);
    assert.ok(result.errors.some((e) => /godkender|ukendt/.test(e.message)), role);
  }
  assert.equal(roleMayApprove("executor"), false);
  assert.equal(roleMayApprove("verifier"), false);
});

test("planner kan ikke skrive implementeringsartefakt eller deploye", () => {
  assert.equal(roleAllowsVerb("planner", "propose"), true);
  assert.equal(roleAllowsVerb("planner", "upgrade.patch"), false);
  assert.equal(roleAllowsVerb("planner", "restart"), false);
  assert.equal(roleMayDeploy("planner"), false);
  assert.equal(roleMayProduce("planner", "implementation"), false);
  assert.equal(roleMayProduce("planner", "diff"), false);
  assert.equal(roleMayProduce("planner", "plan"), true);

  const bad = manifestFor("planner", { capabilities: [{ verb: "upgrade.patch", target: "dummy-ok", autonomyClass: "A3" }] });
  const result = validateRoleManifest(bad);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /upgrade\.patch/.test(e.message)));
  // Manifestet afvises også af runtimegrænsen.
  assert.equal(validateManifest(bad).ok, false);
});

test("implementer kan køre egne tests, men ikke udstede verifier-resultatet", () => {
  assert.equal(roleAllowsVerb("implementer", "upgrade.dry-run"), true);
  assert.equal(roleAllowsVerb("implementer", "propose"), true);
  assert.equal(roleAllowsVerb("implementer", "restart"), false);
  assert.equal(roleMayProduce("implementer", "diff"), true);
  assert.equal(roleMayProduce("implementer", "implementation"), true);
  assert.equal(roleMayProduce("implementer", "verification"), false);
  assert.equal(roleMayApprove("implementer"), false);
});

test("executor kører kun godkendte handlinger og kan ikke planlægge", () => {
  assert.equal(roleAllowsVerb("executor", "upgrade.patch"), true);
  assert.equal(roleAllowsVerb("executor", "restart"), true);
  assert.equal(roleAllowsVerb("executor", "propose"), false);
  assert.equal(roleMayProduce("executor", "plan"), false);
  assert.equal(roleMayProduce("executor", "implementation"), false);
  assert.equal(roleMayDeploy("executor"), true);
});

test("alle seks roller er dækket og har en verbumliste", () => {
  assert.deepEqual(ROLES, ["observer", "planner", "implementer", "verifier", "executor", "auditor"]);
  for (const role of ROLES) {
    assert.ok(Array.isArray(ROLE_VERBS[role]) && ROLE_VERBS[role].length > 0, role);
    assert.equal(roleMayApprove(role), false, role);
  }
});
