/**
 * DKC-007 — enhedstest af den fælles klassifikation.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  capabilityWithinOwned,
  isA4Violation,
  isMutatingVerb,
  isProtectedResource,
  normalizeResource,
  withinScope,
} from "../src/classification.mjs";

test("normalisering samler case, encoding, separatorer og sti-tricks", () => {
  assert.equal(normalizeResource("POLICY/Bundles"), "policy/bundles");
  assert.equal(normalizeResource("policy%2Fbundles"), "policy/bundles");
  assert.equal(normalizeResource("policy/./bundles"), "policy/bundles");
  assert.equal(normalizeResource("policy//bundles/"), "policy/bundles");
  assert.equal(normalizeResource("policy\\bundles"), "policy/bundles");
  assert.equal(normalizeResource("audit_service"), "audit_service");
});

test("beskyttede A4-ressourcer fanges i alle skrivemåder", () => {
  for (const target of ["policy", "POLICY/Bundles", "policy%2Fbundles", "policy-bundles", "policy.bundles", "audit-log", "audit_log", "audit-service", "governance/rights", "permissions", "keys", "res://acme/policy/7"]) {
    assert.equal(isProtectedResource(target), true, `${target} skulle være beskyttet`);
  }
  for (const target of ["dummy-ok", "dummy-ok/child", "billing", "metrics/policy-latency"]) {
    assert.equal(isProtectedResource(target), false, `${target} skulle ikke være beskyttet`);
  }
});

test("ukendte verber regnes som muterende (fail-safe)", () => {
  assert.equal(isMutatingVerb("upgrade.hotfix"), true);
  assert.equal(isMutatingVerb("config.rollback"), true);
  assert.equal(isMutatingVerb("totally.new.verb"), true);
  assert.equal(isMutatingVerb("observe.read"), false);
  assert.equal(isMutatingVerb("upgrade.dry-run"), false);
});

test("A4 kræver både et muterende verbum og en beskyttet ressource", () => {
  assert.equal(isA4Violation("upgrade.hotfix", "policy/bundles"), true);
  assert.equal(isA4Violation("observe.read", "policy/bundles"), false);
  assert.equal(isA4Violation("upgrade.hotfix", "dummy-ok"), false);
});

test("scope er ensrettet: child dækker ikke forælderen", () => {
  assert.equal(withinScope("dummy-ok", "dummy-ok"), true);
  assert.equal(withinScope("dummy-ok/child", "dummy-ok"), true);
  assert.equal(withinScope("dummy-ok/child/grand", "dummy-ok"), true);
  assert.equal(withinScope("dummy-ok", "dummy-ok/child"), false, "child-scope må ikke åbne forælderen");
  assert.equal(withinScope("other", "dummy-ok"), false);
  assert.equal(withinScope("dummy-ok/a", "dummy-ok/*"), true);
  assert.equal(withinScope("dummy-ok", "dummy-ok/*"), false);
});

test("capability skal ligge inden for de ejede komponenter", () => {
  assert.equal(capabilityWithinOwned("dummy-ok", ["dummy-ok"]), true);
  assert.equal(capabilityWithinOwned("dummy-ok/child", ["dummy-ok"]), true);
  assert.equal(capabilityWithinOwned("other", ["dummy-ok"]), false);
  assert.equal(capabilityWithinOwned("dummy-ok", ["dummy-ok/child"]), false, "forælder er ikke inden for child");
});
