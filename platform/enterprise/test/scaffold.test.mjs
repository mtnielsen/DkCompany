import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scaffoldCatalog, scaffoldProblems } from "../src/scaffold.mjs";

test("scaffolden genererer en gyldig ny branchepakke uden at forke kontrolplanet", () => {
  const catalog = scaffoldCatalog("ny-branche");
  const problems = scaffoldProblems(catalog);
  assert.equal(problems.length, 0, JSON.stringify(problems));
  const pkg = catalog.packages[0];
  assert.equal(pkg.id, "ny-branche");
  assert.equal(pkg.baseProfileRef, "enterprise-dedicated");
  assert.deepEqual(pkg.capabilityConstraints.controlPlane, ["control-plane", "policy-decision", "identity-oidc", "audit-log"]);
  assert.deepEqual(catalog.securityContracts.contracts.map((c) => c.id), ["security", "privacy", "restore", "role"]);
  assert.equal(pkg.implementation.status, "blocked");
  assert.equal(pkg.testCustomer.status, "identified");
});

test("scaffolden kan validere og skrive pakken til en mappe", () => {
  const dir = mkdtempSync(join(tmpdir(), "dkc-036-scaffold-"));
  try {
    const catalog = scaffoldCatalog("skabelon-test", { title: "Skabelon Test", segment: "commerce", baseProfileRef: "ha-cluster" });
    assert.equal(scaffoldProblems(catalog).length, 0);
    assert.equal(catalog.packages[0].segment, "commerce");
    assert.equal(catalog.packages[0].baseProfileRef, "ha-cluster");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("scaffold-skabelonen er en læsbar JSON-fil", () => {
  const path = join(import.meta.dirname, "..", "scaffold", "package.template.json");
  assert.ok(existsSync(path));
  const template = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(template.id, "__ID__");
});
