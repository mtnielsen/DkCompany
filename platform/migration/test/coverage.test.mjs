import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, AT } from "./helpers.mjs";
import { buildCoverage, lostFunctionalityFor } from "../src/coverage.mjs";
import { migrationCoverageProblems, COVERAGE_FACETS } from "../src/model.mjs";

test("dækningsmatricen dækker alle app/entitet/facet-kombinationer", () => {
  const { all, coverage } = fixture();
  const expected = all.sources.sources.reduce((sum, s) => sum + s.entityTypes.length * COVERAGE_FACETS.length, 0);
  assert.equal(coverage.matrix.length, expected);
  assert.equal(migrationCoverageProblems(coverage, { sources: all.sources.sources }).length, 0);
});

test("enhver ikke-fuld facet vises som tabt funktionalitet med forklaring", () => {
  const { all, coverage } = fixture();
  const expected = coverage.matrix.filter((row) => row.status !== "full");
  assert.equal(coverage.lostFunctionality.length, expected.length);
  assert.ok(coverage.lostFunctionality.length > 0);
  for (const entry of coverage.lostFunctionality) assert.ok(entry.note && entry.note.length > 5);
  assert.ok(lostFunctionalityFor(coverage, "files").length >= 1);
});

test("en ændret status uden forklaring afvises", () => {
  const { all, coverage } = fixture();
  const broken = structuredClone(coverage);
  broken.matrix[0].status = "partial";
  broken.matrix[0].note = null;
  const problems = migrationCoverageProblems(broken, { sources: all.sources.sources });
  assert.ok(problems.length > 0);
});

test("en matrix der ikke matcher kilden afvises", () => {
  const { all, coverage } = fixture();
  const broken = structuredClone(coverage);
  broken.matrix[0].status = broken.matrix[0].status === "full" ? "partial" : "full";
  const problems = migrationCoverageProblems(broken, { sources: all.sources.sources });
  assert.ok(problems.some((p) => /matricen siger/.test(p.message)));
});

test("buildCoverage er deterministisk", () => {
  const a = buildCoverage({ sources: fixture().all.sources, at: AT });
  const b = buildCoverage({ sources: fixture().all.sources, at: AT });
  assert.deepEqual(a, b);
});
