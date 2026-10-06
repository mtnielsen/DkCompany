import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { contractsDir, repoRoot } from "../src/schemas.mjs";
import { validateAdapterReleaseProfileDir, validateAdapterReleaseProfile, adapterReleaseProfileProblems } from "../src/adapter-sdk.mjs";
import { buildReleaseProfile, assessCandidateGate } from "../../adapter-sdk/src/candidates.mjs";

const examplesDir = join(contractsDir, "examples");
const manifestDir = join(repoRoot, "modules");

function loadCandidate(name) {
  return JSON.parse(readFileSync(join(examplesDir, `integration-candidate.${name}.example.json`), "utf8"));
}
function loadManifest(name) {
  return JSON.parse(readFileSync(join(manifestDir, name, "module-manifest.json"), "utf8"));
}
function loadProfile(name) {
  return JSON.parse(readFileSync(join(examplesDir, `upstream-release-profile.${name}.example.json`), "utf8"));
}

test("de committede releaseprofiler validerer (skema + semantik)", () => {
  const results = validateAdapterReleaseProfileDir(examplesDir, { manifestDir });
  assert.ok(results.length >= 2, `forventede mindst 2 releaseprofiler, fandt ${results.length}`);
  for (const r of results) {
    assert.equal(r.ok, true, `${r.file}:\n${r.errors.map((e) => `${e.path} ${e.message}`).join("\n")}`);
    assert.ok(r.candidate, `${r.file}: kandidaten blev ikke fundet`);
  }
});

test("en approved kandidat med ukendt licens kan ikke godkendes", () => {
  const candidate = loadCandidate("mattermost-adapter");
  candidate.license = { ...candidate.license, type: "unknown", spdx: "" };
  const gate = assessCandidateGate({ candidate });
  assert.equal(gate.status, "blocked");
  assert.ok(gate.blockers.some((b) => /licens/.test(b)));
});

test("en kandidat uden obligatorisk SSO blokerer godkendelsen", () => {
  const candidate = loadCandidate("keycloak-adapter");
  candidate.sso = { capability: "none", supported: false, protocols: [] };
  const gate = assessCandidateGate({ candidate });
  assert.equal(gate.status, "blocked");
  assert.ok(gate.blockers.some((b) => /SSO/.test(b)));
});

test("native admin-eksponering afvises", () => {
  const profile = loadProfile("mattermost-adapter");
  profile.nativeAdmin = { ...profile.nativeAdmin, exposed: true };
  const { ok, errors } = validateAdapterReleaseProfile(profile, undefined, { candidate: loadCandidate("mattermost-adapter"), manifest: loadManifest("mattermost-adapter") });
  assert.equal(ok, false);
  assert.ok(errors.some((e) => /nativeAdmin/.test(e.path)));
});

test("en version der ikke matcher nogen serie afvises", () => {
  const profile = loadProfile("mattermost-adapter");
  profile.upstream = { ...profile.upstream, exactVersion: "7.0.0" };
  const { ok, errors } = validateAdapterReleaseProfile(profile, undefined, { manifest: loadManifest("mattermost-adapter") });
  assert.equal(ok, false);
  assert.ok(errors.some((e) => /supportedRanges|exactVersion/.test(e.path)));
});

test("releaseprofilen må ikke overerklære conformance ift. manifestet", () => {
  const candidate = loadCandidate("mattermost-adapter");
  const manifest = loadManifest("mattermost-adapter");
  const profile = buildReleaseProfile({ candidate, manifest, negotiation: { supportedRanges: ["^10.0.0"], supportedEditions: ["Enterprise"] } });
  profile.verbMatrix.backup = { conformance: "full", endpoint: "https://x/backup", evidence: { kind: "fixture", ref: "x" } };
  const problems = adapterReleaseProfileProblems(profile, { candidate, manifest });
  assert.ok(problems.some((p) => /backup/.test(p.path) && /lover/.test(p.message)));
});

test("full-verber kræver endpoint og bevis; partial/unsupported kræver begrundelse", () => {
  const profile = loadProfile("keycloak-adapter");
  profile.verbMatrix.health = { conformance: "full" };
  profile.privacyMatrix["subject.locate"] = { conformance: "partial", reason: "kort" };
  const { ok, errors } = validateAdapterReleaseProfile(profile, undefined, { manifest: loadManifest("keycloak-adapter") });
  assert.equal(ok, false);
  assert.ok(errors.some((e) => /health/.test(e.path)));
  assert.ok(errors.some((e) => /subject\.locate/.test(e.path)));
});
