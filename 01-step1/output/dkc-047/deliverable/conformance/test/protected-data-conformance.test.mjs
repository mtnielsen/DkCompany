/**
 * DKC-047 — konformanstests for beskyttede dataklasser.
 *
 * Beviser på de faktiske datafiler at eksemplet validerer, at registeret
 * krydsrefererer mod pilotmoduler/routes, at AI-ændringsforbud, WORM-retention
 * og no-AI-access er adskilte regler, og at lager-/nøglehåndhævelse erklæres
 * ærligt som leveret af DKC-048.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { validateProtectedDataDir, protectedDataProblems } from "../src/protected-data.mjs";
import { loadRegister, checkModuleCoverage, storageEnforcementGaps } from "../../data-protection/src/registry.mjs";

const examplesDir = join(import.meta.dirname, "..", "..", "contracts", "examples");

test("beskyttelsesregister-eksemplet validerer mod skema + semantik", () => {
  const results = validateProtectedDataDir(examplesDir);
  assert.equal(results.length, 1);
  assert.equal(results[0].ok, true, results[0].errors.map((e) => `${e.path} ${e.message}`).join("\n"));
});

test("det kanoniske register krydsrefererer mod pilotmoduler og routes", () => {
  const register = loadRegister();
  assert.deepEqual(checkModuleCoverage({ register }), []);
  const classes = new Set(register.records.map((r) => r.dataClass));
  assert.ok(classes.has("ai-read-only"));
  assert.ok(classes.has("append-only"));
  assert.ok(classes.has("retention-locked"));
  assert.ok(register.records.some((r) => r.noAiAccess === true), "no-AI-access skal optræde som selvstændigt flag");
});

test("uendelig WORM på persondata uden vurderet formål og frist afvises", () => {
  const register = JSON.parse(JSON.stringify(loadRegister()));
  const record = register.records.find((r) => r.dataClass === "retention-locked" && r.dataCategories.includes("personal"));
  delete record.retention;
  const problems = protectedDataProblems(register);
  assert.ok(problems.some((p) => p.message.includes("persondata") || p.path.includes("/retention")));
});

test("fuld lagerhåndhævelse påstås ikke — alle poster erklærer DKC-048-hullet", () => {
  const gaps = storageEnforcementGaps();
  assert.equal(gaps.length, loadRegister().records.length);
  for (const gap of gaps) {
    assert.equal(gap.status, "unsupported");
    assert.equal(gap.deliveredBy, "DKC-048");
  }
});
