/**
 * DKC-062 — test af de kørebare acceptscenarier.
 *
 * Installations- og fjernelsesrejserne eksekveres mod den faktiske installer-
 * og livscykluskode i midlertidige arbejdstræer. En rigtig VPS/lokal/HA-
 * installation er og forbliver NOT RUN.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../../conformance/src/schemas.mjs";
import { loadDesiredState, loadHostScope } from "../../configuration/src/model.mjs";
import { loadAll } from "../src/acceptance-model.mjs";
import { runAcceptanceScenarios, probeRoleSeparation } from "../src/acceptance-run.mjs";

const keyring = JSON.parse(readFileSync(join(repoRoot, "configuration", "dev-keyring.json"), "utf8"));
const config = loadDesiredState(repoRoot);
const hostScopeBase = loadHostScope(repoRoot);
const all = loadAll(repoRoot);

function subset(ids) {
  return { ...all.scenarios, scenarios: all.scenarios.scenarios.filter((s) => ids.includes(s.id)) };
}

test("ren installation og udvidelse består deterministisk", async () => {
  const outcomes = await runAcceptanceScenarios(repoRoot, {
    scenarioSet: subset(["install-clean-small-vps-local", "expand-add-hr", "install-clean-small-vps-vps"]),
    keyring,
    config,
    hostScopeBase,
  });
  assert.equal(outcomes.length, 3);
  for (const outcome of outcomes) assert.equal(outcome.status, "passed", `${outcome.id}: ${outcome.problems.join("; ")}`);
  const expand = outcomes.find((o) => o.id === "expand-add-hr");
  assert.ok(expand.closure.includes("hr"));
});

test("afbrudt installation genoptages og består", async () => {
  const outcomes = await runAcceptanceScenarios(repoRoot, {
    scenarioSet: subset(["install-interrupted-resumed"]),
    keyring,
    config,
    hostScopeBase,
  });
  assert.equal(outcomes[0].status, "passed", outcomes[0].problems.join("; "));
  assert.equal(outcomes[0].steps.find((s) => s.id === "install").status, "resumable");
  assert.equal(outcomes[0].steps.find((s) => s.id === "resume").status, "ok");
});

test("fjernelse bevarer data", async () => {
  const outcomes = await runAcceptanceScenarios(repoRoot, {
    scenarioSet: subset(["remove-app-preserve-data"]),
    keyring,
    config,
    hostScopeBase,
  });
  assert.equal(outcomes[0].status, "passed", outcomes[0].problems.join("; "));
  assert.equal(outcomes[0].preserve, true);
});

test("rolle-adskillelsen holder i scenariekørslen", () => {
  assert.deepEqual(probeRoleSeparation(), []);
});
