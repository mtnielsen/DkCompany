import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildUpgradePlan, upgradePlanProblems } from "../src/upgrade.mjs";
import { validateAdapterUpgradePlanDir } from "../../conformance/src/adapter-live.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const examplesDir = join(repoRoot, "contracts", "examples");

const profile = JSON.parse(readFileSync(join(examplesDir, "upstream-release-profile.mattermost-adapter.example.json"), "utf8"));
const candidate = JSON.parse(readFileSync(join(examplesDir, "integration-candidate.mattermost-adapter.example.json"), "utf8"));

test("en målversion i en understøttet serie giver en planlagt plan med rollback", () => {
  const plan = buildUpgradePlan({ adapter: "mattermost-adapter", current: { version: "10.0.0", edition: "Enterprise" }, target: { version: "10.1.0", edition: "Enterprise" }, releaseProfile: profile, candidate });
  assert.equal(plan.status, "planned");
  assert.deepEqual(plan.blockers, []);
  assert.equal(plan.rollback.backupRequired, true);
  assert.equal(plan.matchesRange, "^10.0.0");
  assert.deepEqual(upgradePlanProblems(plan, { releaseProfile: profile, candidate }), []);
});

test("en målversion uden for serien blokeres og kræver en ny kandidat", () => {
  const plan = buildUpgradePlan({ adapter: "mattermost-adapter", current: { version: "10.0.0", edition: "Enterprise" }, target: { version: "11.0.0", edition: "Enterprise" }, releaseProfile: profile, candidate });
  assert.equal(plan.status, "blocked");
  assert.ok(plan.blockers.some((b) => /serie/.test(b)));
});

test("en kandidat uden afprøvet gendannelse blokerer rollback", () => {
  const withoutBackup = { ...candidate, backup: { capability: "unknown", supported: false, restoreTested: false } };
  const plan = buildUpgradePlan({ adapter: "mattermost-adapter", current: { version: "10.0.0", edition: "Enterprise" }, target: { version: "10.1.0", edition: "Enterprise" }, releaseProfile: profile, candidate: withoutBackup });
  assert.equal(plan.status, "blocked");
  assert.ok(plan.blockers.some((b) => /backup|gendannelse/i.test(b)));
});

test("semantikken afviser en plan uden obligatorisk rollback-backup", () => {
  const plan = buildUpgradePlan({ adapter: "mattermost-adapter", current: { version: "10.0.0", edition: "Enterprise" }, target: { version: "10.1.0", edition: "Enterprise" }, releaseProfile: profile, candidate });
  plan.rollback.backupRequired = false;
  const problems = upgradePlanProblems(plan, { releaseProfile: profile, candidate });
  assert.ok(problems.some((p) => /backupRequired/.test(p.path)));
});

test("de committede opgraderingsplaner validerer mod deres releaseprofiler", () => {
  const results = validateAdapterUpgradePlanDir(examplesDir, { manifestDir: join(repoRoot, "modules") });
  assert.ok(results.length >= 2, `forventede mindst 2 planer, fandt ${results.length}`);
  for (const r of results) assert.equal(r.ok, true, `${r.file}:\n${r.errors.map((e) => `${e.path} ${e.message}`).join("\n")}`);
});
