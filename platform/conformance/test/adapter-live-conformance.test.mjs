import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { contractsDir, repoRoot } from "../src/schemas.mjs";
import { validateAdapterUpgradePlan, validateAdapterUpgradePlanDir, validateLiveTargets } from "../src/adapter-live.mjs";
import { loadLiveTargets, liveTargetsProblems } from "../../adapter-sdk/src/live.mjs";

const examplesDir = join(contractsDir, "examples");
const manifestDir = join(repoRoot, "modules");
const json = (p) => JSON.parse(readFileSync(p, "utf8"));

test("live-målene er pinnet og konsistente med releaseprofilerne", () => {
  assert.deepEqual(validateLiveTargets(repoRoot), []);
});

test("de committede opgraderings-/rollbackplaner validerer (skema + semantik)", () => {
  const results = validateAdapterUpgradePlanDir(examplesDir, { manifestDir });
  assert.ok(results.length >= 2);
  for (const r of results) assert.equal(r.ok, true, `${r.file}: ${r.errors.map((e) => `${e.path} ${e.message}`).join("; ")}`);
});

test("en opgraderingsplan uden for den understøttede serie afvises", () => {
  const plan = json(join(examplesDir, "upstream-upgrade-plan.mattermost-adapter.example.json"));
  const profile = json(join(examplesDir, "upstream-release-profile.mattermost-adapter.example.json"));
  const candidate = json(join(examplesDir, "integration-candidate.mattermost-adapter.example.json"));
  plan.to.version = "11.0.0";
  const { ok, errors } = validateAdapterUpgradePlan(plan, undefined, { releaseProfile: profile, candidate });
  assert.equal(ok, false);
  assert.ok(errors.some((e) => /to\/version/.test(e.path)));
});

test("en live-prøve der forventer full på et partial-verbum afvises", () => {
  const manifest = loadLiveTargets(repoRoot);
  const target = manifest.targets.find((t) => t.module === "mattermost-adapter");
  const erase = target.checks.find((c) => c.verb === "subject.erase");
  delete erase.expectPartial;
  const problems = liveTargetsProblems(manifest, {
    load: (t) => ({
      profile: json(join(examplesDir, `upstream-release-profile.${t.module}.example.json`)),
      candidate: json(join(examplesDir, `integration-candidate.${t.module}.example.json`)),
      manifest: json(join(manifestDir, t.module, "module-manifest.json")),
    }),
  });
  assert.ok(problems.some((p) => /subject\.erase/.test(p) && /partial/.test(p)));
});
