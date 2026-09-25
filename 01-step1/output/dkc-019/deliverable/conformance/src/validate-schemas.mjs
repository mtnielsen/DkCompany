#!/usr/bin/env node
/**
 * 0.1: Ugyldig schema-fil skal fejle CI.
 * Metavaliderer alle kontraktskemaer og validerer eksemplerne i /contracts/examples.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { buildAjv, contractsDir, loadContractSchemas, validate } from "./schemas.mjs";
import { validateArchitectureDir } from "./architecture.mjs";
import { validateApprovalDir } from "./approval.mjs";
import { validateTenantDir } from "./tenant.mjs";
import { validateServiceClassDir } from "./service-classes.mjs";
import { validateComponentDir, validateProfileDir, validatePlatformMatrix } from "./distribution.mjs";
import { validateTestMatrix, validateThreatRegister, validateRiskExceptions, validateIndependentAssessments, validateReleaseGateResult } from "./release.mjs";
import { validateDataRegisterDir } from "./data-register.mjs";

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
    if (ARCHITECTURE_PREFIXES.has(prefix)) continue; // håndteres samlet nedenfor
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

  report(problems, { schemas: schemas.length, examples: examples.length, architecture: architecture.length, approvals: approvals.length, tenants: tenants.length, serviceClasses: serviceClasses.length, components: components.length, profiles: installationProfiles.length, platformMatrix: platformResult.ok ? 1 : 0, release: releaseCount, dataRegisters: dataRegisters.length });
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
}

main();
