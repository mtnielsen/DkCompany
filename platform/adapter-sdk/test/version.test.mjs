import { test } from "node:test";
import assert from "node:assert/strict";
import { parseVersion, compareVersions, satisfiesRange, negotiateUpstreamVersion, assertNegotiated } from "../src/version.mjs";

test("parseVersion accepterer semver og afviser skrald", () => {
  assert.deepEqual(parseVersion("10.0.0"), { major: 10, minor: 0, patch: 0, prerelease: null });
  assert.deepEqual(parseVersion("26.0.1-beta.1").prerelease, "beta.1");
  assert.equal(parseVersion("latest"), null);
  assert.equal(parseVersion("^1.2.3"), null);
});

test("compareVersions er en total orden", () => {
  assert.equal(compareVersions("1.2.3", "1.2.3"), 0);
  assert.equal(compareVersions("1.2.3", "1.3.0"), -1);
  assert.equal(compareVersions("2.0.0", "1.9.9"), 1);
  assert.equal(compareVersions("1.0.0-beta", "1.0.0"), -1);
});

test("satisfiesRange forstår ^, ~, sammenligninger og ||", () => {
  assert.equal(satisfiesRange("10.5.2", "^10.0.0"), true);
  assert.equal(satisfiesRange("11.0.0", "^10.0.0"), false);
  assert.equal(satisfiesRange("1.2.9", "~1.2.3"), true);
  assert.equal(satisfiesRange("1.3.0", "~1.2.3"), false);
  assert.equal(satisfiesRange("9.9.9", ">=9.0.0 <10.0.0"), true);
  assert.equal(satisfiesRange("10.0.0", ">=9.0.0 <10.0.0"), false);
  assert.equal(satisfiesRange("9.5.0", "^10.0.0 || ^9.5.0"), true);
  assert.equal(satisfiesRange("0.2.5", "^0.2.0"), true);
  assert.equal(satisfiesRange("0.3.0", "^0.2.0"), false);
});

test("negotiateUpstreamVersion skelner supported, degraded og unsupported", () => {
  const supported = negotiateUpstreamVersion({ upstreamVersion: "10.1.0", supportedRanges: ["^10.0.0"], supportedEditions: ["Enterprise"], edition: "Enterprise" });
  assert.equal(supported.status, "supported");
  assert.equal(supported.matchedRange, "^10.0.0");

  const wrongEdition = negotiateUpstreamVersion({ upstreamVersion: "10.1.0", supportedRanges: ["^10.0.0"], supportedEditions: ["Enterprise"], edition: "Community" });
  assert.equal(wrongEdition.status, "unsupported");

  const degraded = negotiateUpstreamVersion({ upstreamVersion: "11.0.0", supportedRanges: ["^10.0.0"], onUnsupported: "degrade" });
  assert.equal(degraded.status, "degraded");

  const unknown = negotiateUpstreamVersion({ upstreamVersion: "latest", supportedRanges: ["^10.0.0"] });
  assert.equal(unknown.status, "unsupported");

  assert.throws(() => assertNegotiated(degraded), /matcher ingen/);
  assert.equal(assertNegotiated(degraded, { allowDegraded: true }).status, "degraded");
});
