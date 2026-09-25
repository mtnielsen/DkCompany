#!/usr/bin/env node
/**
 * DKC-053 — fokuseret kontrol af katalog, profiler og resolver.
 *
 *   node distribution/src/check.mjs
 *
 * Kontrollerer at:
 *   - alle komponentmanifester, profiler og platformmatricen validerer (skema +
 *     semantik),
 *   - kataloget er internt konsistent (referencer, providere, sikkerhedskerne,
 *     verificerede downloads),
 *   - hver profil er bundet til en deployment-profil med samme profileType og
 *     dækker de obligatoriske sikkerhedskerne-komponenter,
 *   - hver understøttet platformskombination er navngivet og testbar,
 *   - hver profil kan resolveres både alene og med alle valgfrie applikationer
 *     uden fejl, og at sikkerhedskernen altid er til stede.
 */
import { buildAjv } from "../../conformance/src/schemas.mjs";
import { validateComponentDir, validateProfileDir, validatePlatformMatrix } from "../../conformance/src/distribution.mjs";
import {
  loadComponents,
  loadProfiles,
  loadPlatforms,
  loadDeploymentProfiles,
  catalogIntegrityProblems,
  securityCoreIds,
} from "./catalog.mjs";
import { profileBindingProblems, platformCoverageProblems, findDeploymentProfile } from "./profiles.mjs";
import { resolveDependencies } from "./resolver.mjs";
import { loadServiceClasses } from "../../continuity/src/classes.mjs";

const errors = [];
const notes = [];

const assertClean = (results, label) => {
  for (const r of results) {
    if (r.ok) continue;
    for (const e of r.errors) errors.push(`${r.file}: ${e.path} ${e.message}`.trim());
  }
  notes.push(`${results.length} ${label} valideret`);
};

// 1) Skemaer kan kompileres strengt.
try {
  buildAjv({ strict: true });
} catch (err) {
  errors.push(`kontraktskemaerne kunne ikke kompileres: ${err.message}`);
}

const components = loadComponents();
const profiles = loadProfiles();
const platformData = loadPlatforms();
const deploymentProfiles = loadDeploymentProfiles();
const serviceClasses = loadServiceClasses();

assertClean(validateComponentDir(), "komponentmanifester");
assertClean(validateProfileDir(), "installationsprofiler");
if (platformData.data) {
  const result = validatePlatformMatrix(platformData.data);
  if (!result.ok) for (const e of result.errors) errors.push(`${platformData.file}: ${e.path} ${e.message}`.trim());
  notes.push(`${platformData.platforms.length} platformskombinationer valideret`);
} else {
  errors.push("platformmatricen catalog/platforms.json mangler");
}

// 2) Katalogintegritet.
errors.push(...catalogIntegrityProblems(components));
notes.push(`${components.length} komponenter, sikkerhedskerne: ${securityCoreIds(components).join(", ")}`);

// 3) Profilbinding og platformdækning.
errors.push(...profileBindingProblems(profiles, components, deploymentProfiles));
errors.push(...platformCoverageProblems(profiles, platformData.platforms));

// 4) Hver profil skal resolvere — alene og med alle valgfrie applikationer.
for (const entry of profiles) {
  const profile = entry.data;
  const deploymentProfile = findDeploymentProfile(deploymentProfiles, profile.deploymentProfileRef);
  const selections = [
    { label: "kerne", apps: [] },
    { label: "alle valgfrie", apps: profile.optionalApplications ?? [] },
  ];
  for (const sel of selections) {
    const result = resolveDependencies({ components, profile, selection: sel.apps, deploymentProfile, serviceClasses });
    if (!result.ok) {
      for (const e of result.errors) errors.push(`${entry.file} (${sel.label}): ${e.code} ${e.message}`);
    }
    if (!result.safety.ok) {
      for (const e of result.safety.errors) errors.push(`${entry.file} (${sel.label}): ${e.code} ${e.message}`);
    }
    for (const id of profile.securityCore ?? []) {
      if (!result.closure.includes(id)) errors.push(`${entry.file} (${sel.label}): sikkerhedskernen '${id}' mangler i closure`);
    }
  }
}
notes.push(`${profiles.length} profiler resolveret (kerne + alle valgfrie)`);

if (errors.length) {
  console.error("✘ Distributionskontrol fejlede:\n");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`✔ Distributionskontrol bestået (${notes.join("; ")})`);
for (const entry of profiles) {
  const result = resolveDependencies({ components, profile: entry.data, selection: [], deploymentProfile: findDeploymentProfile(deploymentProfiles, entry.data.deploymentProfileRef), serviceClasses });
  console.log(`  • ${entry.data.metadata.name} (${entry.data.profileType}): ${result.closure.length} komponenter i kerne-closure, ${result.resources.cpuMillicores} millicores, ${result.downloadTotalMiB} MiB download`);
}
