#!/usr/bin/env node
/**
 * 0.1: Ugyldig schema-fil skal fejle CI.
 * Metavaliderer alle kontraktskemaer og validerer eksemplerne i /contracts/examples.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { buildAjv, contractsDir, loadContractSchemas, validate, repoRoot } from "./schemas.mjs";
import { validateArchitectureDir } from "./architecture.mjs";
import { validateApprovalDir } from "./approval.mjs";
import { validateTenantDir } from "./tenant.mjs";
import { validateServiceClassDir } from "./service-classes.mjs";
import { validateComponentDir, validateProfileDir, validatePlatformMatrix } from "./distribution.mjs";
import { validateTestMatrix, validateThreatRegister, validateRiskExceptions, validateIndependentAssessments, validateReleaseGateResult } from "./release.mjs";
import { validateDataRegisterDir } from "./data-register.mjs";
import { validateProtectedDataDir } from "./protected-data.mjs";
import { validateDatabaseProfileDir, validateDataSourceDir, validateDataServiceBindingDir } from "./data-services.mjs";
import { validateSbom, validateBuildProvenance, validateArtifactManifest, validateBranchProtection } from "./supply-chain.mjs";
import { validateInfrastructurePlan } from "./infrastructure.mjs";
import { validateEvidenceRecord } from "./evidence-mode.mjs";
import { validateVulnerabilityInventory } from "./vulnerability.mjs";
import { validateAdapterReleaseProfileDir } from "./adapter-sdk.mjs";
import { validateAdapterUpgradePlanDir, validateLiveTargets } from "./adapter-live.mjs";
import { validatePrivacyExportDir } from "./privacy.mjs";

const EXAMPLE_SCHEMA = {
  "module-manifest": "https://example.org/contracts/module-manifest.schema.json",
  "agent-manifest": "https://example.org/contracts/agent-manifest.schema.json",
  "agent-registration": "https://example.org/contracts/agent-registration.schema.json",
  "agent-handoff": "https://example.org/contracts/agent-handoff.schema.json",
  "audit-intent": "https://example.org/contracts/audit-intent.schema.json",
  "audit-outcome": "https://example.org/contracts/audit-outcome.schema.json",
  "audit-checkpoint": "https://example.org/contracts/audit-checkpoint.schema.json",
  "credential-token": "https://example.org/contracts/credential-token.schema.json",
  "kill-switch": "https://example.org/contracts/kill-switch.schema.json",
  "tool-call": "https://example.org/contracts/tool-call.schema.json",
  "job": "https://example.org/contracts/job.schema.json",
  "job-reconciliation": "https://example.org/contracts/job-reconciliation.schema.json",
  "approval-request": "https://example.org/contracts/approval-request.schema.json",
  "cloud-event": "https://example.org/contracts/cloud-event.schema.json",
  "privacy-request": "https://example.org/contracts/privacy-request.schema.json",
  "privacy-response": "https://example.org/contracts/privacy-response.schema.json",
  "verb-evidence": "https://example.org/contracts/verb-evidence.schema.json",
  "policy-input": "https://example.org/contracts/policy-input.schema.json",
  "policy-decision": "https://example.org/contracts/policy-decision.schema.json",
  "policy-bundle": "https://example.org/contracts/policy-bundle.schema.json",
  "agent-task": "https://example.org/contracts/agent-task.schema.json",
  "gateway-route": "https://example.org/contracts/gateway-route.schema.json",
  "oscal-assessment-results": "https://example.org/contracts/oscal-assessment-results.schema.json",
  "control-mapping": "https://example.org/contracts/control-mapping.schema.json",
  "security-findings": "https://example.org/contracts/security-findings.schema.json",
  "curriculum": "https://example.org/contracts/curriculum.schema.json",
  "deployment-profile": "https://example.org/contracts/deployment-profile.schema.json",
  "deployment-profile.smv": "https://example.org/contracts/deployment-profile.schema.json",
  "deployment-profile.service": "https://example.org/contracts/deployment-profile.schema.json",
  "deployment-profile.enterprise": "https://example.org/contracts/deployment-profile.schema.json",
  "identity-trust": "https://example.org/contracts/identity-trust.schema.json",
  "integration-candidate": "https://example.org/contracts/integration-candidate.schema.json",
  "tenant-context": "https://example.org/contracts/tenant-context.schema.json",
  "service-class": "https://example.org/contracts/service-class.schema.json",
  "component-manifest": "https://example.org/contracts/component-manifest.schema.json",
  "installation-profile": "https://example.org/contracts/installation-profile.schema.json",
  "platform-matrix": "https://example.org/contracts/platform-matrix.schema.json",
  "test-matrix": "https://example.org/contracts/test-matrix.schema.json",
  "threat-register": "https://example.org/contracts/threat-register.schema.json",
  "risk-exception": "https://example.org/contracts/risk-exception.schema.json",
  "independent-assessment": "https://example.org/contracts/independent-assessment.schema.json",
  "release-gate-result": "https://example.org/contracts/release-gate-result.schema.json",
  "data-register": "https://example.org/contracts/data-register.schema.json",
  "protected-data": "https://example.org/contracts/protected-data.schema.json",
  "database-profile.managed": "https://example.org/contracts/database-profile.schema.json",
  "database-profile.byo": "https://example.org/contracts/database-profile.schema.json",
  "data-source.hr": "https://example.org/contracts/data-source.schema.json",
  "data-service-binding.dummy-ok": "https://example.org/contracts/data-service-binding.schema.json",
  "sbom": "https://example.org/contracts/sbom.schema.json",
  "build-provenance": "https://example.org/contracts/build-provenance.schema.json",
  "artifact-manifest": "https://example.org/contracts/artifact-manifest.schema.json",
  "branch-protection": "https://example.org/contracts/branch-protection.schema.json",
  "infrastructure-plan": "https://example.org/contracts/infrastructure-plan.schema.json",
  "evidence-record": "https://example.org/contracts/evidence-record.schema.json",
  "vulnerability-inventory": "https://example.org/contracts/vulnerability-inventory.schema.json",
  "upstream-release-profile": "https://example.org/contracts/upstream-release-profile.schema.json",
  "upstream-upgrade-plan": "https://example.org/contracts/upstream-upgrade-plan.schema.json",
  "privacy-export": "https://example.org/contracts/privacy-export.schema.json",
};

// Arkitektureksempler valideres fuldt (skema + semantik) af architecture.mjs.
const ARCHITECTURE_PREFIXES = new Set([
  "deployment-profile",
  "deployment-profile.smv",
  "deployment-profile.service",
  "deployment-profile.enterprise",
  "identity-trust",
  "integration-candidate",
]);

// Releaseprofiler for kandidater valideres fuldt (skema + semantik) af adapter-sdk.mjs.
function isArchitecturePrefix(prefix) {
  if (ARCHITECTURE_PREFIXES.has(prefix)) return true;
  // Navngivne varianter, fx integration-candidate.mattermost, valideres også af
  // architecture.mjs' mappelæser.
  return ["deployment-profile", "identity-trust", "integration-candidate"].some((base) => prefix.startsWith(`${base}.`));
}

function isReleaseProfilePrefix(prefix) {
  return prefix === "upstream-release-profile" || prefix.startsWith("upstream-release-profile.");
}

// Opgraderingsplaner valideres fuldt (skema + semantik) af adapter-live.mjs.
function isUpgradePlanPrefix(prefix) {
  return prefix === "upstream-upgrade-plan" || prefix.startsWith("upstream-upgrade-plan.");
}

// Forsyningskædeeksemplerne valideres fuldt (skema + semantik) af supply-chain.mjs.
const SUPPLY_CHAIN_PREFIXES = new Map([
  ["sbom", validateSbom],
  ["build-provenance", validateBuildProvenance],
  ["artifact-manifest", validateArtifactManifest],
  ["branch-protection", validateBranchProtection],
]);

function main() {
  const problems = [];

  // 1) Hvert skema skal være gyldig JSON, have $id og kunne kompileres.
  const schemas = loadContractSchemas();
  if (schemas.length === 0) problems.push("Ingen *.schema.json fundet i /contracts");
  for (const { file, schema } of schemas) {
    if (!schema.$schema) problems.push(`${file}: mangler $schema`);
    if (!schema.$id) problems.push(`${file}: mangler $id`);
    if (!schema.title) problems.push(`${file}: mangler title`);
  }

  if (problems.length) {
    report(problems);
    return;
  }

  let ajv;
  try {
    ({ ajv } = buildAjv({ strict: true }));
  } catch (err) {
    problems.push(`Kompilering af kontraktskemaer fejlede: ${err.message}`);
    report(problems);
    return;
  }

  // 2) Eksempler skal validere mod deres skema.
  const examplesDir = join(contractsDir, "examples");
  const examples = existsSync(examplesDir)
    ? readdirSync(examplesDir).filter((f) => f.endsWith(".example.json")).sort()
    : [];
  for (const file of examples) {
    const prefix = file.replace(/\.example\.json$/, "");
    if (isArchitecturePrefix(prefix)) continue; // håndteres samlet nedenfor
    if (isReleaseProfilePrefix(prefix)) continue; // håndteres i afsnit 16
    if (isUpgradePlanPrefix(prefix)) continue; // håndteres i afsnit 17
    const schemaId = EXAMPLE_SCHEMA[prefix];
    if (!schemaId) {
      problems.push(`${file}: intet kendt skema for præfiks '${prefix}'`);
      continue;
    }
    let data;
    try {
      data = JSON.parse(readFileSync(join(examplesDir, file), "utf8"));
    } catch (err) {
      problems.push(`${file}: ugyldig JSON (${err.message})`);
      continue;
    }
    const { ok, errors } = validate(ajv, schemaId, data);
    if (!ok) {
      problems.push(
        `${file}: ${errors.length} skemafejl\n` +
          errors.slice(0, 10).map((e) => `      ${(e.path || "/").trim()} ${e.message}`).join("\n")
      );
    }
  }

  // 3) Arkitektur- og identitetskontrakter: skema + semantiske beslutninger.
  const architecture = validateArchitectureDir(examplesDir);
  for (const result of architecture) {
    if (result.ok) continue;
    problems.push(
      `${result.file}: ${result.errors.length} arkitekturfejl\n` +
        result.errors.slice(0, 10).map((e) => `      ${e.path} ${e.message}`.trim()).join("\n")
    );
  }

  // 4) Godkendelsesanmodninger: skema + binding + state machine.
  const approvals = validateApprovalDir(examplesDir);
  for (const result of approvals) {
    if (result.ok) continue;
    problems.push(
      `${result.file}: ${result.errors.length} godkendelsesfejl\n` +
        result.errors.slice(0, 10).map((e) => `      ${e.path} ${e.message}`.trim()).join("\n")
    );
  }

  // 5) Tenant-kontekst: skema + ressource-/scope-semantik.
  const tenants = validateTenantDir(examplesDir);
  for (const result of tenants) {
    if (result.ok) continue;
    problems.push(
      `${result.file}: ${result.errors.length} tenantfejl\n` +
        result.errors.slice(0, 10).map((e) => `      ${e.path} ${e.message}`.trim()).join("\n")
    );
  }

  // 6) Serviceklasser: skema + holdbarheds-/HA-semantik.
  const serviceClasses = validateServiceClassDir(examplesDir);
  for (const result of serviceClasses) {
    if (result.ok) continue;
    problems.push(
      `${result.file}: ${result.errors.length} serviceklassefejl\n` +
        result.errors.slice(0, 10).map((e) => `      ${e.path} ${e.message}`.trim()).join("\n")
    );
  }

  // 7) Katalog: komponent-, profil- og platformskontrakter (skema + semantik).
  const components = validateComponentDir(examplesDir, { pattern: /^component-manifest\./ });
  for (const result of components) {
    if (result.ok) continue;
    problems.push(
      `${result.file}: ${result.errors.length} komponentfejl\n` +
        result.errors.slice(0, 10).map((e) => `      ${e.path} ${e.message}`.trim()).join("\n")
    );
  }
  const installationProfiles = validateProfileDir(examplesDir, { pattern: /^installation-profile\./ });
  for (const result of installationProfiles) {
    if (result.ok) continue;
    problems.push(
      `${result.file}: ${result.errors.length} profilfejl\n` +
        result.errors.slice(0, 10).map((e) => `      ${e.path} ${e.message}`.trim()).join("\n")
    );
  }
  const platformExample = join(examplesDir, "platform-matrix.example.json");
  const platformResult = existsSync(platformExample) ? validatePlatformMatrix(JSON.parse(readFileSync(platformExample, "utf8"))) : { ok: true, errors: [] };
  if (!platformResult.ok) {
    problems.push(
      `platform-matrix.example.json: ${platformResult.errors.length} platformfejl\n` +
        platformResult.errors.slice(0, 10).map((e) => `      ${e.path} ${e.message}`.trim()).join("\n")
    );
  }

  // 8) Release: testmatrix, trusselmodel, undtagelser, vurderinger og gate-resultat.
  const loadExample = (name) => (existsSync(join(examplesDir, name)) ? JSON.parse(readFileSync(join(examplesDir, name), "utf8")) : null);
  const testMatrixExample = loadExample("test-matrix.example.json");
  const releaseChecks = [
    ["test-matrix.example.json", testMatrixExample, (d) => validateTestMatrix(d)],
    ["release-gate-result.example.json", loadExample("release-gate-result.example.json"), (d) => validateReleaseGateResult(d)],
  ];
  const releaseRequirementIds = new Set((testMatrixExample?.requirements ?? []).map((r) => r.id));
  releaseChecks.push(
    ["threat-register.example.json", loadExample("threat-register.example.json"), (d) => validateThreatRegister(d, undefined, { requirementIds: releaseRequirementIds })],
    ["risk-exception.example.json", loadExample("risk-exception.example.json"), (d) => validateRiskExceptions(d, undefined, { requirementIds: releaseRequirementIds })],
    ["independent-assessment.example.json", loadExample("independent-assessment.example.json"), (d) => validateIndependentAssessments(d, undefined, { requirementIds: releaseRequirementIds })]
  );
  let releaseCount = 0;
  for (const [name, data, validator] of releaseChecks) {
    if (!data) continue;
    releaseCount += 1;
    const result = validator(data);
    if (result.ok) continue;
    problems.push(
      `${name}: ${result.errors.length} releasefejl\n` +
        result.errors.slice(0, 10).map((e) => `      ${e.path} ${e.message}`.trim()).join("\n")
    );
  }

  // 9) Dataregister: skema + ejerbeslutning, retention, tredjeland og blocker.
  const dataRegisters = validateDataRegisterDir(examplesDir);
  for (const result of dataRegisters) {
    if (result.ok) continue;
    problems.push(
      `${result.file}: ${result.errors.length} dataregisterfejl\n` +
        result.errors.slice(0, 10).map((e) => `      ${e.path} ${e.message}`.trim()).join("\n")
    );
  }

  // 10) Beskyttede dataklasser (AI-immutable): skema + forbud, WORM-frist og ærlig håndhævelse.
  const protectedData = validateProtectedDataDir(examplesDir);
  for (const result of protectedData) {
    if (result.ok) continue;
    problems.push(
      `${result.file}: ${result.errors.length} beskyttelsesfejl\n` +
        result.errors.slice(0, 10).map((e) => `      ${e.path} ${e.message}`.trim()).join("\n")
    );
  }

  // 11) Databaseprofiler, datakilder og bindinger (DKC-056): skema + ansvar,
  //     read-only scope, secretreferencer og ekstern-politik.
  const databaseProfiles = validateDatabaseProfileDir(examplesDir);
  for (const result of databaseProfiles) {
    if (result.ok) continue;
    problems.push(
      `${result.file}: ${result.errors.length} databaseprofilefejl\n` +
        result.errors.slice(0, 10).map((e) => `      ${e.path} ${e.message}`.trim()).join("\n")
    );
  }
  const dataSources = validateDataSourceDir(examplesDir);
  for (const result of dataSources) {
    if (result.ok) continue;
    problems.push(
      `${result.file}: ${result.errors.length} datakildefejl\n` +
        result.errors.slice(0, 10).map((e) => `      ${e.path} ${e.message}`.trim()).join("\n")
    );
  }
  const dataBindings = validateDataServiceBindingDir(examplesDir);
  for (const result of dataBindings) {
    if (result.ok) continue;
    problems.push(
      `${result.file}: ${result.errors.length} bindingsfejl\n` +
        result.errors.slice(0, 10).map((e) => `      ${e.path} ${e.message}`.trim()).join("\n")
    );
  }

  // 12) Forsyningskæden (DKC-014): SBOM, provenance, artefaktmanifest og
  //     branch protection. Skema + digest-/signatur-/ejersemantik.
  const supplyChain = [];
  for (const file of examples) {
    const prefix = file.replace(/\.example\.json$/, "");
    const validator = SUPPLY_CHAIN_PREFIXES.get(prefix);
    if (!validator) continue;
    let data;
    try {
      data = JSON.parse(readFileSync(join(examplesDir, file), "utf8"));
    } catch (err) {
      problems.push(`${file}: ugyldig JSON (${err.message})`);
      continue;
    }
    supplyChain.push(file);
    const result = validator(data);
    if (result.ok) continue;
    problems.push(
      `${file}: ${result.errors.length} forsyningskædefejl\n` +
        result.errors.slice(0, 10).map((e) => `      ${e.path} ${e.message}`.trim()).join("\n")
    );
  }

  // 13) Infrastrukturplanen (DKC-015): skema + miljøadskillelse, netværksisolering,
  //     secret-injektion, break-glass og omkostningsintegritet.
  const infrastructurePlans = [];
  for (const file of examples) {
    const prefix = file.replace(/\.example\.json$/, "");
    if (prefix !== "infrastructure-plan") continue;
    let data;
    try {
      data = JSON.parse(readFileSync(join(examplesDir, file), "utf8"));
    } catch (err) {
      problems.push(`${file}: ugyldig JSON (${err.message})`);
      continue;
    }
    infrastructurePlans.push(file);
    const result = validateInfrastructurePlan(data);
    if (result.ok) continue;
    problems.push(
      `${file}: ${result.errors.length} infrastrukturfejl\n` +
        result.errors.slice(0, 10).map((e) => `      ${e.path} ${e.message}`.trim()).join("\n")
    );
  }

  // 14) Evidensposter (DKC-018): mode, commit, image-digest, miljø, upstream-
  //     version, run-ID og udløb. Semantikken afviser udløbet, fremtidsdateret,
  //     forkert-bundet og manuelt ændret evidens.
  const evidenceRecords = [];
  for (const file of examples) {
    const prefix = file.replace(/\.example\.json$/, "");
    if (prefix !== "evidence-record") continue;
    let data;
    try {
      data = JSON.parse(readFileSync(join(examplesDir, file), "utf8"));
    } catch (err) {
      problems.push(`${file}: ugyldig JSON (${err.message})`);
      continue;
    }
    evidenceRecords.push(file);
    // Eksemplet er gyldigt og frisk; semantikken tjekkes fuldt med en fast
    // «nu»-værdi, så eksemplet er deterministisk.
    const result = validateEvidenceRecord(data, ajv, { now: Date.parse(data.capturedAt) + 1000 });
    if (result.ok) continue;
    problems.push(
      `${file}: ${result.errors.length} evidensfejl\n` +
        result.errors.slice(0, 10).map((e) => `      ${e.path} ${e.message}`.trim()).join("\n")
    );
  }

  // 15) Sårbarhedsbeholdning (DKC-064): skema + dedup, prioritet, livscyklus,
  //     menneskelig accept, dækning og inventarrekonciliation.
  const vulnerabilityInventories = [];
  for (const file of examples) {
    const prefix = file.replace(/\.example\.json$/, "");
    if (prefix !== "vulnerability-inventory") continue;
    let data;
    try {
      data = JSON.parse(readFileSync(join(examplesDir, file), "utf8"));
    } catch (err) {
      problems.push(`${file}: ugyldig JSON (${err.message})`);
      continue;
    }
    vulnerabilityInventories.push(file);
    const result = validateVulnerabilityInventory(data, ajv, { now: data.generatedAt });
    if (result.ok) continue;
    problems.push(
      `${file}: ${result.errors.length} sårbarhedsfejl\n` +
        result.errors.slice(0, 10).map((e) => `      ${e.path} ${e.message}`.trim()).join("\n")
    );
  }

  // 16) Releaseprofiler for adapterkandidater (DKC-023): skema + aerlig
  //     conformance pr. verbum, versionsforhandling, native admin-beskyttelse
  //     og den h\u00e5rde godkendelsesgate (SSO/licens).
  const releaseProfiles = validateAdapterReleaseProfileDir(examplesDir, { manifestDir: join(repoRoot, "modules") });
  for (const result of releaseProfiles) {
    if (result.ok) continue;
    problems.push(
      `${result.file}: ${result.errors.length} releaseprofilfejl\n` +
        result.errors.slice(0, 10).map((e) => `      ${e.path} ${e.message}`.trim()).join("\n")
    );
  }

  // 17) Live-mål og opgraderings-/rollbackplaner (DKC-024): skema + pinning mod
  //     den godkendte releaseprofil, obligatorisk backup/rollback og aerlig
  //     partial-conformance pr. privacy-verbum.
  const upgradePlans = validateAdapterUpgradePlanDir(examplesDir, { manifestDir: join(repoRoot, "modules") });
  for (const result of upgradePlans) {
    if (result.ok) continue;
    problems.push(
      `${result.file}: ${result.errors.length} opgraderingsplanfejl\n` +
        result.errors.slice(0, 10).map((e) => `      ${e.path} ${e.message}`.trim()).join("\n")
    );
  }
  const liveTargetProblems = validateLiveTargets(repoRoot);
  for (const p of liveTargetProblems) problems.push(`adapter-sdk/live-targets.json: ${p}`);

  // 18) Sikrede DKC-020-eksporter: skema + udløbs-/modtager-/digest-semantik.
  const privacyExports = validatePrivacyExportDir(examplesDir);
  for (const result of privacyExports) {
    if (result.ok) continue;
    problems.push(
      `${result.file}: ${result.errors.length} eksportfejl\n` +
        result.errors.slice(0, 10).map((e) => `      ${e.path} ${e.message}`.trim()).join("\n")
    );
  }

  report(problems, { schemas: schemas.length, examples: examples.length, architecture: architecture.length, approvals: approvals.length, tenants: tenants.length, serviceClasses: serviceClasses.length, components: components.length, profiles: installationProfiles.length, platformMatrix: platformResult.ok ? 1 : 0, release: releaseCount, dataRegisters: dataRegisters.length, protectedData: protectedData.length, databaseProfiles: databaseProfiles.length, dataSources: dataSources.length, dataBindings: dataBindings.length, supplyChain: supplyChain.length, infrastructurePlans: infrastructurePlans.length, evidenceRecords: evidenceRecords.length, vulnerabilityInventories: vulnerabilityInventories.length, releaseProfiles: releaseProfiles.length, upgradePlans: upgradePlans.length, liveTargets: liveTargetProblems.length === 0, privacyExports: privacyExports.length });
}

function report(problems, stats = {}) {
  if (problems.length) {
    console.error("✘ Kontraktvalidering fejlede:\n");
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`✔ ${stats.schemas} kontraktskemaer metavalideret`);
  console.log(`✔ ${stats.examples} eksempler valideret`);
  if (stats.architecture) console.log(`✔ ${stats.architecture} arkitektur-/identitetseksempler valideret (skema + semantik)`);
  if (stats.approvals) console.log(`✔ ${stats.approvals} godkendelseseksempel valideret (skema + binding + state machine)`);
  if (stats.tenants) console.log(`✔ ${stats.tenants} tenant-konteksteksempel valideret (skema + ressource-/scope-semantik)`);
  if (stats.serviceClasses) console.log(`✔ ${stats.serviceClasses} serviceklasse-eksempel valideret (skema + holdbarheds-/HA-semantik)`);
  if (stats.components) console.log(`✔ ${stats.components} komponentmanifest-eksempel valideret (skema + semantik)`);
  if (stats.profiles) console.log(`✔ ${stats.profiles} installationsprofil-eksempel valideret (skema + semantik)`);
  if (stats.platformMatrix) console.log(`✔ platformmatrix-eksempel valideret (skema + semantik)`);
  if (stats.release) console.log(`✔ ${stats.release} release-eksempler valideret (skema + semantik)`);
  if (stats.dataRegisters) console.log(`✔ ${stats.dataRegisters} dataregister-eksempel valideret (skema + semantik)`);
  if (stats.protectedData) console.log(`✔ ${stats.protectedData} beskyttelsesregister-eksempel valideret (skema + semantik)`);
  if (stats.databaseProfiles) console.log(`✔ ${stats.databaseProfiles} databaseprofil-eksempler valideret (skema + ansvarsmatrix)`);
  if (stats.dataSources) console.log(`✔ ${stats.dataSources} datakilde-eksempler valideret (skema + read-only scope)`);
  if (stats.dataBindings) console.log(`✔ ${stats.dataBindings} datatjenestebinding-eksempler valideret (skema + scope)`);
  if (stats.supplyChain) console.log(`✔ ${stats.supplyChain} forsyningskæde-eksempler valideret (skema + digest-/signerings-/ejersemantik)`);
  if (stats.infrastructurePlans) console.log(`✔ ${stats.infrastructurePlans} infrastrukturplan-eksempel valideret (skema + miljø-/netværks-/secret-/break-glass-semantik)`);
  if (stats.evidenceRecords) console.log(`✔ ${stats.evidenceRecords} evidenspost-eksempel valideret (skema + mode-/friskheds-/bindingssemantik)`);
  if (stats.vulnerabilityInventories) console.log(`✔ ${stats.vulnerabilityInventories} sårbarhedsbeholdning valideret (skema + dedup-/prioritet-/livscyklus-/dækningssemantik)`);
  if (stats.releaseProfiles) console.log(`✔ ${stats.releaseProfiles} releaseprofil(er) valideret (skema + conformance-/versions-/gate-semantik)`);
  if (stats.upgradePlans) console.log(`✔ ${stats.upgradePlans} opgraderings-/rollbackplan(er) valideret (skema + pinning-/backup-/rollback-semantik)`);
  if (stats.liveTargets) console.log(`✔ live-målene er pinnet og konsistente med releaseprofilerne`);
  if (stats.privacyExports) console.log(`✔ ${stats.privacyExports} sikret eksport valideret (skema + udløbs-/modtager-/digest-semantik)`);
}

main();
