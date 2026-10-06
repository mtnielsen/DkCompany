import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  validateFeatureProfile,
  validateReportDefinition,
  validateReportRun,
  validateOffboardingPlan,
  reportRunProblems,
} from "../src/feature-access.mjs";
import { repoRoot } from "../src/schemas.mjs";

const example = (name) => JSON.parse(readFileSync(join(repoRoot, "contracts", "examples", name), "utf8"));
const profileExamples = () => {
  const hr = example("feature-profile.example.json");
  return hr;
};

test("de committede DKC-060-eksempler validerer med semantik", () => {
  assert.equal(validateFeatureProfile(profileExamples()).ok, true);
  assert.equal(validateReportDefinition(example("report-definition.example.json")).ok, true);
  assert.equal(validateReportRun(example("report-run.example.json")).ok, true);
  assert.equal(validateOffboardingPlan(example("offboarding-plan.example.json")).ok, true);
});

test("en profil der tillader et beskyttet felt uden bevilling afvises", () => {
  const base = profileExamples();
  const broken = { ...base, fieldRules: { defaultDecision: "deny", fields: [{ field: "salary", dataClass: "sensitive", decision: "allow" }] } };
  const result = validateFeatureProfile(broken);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /bevilling/.test(e.message)));
});

test("en profil uden alle syv flader afvises", () => {
  const base = profileExamples();
  assert.equal(validateFeatureProfile({ ...base, surfaces: ["ui", "api"] }).ok, false);
});

test("en rapportdefinition med et token som afsender afvises", () => {
  const base = example("report-definition.example.json");
  assert.equal(validateReportDefinition({ ...base, senderSubject: "eyJhbGciOiJIUzI1NiJ9.abc.def" }).ok, false);
});

test("en rapportdefinition hvor kilde og autoritativ definition divergerer afvises", () => {
  const base = example("report-definition.example.json");
  const broken = { ...base, authoritativeDefinition: { ...base.authoritativeDefinition, systemOfRecord: "Andet system" } };
  assert.equal(validateReportDefinition(broken).ok, false);
});

test("en 'run'-kørsel med en afvist modtager afvises", () => {
  const base = example("report-run.example.json");
  const broken = { ...base, recipients: [{ ...base.recipients[0], decision: "deny" }] };
  assert.equal(validateReportRun(broken).ok, false);
  assert.ok(reportRunProblems(broken).some((p) => /afviste modtagere/.test(p.message)));
});

test("en rapportkørsel der genbruger et creator-token afvises", () => {
  const base = example("report-run.example.json");
  const broken = { ...base, authorization: { ...base.authorization, usedStoredCreatorToken: true } };
  assert.equal(validateReportRun(broken).ok, false);
});

test("en complete-offboardingplan med udestående rettigheder afvises", () => {
  const base = example("offboarding-plan.example.json");
  assert.equal(validateOffboardingPlan({ ...base, outstanding: ["sessions:s1"] }).ok, false);
  assert.equal(validateOffboardingPlan({ ...base, targets: ["sessions"] }).ok, false);
});
