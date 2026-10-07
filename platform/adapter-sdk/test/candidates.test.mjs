import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReleaseProfile, assessCandidateGate, OPS_VERBS, PRIVACY_VERBS } from "../src/candidates.mjs";
import { adapterReleaseProfileProblems } from "../../conformance/src/adapter-sdk.mjs";

function baseManifest() {
  const unsupported = (reason) => ({ conformance: "unsupported", reason });
  const verbs = {};
  for (const verb of OPS_VERBS) verbs[verb] = unsupported(`ikke muligt for ${verb} på denne version`);
  const privacy = {};
  for (const verb of PRIVACY_VERBS) privacy[verb] = unsupported(`ikke muligt for ${verb} på denne version`);
  verbs.health = { conformance: "full", endpoint: "https://x/healthz", evidence: { kind: "fixture", ref: "conformance/evidence/health.json" } };
  return {
    metadata: { name: "demo-adapter", version: "1.0.0" },
    verbs,
    privacy,
  };
}

function baseCandidate(overrides = {}) {
  return {
    metadata: { name: "demo", accountableHuman: { subject: "oidc|a.b", name: "A B", role: "Owner" } },
    name: "Demo",
    exactVersion: "1.2.3",
    edition: { name: "Enterprise", tier: "enterprise" },
    license: { spdx: "MIT", type: "open-source" },
    hosting: { mode: "customer-self-hosted" },
    maintenance: { vendorSupport: "commercial" },
    sso: { supported: true, protocols: ["oidc"] },
    scim: { supported: true },
    api: { capability: "full" },
    isolation: { capability: "partial" },
    export: { capability: "partial" },
    backup: { capability: "full" },
    verification: { status: "approved", verifiedBy: { subject: "oidc|a.b", name: "A B", role: "Owner" }, evidence: ["x"] },
    ...overrides,
  };
}

test("godkendelsesgaten stopper manglende obligatorisk SSO", () => {
  const gate = assessCandidateGate({ candidate: baseCandidate({ sso: { supported: false, protocols: [] } }) });
  assert.equal(gate.status, "blocked");
  assert.ok(gate.blockers.some((b) => /SSO/.test(b)));
});

test("godkendelsesgaten stopper en uafklaret licens", () => {
  const gate = assessCandidateGate({ candidate: baseCandidate({ license: { spdx: "", type: "unknown" } }) });
  assert.equal(gate.status, "blocked");
  assert.ok(gate.blockers.some((b) => /licens/.test(b)));
});

test("releaseprofilen spejler modulets conformance pr. verbum", () => {
  const profile = buildReleaseProfile({ candidate: baseCandidate(), manifest: baseManifest(), negotiation: { supportedRanges: ["^1.2.0"], supportedEditions: ["Enterprise"] } });
  assert.equal(profile.verbMatrix.health.conformance, "full");
  assert.equal(profile.verbMatrix.backup.conformance, "unsupported");
  assert.equal(profile.privacyMatrix["subject.erase"].conformance, "unsupported");
  assert.equal(profile.approvalGate.status, "approved");
});

test("releaseprofilen må ikke love stærkere conformance end manifestet", () => {
  const profile = buildReleaseProfile({ candidate: baseCandidate(), manifest: baseManifest(), negotiation: { supportedRanges: ["^1.2.0"] } });
  profile.verbMatrix.backup = { conformance: "full", endpoint: "https://x/backup" };
  const problems = adapterReleaseProfileProblems(profile, { candidate: baseCandidate(), manifest: baseManifest() });
  assert.ok(problems.some((p) => /backup/.test(p.path) && /lover/.test(p.message)), JSON.stringify(problems));
});

test("en blokeret gate uden blockers afvises af validatoren", () => {
  const profile = buildReleaseProfile({ candidate: baseCandidate(), manifest: baseManifest(), negotiation: { supportedRanges: ["^1.2.0"] } });
  profile.approvalGate = { requiredSso: true, licenseType: "mit", status: "blocked", blockers: [] };
  const problems = adapterReleaseProfileProblems(profile, { manifest: baseManifest() });
  assert.ok(problems.some((p) => p.path.includes("blockers")));
});

test("native admin må ikke være eksponeret", () => {
  const profile = buildReleaseProfile({ candidate: baseCandidate(), manifest: baseManifest(), negotiation: { supportedRanges: ["^1.2.0"] } });
  profile.nativeAdmin.exposed = true;
  const problems = adapterReleaseProfileProblems(profile, { manifest: baseManifest() });
  assert.ok(problems.some((p) => p.path.includes("nativeAdmin") && /eksponer/.test(p.message)));
});
