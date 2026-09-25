import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateAssuranceRegisterDir, validateEvidencePackageDir, validateAssuranceRegister, validateEvidencePackage, assurancePackageProblems } from "../src/assurance.mjs";
import { loadAssuranceRegister } from "../../compliance/src/assurance.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const examplesDir = join(repoRoot, "contracts", "examples");

test("assurance-register- og evidenspakke-eksemplerne validerer (skema + semantik)", () => {
  const registers = validateAssuranceRegisterDir(examplesDir);
  assert.equal(registers.length, 1);
  assert.equal(registers[0].ok, true, JSON.stringify(registers[0].errors));
  const packages = validateEvidencePackageDir(examplesDir);
  assert.equal(packages.length, 1);
  assert.equal(packages[0].ok, true, JSON.stringify(packages[0].errors));
});

test("det kanoniske register validerer via conformance-validatoren", () => {
  const result = validateAssuranceRegister(loadAssuranceRegister(repoRoot));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("et badge uden driftsbevis kan ikke være productionReady", () => {
  const pkg = JSON.parse(readFileSync(join(examplesDir, "evidence-package.example.json"), "utf8"));
  assert.equal(pkg.badge, "fixture-only");
  assert.equal(pkg.productionReady, false);
  const forged = structuredClone(pkg);
  forged.productionReady = true;
  forged.badge = "production";
  assert.ok(assurancePackageProblems(forged).some((p) => p.path === "/missingAssessments"));
});

test("en evidenspakke må ikke hævde certificering", () => {
  const pkg = JSON.parse(readFileSync(join(examplesDir, "evidence-package.example.json"), "utf8"));
  const forged = structuredClone(pkg);
  forged.notACertification = false;
  assert.equal(validateEvidencePackage(forged).ok, false);
});

test("summary skal matche pakkens indhold", () => {
  const pkg = JSON.parse(readFileSync(join(examplesDir, "evidence-package.example.json"), "utf8"));
  const broken = structuredClone(pkg);
  broken.summary.requirements = 999;
  assert.ok(validateEvidencePackage(broken).errors.some((e) => e.path === "/summary/requirements"));
});

test("en accepteret pakke skal have et accepttidspunkt", () => {
  const pkg = JSON.parse(readFileSync(join(examplesDir, "evidence-package.example.json"), "utf8"));
  const broken = structuredClone(pkg);
  broken.acceptedBy = { subject: "oidc|anna.andersen", name: "Anna Andersen", role: "Platform Owner", date: "2026-09-24", decisionRef: "docs/x.md" };
  broken.acceptedAt = null;
  assert.ok(validateEvidencePackage(broken).errors.some((e) => e.path === "/acceptedAt"));
});
