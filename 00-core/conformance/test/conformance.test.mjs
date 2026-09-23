import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAjv } from "../src/schemas.mjs";
import { runModule } from "../src/cli.mjs";

test("dummy-ok består konformanssuiten", () => {
  const { ajv } = buildAjv();
  const report = runModule("dummy-ok", { offline: true, ajv });
  assert.equal(report.status, "pass", JSON.stringify(report.checks.filter((c) => c.status === "fail"), null, 2));
  assert.equal(report.summary.fail, 0);
  assert.ok(report.summary.pass >= 8);
});

test("bevidst brudt modul fejler — og fejler på de rigtige checks", () => {
  const { ajv } = buildAjv();
  const report = runModule("dummy-broken", { offline: true, ajv });
  assert.equal(report.status, "fail");
  const failed = new Set(report.checks.filter((c) => c.status === "fail").map((c) => c.id));
  for (const id of ["C-001", "C-002", "C-003", "C-004", "C-005", "C-006", "C-009"]) {
    assert.ok(failed.has(id), `forventede at ${id} fejlede`);
  }
});
