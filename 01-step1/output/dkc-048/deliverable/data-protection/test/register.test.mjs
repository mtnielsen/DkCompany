/**
 * DKC-047 — register, politik og modul-dækning.
 *
 * Beviser at registeret validerer og krydsrefererer, at hvert pilotmodul ærligt
 * erklærer sin dataProtection-capability, og at semantikken afviser en ubestemt
 * WORM-lås på persondata, manglende forbud og en ubevist påstand om fuld
 * lagerhåndhævelse.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPolicy, loadRegister, checkModuleCoverage, storageEnforcementGaps, policyProblems } from "../src/registry.mjs";
import { protectedDataProblems } from "../../conformance/src/protected-data.mjs";

const clone = () => JSON.parse(JSON.stringify(loadRegister()));

test("register og politik validerer og krydsrefererer", () => {
  const register = loadRegister();
  const policy = loadPolicy();
  assert.deepEqual(policyProblems(policy), []);
  assert.deepEqual(checkModuleCoverage({ register }), []);
  assert.ok(register.records.length >= 5);
});

test("hver post erklærer fuld lager-/nøglehåndhævelse leveret af DKC-048", () => {
  const register = loadRegister();
  const gaps = storageEnforcementGaps();
  assert.equal(gaps.length, 0);
  for (const record of register.records) {
    assert.equal(record.storageEnforcement.status, "full");
    assert.equal(record.storageEnforcement.deliveredBy, "DKC-048");
    assert.ok(record.evidence.length > 0);
  }
});

test("en retention-locked persondatapost uden vurderet frist afvises", () => {
  const register = clone();
  const record = register.records.find((r) => r.dataClass === "retention-locked" && r.dataCategories.includes("personal"));
  assert.ok(record, "testen kræver en WORM-persondatapost");
  delete record.retention;
  const problems = protectedDataProblems(register);
  assert.ok(problems.some((p) => p.path.includes("/retention")));
});

test("en beskyttet post uden alle otte forbud afvises", () => {
  const register = clone();
  register.records[0].prohibitions = ["direct-change"];
  const problems = protectedDataProblems(register);
  assert.ok(problems.some((p) => p.path.includes("/prohibitions")));
});

test("fuld lagerhåndhævelse uden bevis afvises", () => {
  const register = clone();
  register.records[0].storageEnforcement = { status: "full", reason: "Påstået fuld WORM uden bevis." };
  register.records[0].evidence = [];
  const problems = protectedDataProblems(register);
  assert.ok(problems.some((p) => p.path.includes("/storageEnforcement")));
});

test("politikken skal holde de tre forbud adskilt", () => {
  const policy = clonePolicy();
  policy.noAiAccessDeniesAll = false;
  policy.reclassificationHumanOnly = false;
  policy.aiForbiddenOperations = [];
  const problems = policyProblems(policy);
  assert.ok(problems.length >= 3);
});

function clonePolicy() {
  return JSON.parse(JSON.stringify(loadPolicy()));
}
