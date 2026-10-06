/**
 * DKC-025 — semantisk kontrol af portal, autorisation og livscyklus.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { authorizationProblems, checkPortal, lifecycleProblems, writePortalDoc } from "../src/check.mjs";
import { ACTIONS, CUSTOMER_TRANSITIONS } from "../src/constants.mjs";
import { PORTAL_POLICY } from "../src/authorization.mjs";

test("den kanoniske portal er konsistent (inkl. dokument)", () => {
  writePortalDoc();
  const { problems, packages } = checkPortal();
  assert.deepEqual(problems, []);
  assert.ok(packages.length >= 4);
});

test("autorisationspolitikken afviser en manglende handling", () => {
  const broken = { ...PORTAL_POLICY };
  delete broken[ACTIONS.ORDER_APPROVE];
  assert.ok(authorizationProblems(broken).some((p) => p.path.includes(ACTIONS.ORDER_APPROVE)));
});

test("autorisationspolitikken afviser en ukendt handling i politikken", () => {
  const broken = { ...PORTAL_POLICY, "customer:teleport": { roles: ["platform-admin"], scope: "platform" } };
  assert.ok(authorizationProblems(broken).some((p) => p.path.includes("customer:teleport")));
});

test("livscyklusdiagrammet afviser en selvovergang", () => {
  const broken = { ...CUSTOMER_TRANSITIONS, active: [...CUSTOMER_TRANSITIONS.active, "active"] };
  assert.ok(lifecycleProblems(undefined, broken).some((p) => p.path === "/lifecycle/active"));
});
