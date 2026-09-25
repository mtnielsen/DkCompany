import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { contractsDir } from "../src/schemas.mjs";
import {
  validateArchitecture,
  validateArchitectureDir,
  isNamedHuman,
  deploymentProfileProblems,
  identityTrustProblems,
  integrationCandidateProblems,
} from "../src/architecture.mjs";

const examplesDir = join(contractsDir, "examples");
const fixturesDir = join(import.meta.dirname, "fixtures", "architecture");

function loadFixture(file) {
  return JSON.parse(readFileSync(join(fixturesDir, file), "utf8"));
}

function messages(result) {
  return result.errors.map((e) => `${e.path} ${e.message}`).join("\n");
}

test("gyldige arkitektur- og identitetseksempler validerer (skema + semantik)", () => {
  const results = validateArchitectureDir(examplesDir);
  const relevant = results.filter((r) =>
    /^(deployment-profile|identity-trust|integration-candidate)\./.test(r.file)
  );
  assert.ok(relevant.length >= 5, `forventede mindst 5 arkitektureksempler, fandt ${relevant.length}`);
  for (const r of relevant) assert.equal(r.ok, true, `${r.file}:\n${r.errors.map((e) => `${e.path} ${e.message}`).join("\n")}`);
});

test("samme deployment-kontrakt dækker SMV, servicevirksomhed og enterprise", () => {
  for (const file of [
    "deployment-profile.smv.example.json",
    "deployment-profile.service.example.json",
    "deployment-profile.enterprise.example.json",
  ]) {
    const data = JSON.parse(readFileSync(join(examplesDir, file), "utf8"));
    const result = validateArchitecture("deploymentProfile", data);
    assert.equal(result.ok, true, `${file}:\n${messages(result)}`);
  }
});

test("pilotstandarden kræver særskilte app-instanser og databaser pr. kunde", () => {
  const data = loadFixture("deployment-profile.shared-without-isolation.invalid.json");
  const result = validateArchitecture("deploymentProfile", data);
  assert.equal(result.ok, false);
  const text = messages(result);
  assert.match(text, /applicationInstancesPerTenant/);
  assert.match(text, /databasePerTenant/);
  assert.match(text, /tenantBoundaryEnforcedAt/);
});

test("en beslutning uden navngivet menneskelig ejer afvises", () => {
  const data = loadFixture("deployment-profile.team-owner.invalid.json");
  const result = validateArchitecture("deploymentProfile", data);
  assert.equal(result.ok, false);
  assert.match(messages(result), /navngivet menneske/);
  assert.equal(isNamedHuman({ subject: "team|platform", name: "Platform Team", role: "Owner" }), false);
  assert.equal(isNamedHuman({ subject: "oidc|anna.andersen", name: "Anna Andersen", role: "Owner" }), true);
});

test("ukendt OIDC-issuer (ukendt trust root) afvises", () => {
  const data = loadFixture("identity-trust.unknown-root.invalid.json");
  const result = validateArchitecture("identityTrust", data);
  assert.equal(result.ok, false);
  assert.match(messages(result), /ukendt OIDC-issuer/);
});

test("lokalt skygge-ID med password afvises", () => {
  const data = loadFixture("identity-trust.shadow-password.invalid.json");
  const result = validateArchitecture("identityTrust", data);
  assert.equal(result.ok, false);
  const text = messages(result);
  assert.match(text, /shadowIdentity\/passwordMode/);
  assert.match(text, /shadowIdentity\/upstreams/);
});

test("ukendt egenskab er ikke godkendt", () => {
  const data = loadFixture("integration-candidate.unknown-approved.invalid.json");
  const result = validateArchitecture("integrationCandidate", data);
  assert.equal(result.ok, false);
  assert.match(messages(result), /approved.*uki?endt|ukendte.*sso|kan ikke være 'approved'/i);
});

test("betalte features uden dokumenteret gratis/betalt-skel afvises", () => {
  const data = loadFixture("integration-candidate.no-freemium.invalid.json");
  const result = validateArchitecture("integrationCandidate", data);
  assert.equal(result.ok, false);
  const text = messages(result);
  assert.match(text, /freeVsPaid\/requiredPaidFeatures/);
  assert.match(text, /freeVsPaid\/sourceUrl/);
});

test("schema håndhæver påkrævede felter før semantik", () => {
  const result = validateArchitecture("deploymentProfile", { apiVersion: "contracts.platform/v1alpha1", kind: "DeploymentProfile" });
  assert.equal(result.ok, false);
  assert.ok(result.errors.length > 0);
});

test("semantiske regler kan kaldes direkte", () => {
  assert.ok(deploymentProfileProblems({ metadata: {}, tenantModel: {}, highAvailability: {}, dataServices: [], cost: {} }).length > 0);
  assert.ok(identityTrustProblems({ trustRoots: [], userAuthentication: {}, workloadIdentity: {}, shadowIdentity: {} }).length > 0);
  assert.ok(integrationCandidateProblems({ metadata: {}, verification: {} }).length > 0);
});
