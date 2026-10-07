import { test } from "node:test";
import assert from "node:assert/strict";
import { loadProfiles, featureProfileProblems, featureProfilesProblems, FEATURE_IDS } from "../src/index.mjs";
import { validateFeatureProfile } from "../../conformance/src/feature-access.mjs";

const profiles = loadProfiles();

test("de fire funktionsprofiler indlæses og validerer med skema og semantik", () => {
  assert.equal(profiles.length, 4);
  assert.deepEqual(
    profiles.map((p) => p.id).sort(),
    [...FEATURE_IDS].sort()
  );
  for (const profile of profiles) {
    const { __file, ...data } = profile;
    const result = validateFeatureProfile(data);
    assert.equal(result.ok, true, `${__file}: ${result.errors.map((e) => `${e.path} ${e.message}`).join("; ")}`);
  }
});

test("hver profil har et separat formål", () => {
  const purposes = profiles.map((p) => p.purpose);
  assert.equal(new Set(purposes).size, purposes.length);
  assert.equal(featureProfilesProblems(profiles).length, 0);
});

test("en profil uden platform-core eller uden en flade afvises", () => {
  const hr = profiles.find((p) => p.id === "hr");
  const { __file, ...base } = hr;
  assert.ok(featureProfileProblems({ ...base, modules: base.modules.filter((m) => m !== "platform-core") }).some((p) => /platform-core/.test(p.message)));
  assert.ok(featureProfileProblems({ ...base, surfaces: base.surfaces.filter((s) => s !== "cache") }).some((p) => /cache/.test(p.message)));
});

test("et beskyttet felt må ikke tillades uden en eksplicit bevilling", () => {
  const hr = profiles.find((p) => p.id === "hr");
  const { __file, ...base } = hr;
  const broken = {
    ...base,
    fieldRules: { defaultDecision: "deny", fields: [{ field: "salary", dataClass: "sensitive", decision: "allow" }] },
  };
  assert.ok(featureProfileProblems(broken).some((p) => /bevilling/.test(p.message)));
  assert.equal(validateFeatureProfile(broken).ok, false);
});

test("en ekstern modtager skal revalideres ved både kørsel og afsendelse", () => {
  const reporting = profiles.find((p) => p.id === "reporting");
  const { __file, ...base } = reporting;
  const broken = { ...base, recipientTrust: [{ id: "ext", kind: "external", dataSharingRef: "docs/x", revalidateAt: ["run"] }] };
  assert.ok(featureProfileProblems(broken).some((p) => /kørsel og afsendelse/.test(p.message)));
});

test("manglende profiler opdages", () => {
  assert.ok(featureProfilesProblems(profiles.slice(0, 2)).some((m) => /mangler/.test(m)));
});
