import { test } from "node:test";
import assert from "node:assert/strict";
import { loadStoragePlan } from "../src/plan.mjs";
import { runStorageDrill } from "../src/drill.mjs";
import { repoRoot } from "../../conformance/src/schemas.mjs";

const plan = loadStoragePlan(repoRoot);

test("holdbarhedsøvelsen består alle fem acceptkrav", () => {
  const result = runStorageDrill(plan, { now: Date.now() });
  assert.equal(result.ok, true, JSON.stringify(result.checks));
  assert.equal(result.measured, false);
  assert.equal(result.evidenceKind, "simulation");
  assert.equal(result.requiresLiveMeasurement, true);
  for (const [name, ok] of Object.entries(result.checks)) {
    assert.equal(ok, true, `check '${name}' fejlede`);
  }
  assert.ok(result.corruptionsDetected >= 1);
  assert.equal(result.repaired, 1);
  assert.equal(result.relocation.sameFiles, true);
});
