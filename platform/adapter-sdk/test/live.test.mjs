import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadLiveTargets, liveTargetsProblems, runLiveTarget } from "../src/live.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const examplesDir = join(repoRoot, "contracts", "examples");
const COMMIT = "a".repeat(40);

function json(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
function profileFor(module) {
  return json(join(examplesDir, `upstream-release-profile.${module}.example.json`));
}

test("de rigtige live-mål er pinnet og konsistente med releaseprofilerne", () => {
  const manifest = loadLiveTargets(repoRoot);
  const problems = liveTargetsProblems(manifest, {
    load: (t) => ({ profile: profileFor(t.module), candidate: json(join(examplesDir, `integration-candidate.${t.module}.example.json`)), manifest: json(join(repoRoot, "modules", t.module, "module-manifest.json")) }),
  });
  assert.deepEqual(problems, []);
});

test("uden miljøbindinger er hver live-prøve not-run — aldrig pass", async () => {
  const manifest = loadLiveTargets(repoRoot);
  const target = manifest.targets.find((t) => t.module === "mattermost-adapter");
  const report = await runLiveTarget({ target, releaseProfile: profileFor(target.module), env: {}, binding: { commit: COMMIT }, runId: "test-run" });
  const liveChecks = report.checks.filter((c) => c.base !== "contract");
  assert.ok(liveChecks.every((c) => c.status === "not-run"), JSON.stringify(report.checks, null, 2));
  assert.ok(report.summary["not-run"] >= target.checks.length);
  assert.ok(report.records.every((r) => r.result === "not-run" && r.mode === "integration"));
});

test("med binding og syntetiske svar passerer prøverne og forsegler evidens", async () => {
  const manifest = loadLiveTargets(repoRoot);
  const target = manifest.targets.find((t) => t.module === "mattermost-adapter");
  const env = {
    DKC_LIVE_MATTERMOST_ADAPTER_URL: "http://adapter.test",
    DKC_LIVE_MATTERMOST_URL: "http://upstream.test",
    DKC_LIVE_MATTERMOST_ASSERTION: "syntetisk-assertion",
  };
  const fetchImpl = async (url) => ({
    status: 200,
    text: async () => JSON.stringify(url.includes("/erase") ? { result: { partial: true } } : { count: 0, matches: [] }),
  });
  const report = await runLiveTarget({ target, releaseProfile: profileFor(target.module), env, fetchImpl, binding: { commit: COMMIT, environment: "staging" }, runId: "test-run" });
  assert.equal(report.summary.fail, 0, JSON.stringify(report.checks, null, 2));
  assert.ok(report.summary.pass >= target.checks.length);
  for (const record of report.records) {
    assert.equal(record.mode, "integration");
    assert.equal(record.commit, COMMIT);
    assert.match(record.digest, /^[a-f0-9]{64}$/);
  }
});

test("erklæret partial men partial=false giver fail", async () => {
  const manifest = loadLiveTargets(repoRoot);
  const target = manifest.targets.find((t) => t.module === "mattermost-adapter");
  const env = {
    DKC_LIVE_MATTERMOST_ADAPTER_URL: "http://adapter.test",
    DKC_LIVE_MATTERMOST_URL: "http://upstream.test",
    DKC_LIVE_MATTERMOST_ASSERTION: "syntetisk-assertion",
  };
  const fetchImpl = async (url) => ({
    status: 200,
    // erase lyver om at vaere fuld, selvom releaseprofilen erklaerer partial.
    text: async () => JSON.stringify(url.includes("/erase") ? { result: { partial: false } } : { count: 0 }),
  });
  const report = await runLiveTarget({ target, releaseProfile: profileFor(target.module), env, fetchImpl, binding: { commit: COMMIT } });
  assert.ok(report.summary.fail >= 1);
  assert.ok(report.checks.some((c) => c.id === "subject.erase" && c.status === "fail"));
});

test("en aendret pin-version opdages", () => {
  const manifest = loadLiveTargets(repoRoot);
  manifest.targets[0].pinned.version = "9.0.0";
  const problems = liveTargetsProblems(manifest, {
    load: (t) => ({ profile: profileFor(t.module), candidate: json(join(examplesDir, `integration-candidate.${t.module}.example.json`)), manifest: json(join(repoRoot, "modules", t.module, "module-manifest.json")) }),
  });
  assert.ok(problems.some((p) => /pinned\.version/.test(p)));
});
