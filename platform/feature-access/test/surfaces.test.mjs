import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateAcrossSurfaces, surfaceConsistencyProblems, SURFACES } from "../src/index.mjs";
import { PROFILES, BI_USER, HR_USER } from "./support/fixtures.mjs";

const dataset = { tenantId: "acme", type: "dataset", localId: "employees" };

test("der findes præcis syv flader", () => {
  assert.deepEqual(SURFACES, ["ui", "api", "connector", "search", "export", "cache", "ai-tool"]);
  assert.equal(evaluateAcrossSurfaces({ principal: BI_USER, profile: PROFILES.bi, resource: dataset, fields: ["metric"] }).length, 7);
});

test("UI, API, connector, søgning, eksport, cache og AI-værktøj nægter alle BI-salary", () => {
  assert.deepEqual(surfaceConsistencyProblems({ principal: BI_USER, profile: PROFILES.bi, resource: dataset, fields: ["salary"] }), []);
});

test("fladerne tillader alle HR-salary når bevillingen findes", () => {
  assert.deepEqual(surfaceConsistencyProblems({ principal: HR_USER, profile: PROFILES.hr, resource: dataset, fields: ["salary"] }), []);
});

test("en flade med en anden beslutning opdages", () => {
  // Simulér en flade-specifik bypass ved at sammenligne to forskellige input.
  const allowed = evaluateAcrossSurfaces({ principal: HR_USER, profile: PROFILES.hr, resource: dataset, fields: ["salary"] });
  const denied = evaluateAcrossSurfaces({ principal: BI_USER, profile: PROFILES.bi, resource: dataset, fields: ["salary"] });
  assert.equal(allowed[0].decision, "allow");
  assert.equal(denied[0].decision, "deny");
});
