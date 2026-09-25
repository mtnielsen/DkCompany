/**
 * DKC-053 — SemVer-parser og range-satisfaction (dependency-fri).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseVersion, compareVersions, satisfies, maxSatisfying, isValidVersion, isValidRange } from "../src/semver.mjs";

test("parser komplette SemVer-versioner", () => {
  assert.deepEqual(parseVersion("1.2.3"), { major: 1, minor: 2, patch: 3, prerelease: [], build: null, raw: "1.2.3" });
  assert.equal(parseVersion("v2.0.0").major, 2);
  assert.equal(parseVersion("1.2.3-rc.1").prerelease.join("."), "rc.1");
  assert.equal(parseVersion("ikke-en-version"), null);
  assert.equal(isValidVersion("1.0.0"), true);
  assert.equal(isValidVersion("1.0"), false);
});

test("sammenligner versioner inkl. prerelease", () => {
  assert.equal(compareVersions("1.2.3", "1.2.4"), -1);
  assert.equal(compareVersions("2.0.0", "1.9.9"), 1);
  assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
  assert.equal(compareVersions("1.0.0-rc.1", "1.0.0"), -1);
  assert.equal(compareVersions("1.0.0-alpha", "1.0.0-beta"), -1);
});

test("eksakte og sammenlignende intervaller", () => {
  assert.equal(satisfies("1.2.3", "=1.2.3"), true);
  assert.equal(satisfies("1.2.4", "=1.2.3"), false);
  assert.equal(satisfies("1.5.0", ">=1.0.0 <2.0.0"), true);
  assert.equal(satisfies("2.0.0", ">=1.0.0 <2.0.0"), false);
  assert.equal(satisfies("1.2.3", "1.2.3"), true);
});

test("caret og tilde", () => {
  assert.equal(satisfies("1.9.0", "^1.2.3"), true);
  assert.equal(satisfies("2.0.0", "^1.2.3"), false);
  assert.equal(satisfies("0.2.9", "^0.2.3"), true);
  assert.equal(satisfies("0.3.0", "^0.2.3"), false);
  assert.equal(satisfies("1.2.9", "~1.2.3"), true);
  assert.equal(satisfies("1.3.0", "~1.2.3"), false);
});

test("delvise versioner og unioner", () => {
  assert.equal(satisfies("1.2.0", "1.2"), true);
  assert.equal(satisfies("1.3.0", "1.2"), false);
  assert.equal(satisfies("1.5.0", "1"), true);
  assert.equal(satisfies("2.0.0", "1"), false);
  assert.equal(satisfies("1.2.3", "*"), true);
  assert.equal(satisfies("2.5.0", "1.2.3 || >=2.0.0"), true);
  assert.equal(satisfies("0.9.0", "1.2.3 || >=2.0.0"), false);
});

test("maxSatisfying vælger den højeste der opfylder", () => {
  assert.equal(maxSatisfying(["1.0.0", "1.4.2", "1.2.0", "2.0.0"], ">=1.0.0 <2.0.0"), "1.4.2");
  assert.equal(maxSatisfying(["1.0.0"], ">=2.0.0"), null);
});

test("isValidRange afviser tastefejl", () => {
  assert.equal(isValidRange(">=1.0.0 <2.0.0"), true);
  assert.equal(isValidRange("ikke et interval"), false);
});
