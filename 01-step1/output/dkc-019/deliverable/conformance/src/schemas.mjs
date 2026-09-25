import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** Repo-rod, uafhængig af hvor CLI'en kaldes fra. */
export const repoRoot = resolve(here, "..", "..");
export const contractsDir = join(repoRoot, "contracts");

export const SCHEMA_IDS = {
  moduleManifest: "https://example.org/contracts/module-manifest.schema.json",
  identity: "https://example.org/contracts/identity.schema.json",
  telemetry: "https://example.org/contracts/telemetry.schema.json",
  cloudEvent: "https://example.org/contracts/cloud-event.schema.json",
  agentManifest: "https://example.org/contracts/agent-manifest.schema.json",
  approvalRequest: "https://example.org/contracts/approval-request.schema.json",
  privacyRequest: "https://example.org/contracts/privacy-request.schema.json",
  privacyResponse: "https://example.org/contracts/privacy-response.schema.json",
  verbEvidence: "https://example.org/contracts/verb-evidence.schema.json",
  policyInput: "https://example.org/contracts/policy-input.schema.json",
  policyDecision: "https://example.org/contracts/policy-decision.schema.json",
  policyBundle: "https://example.org/contracts/policy-bundle.schema.json",
  oscalAssessmentResults: "https://example.org/contracts/oscal-assessment-results.schema.json",
  controlMapping: "https://example.org/contracts/control-mapping.schema.json",
  securityFindings: "https://example.org/contracts/security-findings.schema.json",
  curriculum: "https://example.org/contracts/curriculum.schema.json",
  deploymentProfile: "https://example.org/contracts/deployment-profile.schema.json",
  identityTrust: "https://example.org/contracts/identity-trust.schema.json",
  integrationCandidate: "https://example.org/contracts/integration-candidate.schema.json",
  tenantContext: "https://example.org/contracts/tenant-context.schema.json",
  serviceClass: "https://example.org/contracts/service-class.schema.json",
  componentManifest: "https://example.org/contracts/component-manifest.schema.json",
  installationProfile: "https://example.org/contracts/installation-profile.schema.json",
  platformMatrix: "https://example.org/contracts/platform-matrix.schema.json",
  testMatrix: "https://example.org/contracts/test-matrix.schema.json",
  threatRegister: "https://example.org/contracts/threat-register.schema.json",
  riskException: "https://example.org/contracts/risk-exception.schema.json",
  independentAssessment: "https://example.org/contracts/independent-assessment.schema.json",
  releaseGateResult: "https://example.org/contracts/release-gate-result.schema.json",
  dataRegister: "https://example.org/contracts/data-register.schema.json",
};

/** Læs alle kontraktskemaer fra /contracts. */
export function loadContractSchemas() {
  return readdirSync(contractsDir)
    .filter((f) => f.endsWith(".schema.json"))
    .sort()
    .map((f) => {
      const raw = readFileSync(join(contractsDir, f), "utf8");
      try {
        return { file: f, schema: JSON.parse(raw) };
      } catch (err) {
        throw new Error(`Kontraktskema ${f} er ikke gyldig JSON: ${err.message}`);
      }
    });
}

/** Byg en Ajv-instans med alle kontrakter registreret pr. $id. */
export function buildAjv({ strict = false } = {}) {
  const ajv = new Ajv2020({ allErrors: true, strict, allowUnionTypes: true });
  addFormats(ajv);
  const schemas = loadContractSchemas();
  for (const { file, schema } of schemas) {
    if (!schema.$id) throw new Error(`Kontraktskema ${file} mangler $id`);
    ajv.addSchema(schema, schema.$id);
  }
  return { ajv, schemas };
}

/**
 * Validér data mod et skema. Returnerer en normaliseret fejlstruktur i stedet
 * for at kaste, så checks kan rapportere pænt.
 */
export function validate(ajv, schemaId, data) {
  const validateFn = ajv.getSchema(schemaId);
  if (!validateFn) throw new Error(`Ukendt skema: ${schemaId}`);
  const ok = validateFn(data);
  return {
    ok,
    errors: ok ? [] : (validateFn.errors ?? []).map(formatAjvError),
  };
}

function formatAjvError(err) {
  const path = err.instancePath || "/";
  return {
    path,
    keyword: err.keyword,
    message: err.message,
    params: err.params,
  };
}

/** Menneske-læsbar fejlstreng til rapporter. */
export function describeErrors(errors) {
  return errors.map((e) => `  ${e.path} ${e.message}`.trim()).join("\n");
}
