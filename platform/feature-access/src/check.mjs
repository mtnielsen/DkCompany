#!/usr/bin/env node
/**
 * DKC-060 — kontrol af funktionsprofiler og kontrakteksempler.
 *
 *   node feature-access/src/check.mjs
 *
 * Kontrollerer at de fire funktionsprofiler er hele og default-deny, og at
 * rapportdefinitioner, rapportkørsler og offboardingplaner validerer med både
 * skema og beslutningssemantik.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadProfiles, featureProfilesProblems } from "./profiles.mjs";
import { validateFeatureProfile, validateReportDefinition, validateReportRun, validateOffboardingPlan } from "../../conformance/src/feature-access.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(here, "..", "..");
const examplesDir = join(repoRoot, "contracts", "examples");

export function collectProblems() {
  const problems = [];
  const profiles = loadProfiles();
  for (const p of featureProfilesProblems(profiles)) problems.push(`feature-access/profiles: ${p}`);
  for (const profile of profiles) {
    const { __file, ...data } = profile;
    const result = validateFeatureProfile(data);
    if (result.ok) continue;
    for (const e of result.errors.slice(0, 10)) problems.push(`feature-access/profiles/${__file ?? profile.id}${e.path}: ${e.message}`);
  }

  const checkExample = (name, validator) => {
    const path = join(examplesDir, name);
    if (!existsSync(path)) {
      problems.push(`${name} mangler`);
      return;
    }
    let data;
    try {
      data = JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
      problems.push(`${name}: ugyldig JSON (${error.message})`);
      return;
    }
    const result = validator(data);
    if (result.ok) return;
    for (const e of result.errors.slice(0, 10)) problems.push(`${name}${e.path}: ${e.message}`);
  };
  checkExample("feature-profile.example.json", validateFeatureProfile);
  checkExample("report-definition.example.json", validateReportDefinition);
  checkExample("report-run.example.json", validateReportRun);
  checkExample("offboarding-plan.example.json", validateOffboardingPlan);
  return { problems, profiles };
}

function main() {
  const { problems, profiles } = collectProblems();
  if (problems.length) {
    console.error("✘ DKC-060-kontrol fejlede:\n");
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`✔ ${profiles.length} funktionsprofiler valideret (default-deny, moduler, formål og flader)`);
  console.log("✔ rapportdefinition, rapportkørsel og offboardingplan valideret (skema + semantik)");
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) main();
