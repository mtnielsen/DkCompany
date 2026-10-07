/**
 * DKC-021 — slettepolitikkens dækning og semantik.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPolicy, loadCommittedExample } from "../src/registry.mjs";
import { deletionPolicyProblems, REQUIRED_SURFACE_KINDS } from "../src/policy.mjs";
import { validateDeletionPolicy } from "../../conformance/src/retention.mjs";

test("den kanoniske politik validerer mod kontrakt og semantik", () => {
  const result = validateDeletionPolicy(loadPolicy());
  assert.equal(result.ok, true, result.errors.map((e) => `${e.path} ${e.message}`).join("; "));
});

test("det committede eksempel er identisk med den kanoniske politik", () => {
  assert.deepEqual(loadCommittedExample(), loadPolicy());
});

test("politikken dækker alle fem obligatoriske datalag", () => {
  const policy = loadPolicy();
  const kinds = new Set(policy.surfaces.map((s) => s.kind));
  for (const kind of REQUIRED_SURFACE_KINDS) assert.ok(kinds.has(kind), `mangler datalaget ${kind}`);
});

test("en partial/unsupported flade kræver en begrundelse", () => {
  const policy = structuredClone(loadPolicy());
  const surface = policy.surfaces.find((s) => s.coverage === "partial");
  delete surface.reason;
  assert.ok(deletionPolicyProblems(policy).some((p) => p.path.includes("/reason")));
});

test("en politik uden backupdækning afvises", () => {
  const policy = structuredClone(loadPolicy());
  policy.surfaces = policy.surfaces.filter((s) => s.kind !== "backup");
  assert.ok(deletionPolicyProblems(policy).some((p) => p.path === "/surfaces"));
});

test("en politik hvor hold ikke blokerer sletning afvises", () => {
  const policy = structuredClone(loadPolicy());
  policy.rules.holdBlocksDeletion = false;
  assert.ok(deletionPolicyProblems(policy).some((p) => p.path === "/rules/holdBlocksDeletion"));
});

test("en politik hvor AI må slette afvises", () => {
  const policy = structuredClone(loadPolicy());
  policy.principals.aiDenied = false;
  assert.ok(deletionPolicyProblems(policy).some((p) => p.path === "/principals/aiDenied"));
});

test("en backupflade der påstår at håndhæve hold fysisk afvises", () => {
  const policy = structuredClone(loadPolicy());
  policy.surfaces.find((s) => s.kind === "backup").legalHoldSupported = true;
  assert.ok(deletionPolicyProblems(policy).some((p) => p.path.includes("/legalHoldSupported")));
});
