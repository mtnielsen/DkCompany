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
  protectedData: "https://example.org/contracts/protected-data.schema.json",
  databaseProfile: "https://example.org/contracts/database-profile.schema.json",
  dataSource: "https://example.org/contracts/data-source.schema.json",
  dataServiceBinding: "https://example.org/contracts/data-service-binding.schema.json",
  sbom: "https://example.org/contracts/sbom.schema.json",
  buildProvenance: "https://example.org/contracts/build-provenance.schema.json",
  artifactManifest: "https://example.org/contracts/artifact-manifest.schema.json",
  branchProtection: "https://example.org/contracts/branch-protection.schema.json",
  infrastructurePlan: "https://example.org/contracts/infrastructure-plan.schema.json",
  evidenceRecord: "https://example.org/contracts/evidence-record.schema.json",
  vulnerabilityInventory: "https://example.org/contracts/vulnerability-inventory.schema.json",
  upstreamReleaseProfile: "https://example.org/contracts/upstream-release-profile.schema.json",
  upstreamUpgradePlan: "https://example.org/contracts/upstream-upgrade-plan.schema.json",
  privacyExport: "https://example.org/contracts/privacy-export.schema.json",
  backupManifest: "https://example.org/contracts/backup-manifest.schema.json",
  restoreDrill: "https://example.org/contracts/restore-drill.schema.json",
  backupTarget: "https://example.org/contracts/backup-target.schema.json",
  backupTargetSet: "https://example.org/contracts/backup-target-set.schema.json",
  telemetryRecord: "https://example.org/contracts/telemetry-record.schema.json",
  sensorRegistry: "https://example.org/contracts/sensor-registry.schema.json",
  alertRuleSet: "https://example.org/contracts/alert-rule-set.schema.json",
  alertNotification: "https://example.org/contracts/alert-notification.schema.json",
  securityPosture: "https://example.org/contracts/security-posture.schema.json",
  telemetryEnvelope: "https://example.org/contracts/telemetry-envelope.schema.json",
  dashboardView: "https://example.org/contracts/dashboard-view.schema.json",
  dashboardAdapter: "https://example.org/contracts/dashboard-adapter.schema.json",
  collectorStatus: "https://example.org/contracts/collector-status.schema.json",
  testRun: "https://example.org/contracts/test-run.schema.json",
  recoveryStatus: "https://example.org/contracts/recovery-status.schema.json",
  featureProfile: "https://example.org/contracts/feature-profile.schema.json",
  reportDefinition: "https://example.org/contracts/report-definition.schema.json",
  reportRun: "https://example.org/contracts/report-run.schema.json",
  offboardingPlan: "https://example.org/contracts/offboarding-plan.schema.json",
  haCluster: "https://example.org/contracts/ha-cluster.schema.json",
  messagingTopology: "https://example.org/contracts/messaging-topology.schema.json",
  outboxRecord: "https://example.org/contracts/outbox-record.schema.json",
  databaseHA: "https://example.org/contracts/database-ha.schema.json",
  storagePlan: "https://example.org/contracts/storage-plan.schema.json",
  immutableEnforcement: "https://example.org/contracts/immutable-enforcement.schema.json",
  retentionDeletionPolicy: "https://example.org/contracts/retention-deletion-policy.schema.json",
  legalHold: "https://example.org/contracts/legal-hold.schema.json",
  deletionReceipt: "https://example.org/contracts/deletion-receipt.schema.json",
  logRecord: "https://example.org/contracts/log-record.schema.json",
  loggingPolicy: "https://example.org/contracts/logging-policy.schema.json",
  logAccessDecision: "https://example.org/contracts/log-access-decision.schema.json",
  disasterRecoveryPlan: "https://example.org/contracts/disaster-recovery-plan.schema.json",
  recoveryAccessProfile: "https://example.org/contracts/recovery-access-profile.schema.json",
  pitrReconciliation: "https://example.org/contracts/pitr-reconciliation.schema.json",
  disasterRecoveryDrill: "https://example.org/contracts/disaster-recovery-drill.schema.json",
  dedupPolicy: "https://example.org/contracts/dedup-policy.schema.json",
  dedupReceipt: "https://example.org/contracts/dedup-receipt.schema.json",
  assuranceRegister: "https://example.org/contracts/assurance-register.schema.json",
  evidencePackage: "https://example.org/contracts/evidence-package.schema.json",
  servicePackage: "https://example.org/contracts/service-package.schema.json",
  tenantLifecycle: "https://example.org/contracts/tenant-lifecycle.schema.json",
  customerOrder: "https://example.org/contracts/customer-order.schema.json",
  serviceCatalog: "https://example.org/contracts/service-catalog.schema.json",
  onCallRotation: "https://example.org/contracts/on-call-rotation.schema.json",
  itsmRecord: "https://example.org/contracts/itsm-record.schema.json",
  runbook: "https://example.org/contracts/runbook.schema.json",
  changeRequest: "https://example.org/contracts/change-request.schema.json",
  remediationPlan: "https://example.org/contracts/remediation-plan.schema.json",
  resourceLease: "https://example.org/contracts/resource-lease.schema.json",
  healthObservation: "https://example.org/contracts/health-observation.schema.json",
  platformConfiguration: "https://example.org/contracts/platform-configuration.schema.json",
  hostScope: "https://example.org/contracts/host-scope.schema.json",
  installerPlan: "https://example.org/contracts/installer-plan.schema.json",
  retentionChangePreview: "https://example.org/contracts/retention-change-preview.schema.json",
  hostEnrollment: "https://example.org/contracts/host-enrollment.schema.json",
  hostProfile: "https://example.org/contracts/host-profile.schema.json",
  hostOperation: "https://example.org/contracts/host-operation.schema.json",
  projectExport: "https://example.org/contracts/project-export.schema.json",
  capacityPlan: "https://example.org/contracts/capacity-plan.schema.json",
  failureMatrix: "https://example.org/contracts/failure-matrix.schema.json",
  autonomyGrant: "https://example.org/contracts/autonomy-grant.schema.json",
  shadowRun: "https://example.org/contracts/shadow-run.schema.json",
  takeoverPlan: "https://example.org/contracts/takeover-plan.schema.json",
  recoveryDrill: "https://example.org/contracts/recovery-drill.schema.json",
  priceBook: "https://example.org/contracts/price-book.schema.json",
  usageLedger: "https://example.org/contracts/usage-ledger.schema.json",
  costReport: "https://example.org/contracts/cost-report.schema.json",
  tcoComparison: "https://example.org/contracts/tco-comparison.schema.json",
  knowledgeSource: "https://example.org/contracts/knowledge-source.schema.json",
  knowledgeDocument: "https://example.org/contracts/knowledge-document.schema.json",
  retrievalAnswer: "https://example.org/contracts/retrieval-answer.schema.json",
  helpdeskSource: "https://example.org/contracts/helpdesk-source.schema.json",
  supportTicket: "https://example.org/contracts/support-ticket.schema.json",
  replyDraft: "https://example.org/contracts/reply-draft.schema.json",
  crmSource: "https://example.org/contracts/crm-source.schema.json",
  crmRecord: "https://example.org/contracts/crm-record.schema.json",
  crmDeletionReceipt: "https://example.org/contracts/crm-deletion-receipt.schema.json",
  migrationSource: "https://example.org/contracts/migration-source.schema.json",
  migrationCoverage: "https://example.org/contracts/migration-coverage.schema.json",
  migrationReconciliation: "https://example.org/contracts/migration-reconciliation.schema.json",
  migrationExport: "https://example.org/contracts/migration-export.schema.json",
  migrationApproval: "https://example.org/contracts/migration-approval.schema.json",
  providerCapabilityCatalog: "https://example.org/contracts/provider-capability-catalog.schema.json",
  providerRegistry: "https://example.org/contracts/provider-registry.schema.json",
  providerSupportMatrix: "https://example.org/contracts/provider-support-matrix.schema.json",
  providerPreflight: "https://example.org/contracts/provider-preflight.schema.json",
  providerSwapReceipt: "https://example.org/contracts/provider-swap-receipt.schema.json",
  releaseCatalog: "https://example.org/contracts/release-catalog.schema.json",
  lifecycleUpdatePlan: "https://example.org/contracts/lifecycle-update-plan.schema.json",
  lifecycleRemovalPlan: "https://example.org/contracts/lifecycle-removal-plan.schema.json",
  supportBundlePolicy: "https://example.org/contracts/support-bundle-policy.schema.json",
  supportBundle: "https://example.org/contracts/support-bundle.schema.json",
  offlinePackage: "https://example.org/contracts/offline-package.schema.json",
  acceptanceScenario: "https://example.org/contracts/acceptance-scenario.schema.json",
  acceptanceGatePolicy: "https://example.org/contracts/acceptance-gate-policy.schema.json",
  acceptanceResult: "https://example.org/contracts/acceptance-result.schema.json",
  raciRegistry: "https://example.org/contracts/raci-registry.schema.json",
  rulesOfEngagement: "https://example.org/contracts/rules-of-engagement.schema.json",
  securityAssessment: "https://example.org/contracts/security-assessment.schema.json",
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
