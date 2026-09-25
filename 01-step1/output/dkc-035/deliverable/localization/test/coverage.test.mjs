import { test } from "node:test";
import assert from "node:assert/strict";
import { repoRoot } from "../../conformance/src/schemas.mjs";
import { loadAll } from "../src/model.mjs";
import { buildCoverageMatrix, coverageSummary } from "../src/coverage.mjs";

const all = loadAll(repoRoot);
const matrix = buildCoverageMatrix(all.families, all.requirements);

test("dækningsmatricen udledes for hver familie og hvert lokaliseringskrav", () => {
  const expected = all.families.families.reduce((sum, f) => sum + f.localeRequirements.length, 0);
  assert.equal(matrix.length, expected);
});

test("bogføring og løn står 'unsupported', ikke 'full'", () => {
  const accounting = matrix.find((r) => r.family === "finance" && r.requirement === "accounting");
  const payroll = matrix.find((r) => r.family === "hr" && r.requirement === "payroll");
  assert.equal(accounting.status, "unsupported");
  assert.equal(accounting.blocksDanishReady, true);
  assert.equal(payroll.status, "unsupported");
  assert.equal(payroll.blocksDanishReady, true);
});

test("ikke-blokerende krav blokerer ikke men vises ærligt", () => {
  const agreements = matrix.find((r) => r.family === "time" && r.requirement === "agreements");
  assert.equal(agreements.status, "unsupported");
  assert.equal(agreements.blocksDanishReady, false);
});

test("opsummeringen tæller alle statusser", () => {
  const summary = coverageSummary(matrix);
  assert.equal(summary.full + summary.partial + summary.unsupported, matrix.length);
  assert.equal(summary.full, 0);
});
