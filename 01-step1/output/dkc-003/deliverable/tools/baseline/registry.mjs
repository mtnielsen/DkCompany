/**
 * Kanonisk register for baselinekontrollen.
 *
 * Registeret er den ene kilde, der beskriver:
 *   - hvilke eksisterende checks der kan køres,
 *   - hvilket modenhedsniveau hver check faktisk dokumenterer, og
 *   - hvilke komponenter de hører til.
 *
 * Niveauer (level):
 *   real         Førsteparts kode efterprøvet deterministisk uden eksterne systemer.
 *   mock         Førsteparts kode efterprøvet mod en test-dobbelt for et eksternt system.
 *   fixture      Bevidst sample-/negativ-data, ikke en kørende integration.
 *   contract     Skemavalidering/metavalidering af kontrakter.
 *   integration  Kræver et levende eksternt system; kan ikke køres isoleret.
 *
 * En check med `external: true` forsøges ikke kørt. Den registreres som NOT RUN
 * med en begrundelse, så et manglende bevis aldrig forveksles med PASS.
 */

export const LEVELS = {
  real: { label: "Real", description: "Førsteparts implementering, deterministisk efterprøvet" },
  mock: { label: "Mock", description: "Efterprøvet mod test-dobbelt for eksternt system" },
  fixture: { label: "Fixture", description: "Sample- eller negativdata, ikke drift" },
  contract: { label: "Contract", description: "Kontrakt-/skemavalidering" },
  integration: { label: "Integration", description: "Kræver levende eksternt system — ikke kørt her" },
};

/** Checks der køres med `make <target>` i repo-roden. */
export const CHECKS = [
  // --- Repo-skelet og kontrakter -------------------------------------------------
  {
    id: "validate",
    title: "Metavalidér kontraktskemaer og eksempler",
    component: "repo-skeleton",
    level: "contract",
    command: ["make", "validate"],
    evidence: ["contracts/", "conformance/src/validate-schemas.mjs"],
  },
  {
    id: "lint",
    title: "Lint JSON og tekstfiler",
    component: "repo-skeleton",
    level: "contract",
    command: ["make", "lint"],
    evidence: ["conformance/src/lint.mjs"],
  },
  {
    id: "test",
    title: "Conformance-suitens egne tests",
    component: "conformance-suite",
    level: "real",
    command: ["make", "test"],
    evidence: ["conformance/test/"],
  },
  {
    id: "identity-test",
    title: "Fælles identitetsverifikation (OIDC, workload, session, ingress)",
    component: "identity-verification",
    level: "real",
    command: ["make", "identity-test"],
    evidence: ["identity/src/", "identity/test/", "gateway/src/ingress.mjs"],
  },
  {
    id: "architecture-test",
    title: "Deployment-, identitets- og kandidatkontrakter (skema + semantik)",
    component: "architecture-contracts",
    level: "real",
    command: ["make", "architecture-test"],
    evidence: [
      "contracts/deployment-profile.schema.json",
      "contracts/identity-trust.schema.json",
      "contracts/integration-candidate.schema.json",
      "conformance/src/architecture.mjs",
      "conformance/test/architecture.test.mjs",
    ],
  },

  // --- Policy ---------------------------------------------------------------------
  {
    id: "policy-test",
    title: "PDP'ens tests",
    component: "policy",
    level: "real",
    command: ["make", "policy-test"],
    evidence: ["policy/pdp/test/"],
  },
  {
    id: "policy-verify",
    title: "Verificér signeret policy-bundle",
    component: "policy",
    level: "real",
    command: ["make", "policy-verify"],
    evidence: ["policy/keys/", "policy/pdp/src/verify.mjs"],
  },
  {
    id: "policy-decide",
    title: "Træf eksempelbeslutning gennem PDP",
    component: "policy",
    level: "real",
    command: ["make", "policy-decide"],
    evidence: ["contracts/examples/policy-input.example.json"],
  },

  // --- GitOps ---------------------------------------------------------------------
  {
    id: "gitops-test",
    title: "GitOps-værktøjernes tests",
    component: "gitops",
    level: "real",
    command: ["make", "gitops-test"],
    evidence: ["gitops/test/"],
  },
  {
    id: "gitops-verify",
    title: "GitOps-policy-gates (digests, labels, hardening, fail-closed)",
    component: "gitops",
    level: "real",
    command: ["make", "gitops-verify"],
    evidence: ["gitops/src/verify.mjs", "gitops/manifests/"],
  },
  {
    id: "gitops-reconcile",
    title: "Reconcile mod simuleret observeret tilstand",
    component: "gitops",
    level: "fixture",
    command: ["make", "gitops-reconcile"],
    evidence: ["gitops/observed/"],
    gap: "Observeret tilstand er en committet simulering, ikke en rigtig klynge.",
  },
  {
    id: "gitops-drift",
    title: "Bevis at simulerede ændringer uden om git opdages",
    component: "gitops",
    level: "fixture",
    command: ["make", "gitops-drift"],
    evidence: ["gitops/observed/dev-drift.json"],
    gap: "Driften er simuleret i repoet; ingen Argo CD/klynge er koblet på.",
  },
  {
    id: "changelog-check",
    title: "Fejl hvis commits mangler DCO sign-off",
    component: "gitops",
    level: "real",
    command: ["make", "changelog-check"],
    evidence: ["gitops/src/changelog.mjs"],
  },
  {
    id: "changelog",
    title: "Udled maskinlæsbar change log fra git",
    component: "gitops",
    level: "real",
    command: ["make", "changelog"],
    evidence: [".conformance-out/CHANGELOG.jsonl"],
  },

  // --- Referencemodul og adaptere -------------------------------------------------
  {
    id: "audit-service-test",
    title: "Referencemodulets tests (identitet, hash-kæde, PDP, fail-closed)",
    component: "audit-service",
    level: "real",
    command: ["make", "audit-service-test"],
    evidence: ["modules/audit-service/service/test/"],
  },
  {
    id: "audit-service-evidence",
    title: "Fremkald konformansbevis ved at køre verberne",
    component: "audit-service",
    level: "real",
    command: ["make", "audit-service-evidence"],
    evidence: ["modules/audit-service/"],
    gap: "Referencetjenesten kører in-process/file-backed; intet deployet runtime er bevist. Skriver capturedAt/durationMs til committede fixtures og er ikke idempotent.",
  },
  {
    id: "adapter-test",
    title: "Mattermost-adapterens tests",
    component: "mattermost-adapter",
    level: "mock",
    command: ["make", "adapter-test"],
    evidence: ["modules/mattermost-adapter/service/test/mock-mattermost.mjs"],
    gap: "Testes mod mock Mattermost, ikke en rigtig installation.",
  },
  {
    id: "adapter-evidence",
    title: "Adapterbevis mod mock Mattermost + rigtig PDP",
    component: "mattermost-adapter",
    level: "mock",
    command: ["make", "adapter-evidence"],
    evidence: ["modules/mattermost-adapter/"],
    gap: "Beviset gælder adfærd mod mock; rigtig Mattermost er en separat integration (NOT RUN). Skriver ikke-idempotente fixtures.",
  },
  {
    id: "iam-adapter-test",
    title: "IAM-adapterens tests (mock Keycloak/Authentik)",
    component: "iam-adapter",
    level: "mock",
    command: ["make", "iam-adapter-test"],
    evidence: ["modules/keycloak-adapter/"],
    gap: "Testes mod mock Keycloak, ikke en rigtig IAM-instans.",
  },
  {
    id: "iam-adapter-evidence",
    title: "IAM-adapterbevis mod mock Keycloak + partial-erkendelse",
    component: "iam-adapter",
    level: "mock",
    command: ["make", "iam-adapter-evidence"],
    evidence: ["modules/keycloak-adapter/"],
    gap: "Beviset gælder adfærd mod mock; rigtig Keycloak/Authentik er en separat integration (NOT RUN). Skriver ikke-idempotente fixtures.",
  },

  // --- Agenter --------------------------------------------------------------------
  {
    id: "gateway-test",
    title: "AI-gatewayens tests (routing, budget, modelversion)",
    component: "ai-gateway",
    level: "mock",
    command: ["make", "gateway-test"],
    evidence: ["gateway/test/", "gateway/src/provider.mjs"],
    gap: "Provideren er en echo-stub; ingen rigtig modelleverandør er koblet på (NOT RUN).",
  },
  {
    id: "runtime-test",
    title: "Agent-runtime tests (A1, fail-closed, A4, budget, loop, JIT)",
    component: "agent-runtime",
    level: "real",
    command: ["make", "runtime-test"],
    evidence: ["runtime/test/"],
  },
  {
    id: "agent-conformance-test",
    title: "De seks agent-konformanstests",
    component: "agent-conformance",
    level: "real",
    command: ["make", "agent-conformance-test"],
    evidence: ["conformance/test/agent-conformance.test.mjs"],
  },
  {
    id: "reviewer-test",
    title: "Reviewer-agent og effektmåling",
    component: "reviewer",
    level: "real",
    command: ["make", "reviewer-test"],
    evidence: ["reviewer/test/"],
  },
  {
    id: "reviewer-metrics",
    title: "Reviewer-effektmålings-dashboard (langtkørende server)",
    component: "reviewer-metrics",
    level: "real",
    command: ["make", "reviewer-metrics"],
    evidence: ["reviewer/src/metrics.mjs"],
    server: true,
    reason:
      "Starter en HTTP-server på 127.0.0.1:8484 og terminerer ikke; det er ikke en afsluttende check. Effektmålingen er dækket af reviewer-test.",
  },

  // --- Evidens, compliance, observability, sikkerhed ------------------------------
  {
    id: "compliance-test",
    title: "Kontrolmappingens tests",
    component: "control-mapping",
    level: "real",
    command: ["make", "compliance-test"],
    evidence: ["compliance/test/"],
  },
  {
    id: "compliance-check",
    title: "Kontrolmapping i sync med registry",
    component: "control-mapping",
    level: "real",
    command: ["make", "compliance-check"],
    evidence: ["compliance/control-mapping.json", "docs/compliance/mapping.md"],
  },
  {
    id: "observability-test",
    title: "Observability-generatorens tests",
    component: "observability",
    level: "real",
    command: ["make", "observability-test"],
    evidence: ["observability/test/"],
  },
  {
    id: "observability-check",
    title: "Dashboards i sync med modulernes SLO",
    component: "observability",
    level: "real",
    command: ["make", "observability-check"],
    evidence: ["observability/src/", "gitops/manifests/dev/"],
  },
  {
    id: "security-test",
    title: "Sikkerhedsnormaliseringens tests",
    component: "security-plan",
    level: "real",
    command: ["make", "security-test"],
    evidence: ["security/test/normalize.test.mjs"],
  },
  {
    id: "security-check",
    title: "Sikkerhedsfund validerer og er i sync med rådata",
    component: "security-plan",
    level: "fixture",
    command: ["make", "security-check"],
    evidence: ["security/raw/", "security/generated/security-findings.json"],
    gap: "Rådata er committede samples; ingen rigtig Trivy/Falco/Wazuh-kørsel indgår (NOT RUN).",
  },
  {
    id: "curriculum-test",
    title: "Ejer-curriculummets tests",
    component: "curriculum",
    level: "real",
    command: ["make", "curriculum-test"],
    evidence: ["curriculum/test/"],
  },
  {
    id: "curriculum-check",
    title: "Validér curriculum og afvisningsscenarier",
    component: "curriculum",
    level: "real",
    command: ["make", "curriculum-check"],
    evidence: ["curriculum/"],
  },
  {
    id: "pitch-test",
    title: "Pitch-checkerens tests",
    component: "pitch",
    level: "real",
    command: ["make", "pitch-test"],
    evidence: ["pitch/test/"],
  },
  {
    id: "pitch-check",
    title: "Hvert bevis i pitch-decket findes i repoet",
    component: "pitch",
    level: "real",
    command: ["make", "pitch-check"],
    evidence: ["pitch/src/cli.mjs", "docs/pitch/"],
  },

  // --- Konformans og OSCAL --------------------------------------------------------
  {
    id: "conform-all",
    title: "Konformans mod alle rigtige moduler",
    component: "conformance-suite",
    level: "real",
    command: ["make", "conform-all"],
    evidence: [".conformance-out/report.json"],
  },
  {
    id: "oscal-evidence",
    title: "Generér OSCAL-assessment-results",
    component: "oscal-evidence",
    level: "real",
    command: ["make", "oscal-evidence"],
    evidence: [".conformance-out/oscal-assessment-results.json"],
  },
  {
    id: "evidence-test",
    title: "Evidens-emitterens tests",
    component: "oscal-evidence",
    level: "real",
    command: ["make", "evidence-test"],
    evidence: ["evidence/test/"],
  },
  {
    id: "conform-negative",
    title: "Bevidst brudt fixture skal fejle",
    component: "conformance-suite",
    level: "fixture",
    command: ["make", "conform-negative"],
    evidence: ["modules/dummy-broken/"],
  },
  {
    id: "dsar-demo",
    title: "DSAR-fan-out mod dummy-moduler",
    component: "privacy-verbs",
    level: "fixture",
    command: ["make", "dsar-demo"],
    evidence: ["conformance/src/dsar.mjs", "modules/dummy-ok/"],
    gap: "Fan-out demonstreres mod dummy-moduler, ikke mod rigtige tjenester.",
  },
  {
    id: "telemetry-test",
    title: "CloudEvent end-to-end gennem collectoren",
    component: "telemetry-plan",
    level: "real",
    command: ["make", "telemetry-test"],
    evidence: ["conformance/test/telemetry.test.mjs"],
  },

  // --- Eksterne integrationer (kan ikke køres isoleret) ---------------------------
  {
    id: "integration-trivy",
    title: "Trivy filesystem-scan (rigtigt værktøj)",
    component: "security-plan",
    level: "integration",
    external: true,
    command: ["trivy", "fs", "--severity", "CRITICAL,HIGH", "."],
    evidence: ["security/raw/trivy-ci.json"],
    reason: "Trivy er ikke installeret i dette miljø; CI-workflowet er fjernet. Sample-data dækker kun normaliseringen.",
  },
  {
    id: "integration-falco",
    title: "Falco runtime-regler i en klynge",
    component: "security-plan",
    level: "integration",
    external: true,
    command: ["falco", "-r", "security/falco/platform-rules.yaml"],
    evidence: ["security/falco/platform-rules.yaml"],
    reason: "Kræver en levende container-runtime/klynge. Reglerne er kun konfiguration i repoet.",
  },
  {
    id: "integration-wazuh",
    title: "Wazuh SIEM-regler i en klynge",
    component: "security-plan",
    level: "integration",
    external: true,
    command: ["wazuh", "-t", "-r", "security/wazuh/local_rules.xml"],
    evidence: ["security/wazuh/local_rules.xml"],
    reason: "Kræver en levende SIEM-installation. Reglerne er kun konfiguration i repoet.",
  },
  {
    id: "integration-mattermost",
    title: "Rigtig Mattermost-installation",
    component: "mattermost-adapter",
    level: "integration",
    external: true,
    command: ["make", "adapter-run"],
    evidence: ["docs/spec/adapter.md"],
    reason: "Ingen MATTERMOST_URL/credentials i dette miljø. Kun mock-adfærd er bevist.",
  },
  {
    id: "integration-keycloak",
    title: "Rigtig Keycloak/Authentik-instans",
    component: "iam-adapter",
    level: "integration",
    external: true,
    command: ["make", "iam-adapter-run"],
    evidence: ["docs/spec/iam-adapter.md"],
    reason: "Ingen IAM-instans i dette miljø. Kun mock-adfærd er bevist.",
  },
  {
    id: "integration-llm",
    title: "Rigtig modelleverandør gennem AI-gateway",
    component: "ai-gateway",
    level: "integration",
    external: true,
    command: ["make", "gateway-run"],
    evidence: ["gateway/src/provider.mjs"],
    reason: "Kun echo-provider findes; ingen leverandørnøgle/-endpoint er konfigureret.",
  },
  {
    id: "integration-oidc",
    title: "Rigtig OIDC-identitetsudbyder",
    component: "identity-plan",
    level: "integration",
    external: true,
    command: ["make", "runtime-demo"],
    evidence: ["contracts/identity.schema.json"],
    reason: "Identitet er kontraktvalideret og simuleret; ingen rigtig IdP er koblet på.",
  },
  {
    id: "integration-github-actions",
    title: "GitHub Actions CI",
    component: "ci",
    level: "integration",
    external: true,
    command: ["gh", "workflow", "run", "CI"],
    evidence: [".github/workflows/ci.yml"],
    reason: "Workflowet blev fjernet i commit 76e4782, og Actions er slået fra på repo-niveau. Kun lokal `make ci`/`make baseline` kan køres.",
  },
];

/**
 * Komponenter, som implementation-matrix.md rapporterer pr. række.
 * `level` er den stærkeste form for bevis komponenten har, ikke et ønske.
 */
export const COMPONENTS = [
  { id: "repo-skeleton", wave: "0.1", title: "Repo-skelet og beslutningslog", docs: ["docs/adr/", "README.md"], checks: ["validate", "lint"] },
  {
    id: "identity-verification",
    wave: "2",
    title: "Verificerbar identitet (DKC-003)",
    docs: ["docs/spec/identity-verification.md", "identity/", "gateway/src/ingress.mjs"],
    checks: ["identity-test"],
  },
  {
    id: "architecture-contracts",
    wave: "1",
    title: "Deployment- og identitetskontrakter (DKC-002)",
    docs: ["docs/adr/0013-deployment-og-tenantmodel.md", "docs/adr/0014-identitets-og-tillidsmodel.md", "docs/spec/architecture-contracts.md", "contracts/"],
    checks: ["architecture-test", "validate"],
  },
  { id: "identity-plan", wave: "0.2", title: "Identitetsplan", docs: ["docs/spec/identity-plan.md", "contracts/identity.schema.json"], checks: ["integration-oidc"] },
  { id: "telemetry-plan", wave: "0.3", title: "Telemetriplan", docs: ["docs/spec/telemetry-plan.md"], checks: ["telemetry-test"] },
  { id: "ops-contract", wave: "0.4", title: "Ops-kontrakt", docs: ["docs/spec/ops-contract.md", "contracts/module-manifest.schema.json"], checks: ["validate"] },
  { id: "privacy-verbs", wave: "0.5", title: "Privacy-verber", docs: ["docs/spec/privacy-verbs.md"], checks: ["dsar-demo"] },
  { id: "conformance-suite", wave: "0.6", title: "Konformanssuite", docs: ["docs/spec/conformance-suite.md", "conformance/"], checks: ["test", "conform-all", "conform-negative"] },
  { id: "policy", wave: "1.1", title: "Policy-plan (PDP)", docs: ["docs/spec/policy-plan.md", "policy/pdp/", "docs/adr/0004-letvaegts-pdp.md"], checks: ["policy-test", "policy-verify", "policy-decide"] },
  { id: "gitops", wave: "1.2", title: "GitOps-skelet", docs: ["docs/spec/gitops.md", "gitops/", "docs/adr/0005-git-eneste-aendringskanal.md"], checks: ["gitops-test", "gitops-verify", "gitops-reconcile", "gitops-drift", "changelog-check", "changelog"] },
  { id: "audit-service", wave: "1.3", title: "Referencemodul A (audit-service)", docs: ["docs/spec/reference-module.md", "modules/audit-service/"], checks: ["audit-service-test", "audit-service-evidence"] },
  { id: "mattermost-adapter", wave: "1.4", title: "Referenceadapter B (Mattermost)", docs: ["docs/spec/adapter.md", "modules/mattermost-adapter/"], checks: ["adapter-test", "adapter-evidence", "integration-mattermost"] },
  { id: "agent-manifest", wave: "2.1", title: "Agent-manifest + approval-payload", docs: ["contracts/agent-manifest.schema.json", "contracts/approval-request.schema.json"], checks: ["validate"] },
  { id: "ai-gateway", wave: "2.2", title: "AI-gateway", docs: ["docs/spec/ai-gateway.md", "gateway/", "docs/adr/0006-alle-modelkald-gennem-gateway.md"], checks: ["gateway-test", "integration-llm"] },
  { id: "agent-runtime", wave: "2.3", title: "Agent-runtime", docs: ["docs/spec/agent-runtime.md", "runtime/"], checks: ["runtime-test"] },
  {
    id: "approval-service",
    wave: "2.4",
    title: "Approval-service + UI",
    docs: ["docs/spec/approval-service.md", "approvals/"],
    checks: ["test", "agent-conformance-test"],
    gaps: ["Ingen dedikeret `approval-test`-target i Makefile; dækkes indirekte af conformance-suitens kontrakt- og agenttests."],
  },
  { id: "reviewer", wave: "2.5", title: "Adversarial reviewer-agent", docs: ["docs/spec/reviewer.md", "reviewer/", "docs/adr/0007-evidens-og-prosa-adskilt.md"], checks: ["reviewer-test"] },
  { id: "agent-conformance", wave: "2.6", title: "Agent-konformanstests (seks)", docs: ["docs/spec/agent-conformance.md"], checks: ["agent-conformance-test"] },
  { id: "reviewer-metrics", wave: "2.7", title: "Reviewer-effektmåling", docs: ["docs/spec/reviewer-metrics.md", "reviewer/src/metrics.mjs"], checks: ["reviewer-metrics"] },
  { id: "oscal-evidence", wave: "3.1", title: "Compliance-evidens-emitter (OSCAL)", docs: ["docs/spec/oscal-evidence.md", "evidence/", "docs/adr/0008-oscal-evidensprofil.md"], checks: ["oscal-evidence", "evidence-test"] },
  { id: "control-mapping", wave: "3.2", title: "Kontrolmapping NIS2/GDPR/AI Act", docs: ["docs/spec/control-mapping.md", "compliance/", "docs/adr/0009-kontrolmapping-roller.md"], checks: ["compliance-test", "compliance-check"] },
  { id: "observability", wave: "3.3", title: "Ops-dashboards (Prometheus/Grafana/Loki)", docs: ["docs/spec/observability.md", "observability/", "docs/adr/0010-dashboards-fra-manifest.md"], checks: ["observability-test", "observability-check"] },
  { id: "security-plan", wave: "3.4", title: "Security-plan (Trivy/Falco/Wazuh)", docs: ["docs/spec/security-plan.md", "security/", "docs/adr/0011-sikkerhedsfund-i-evidensplanen.md"], checks: ["security-test", "security-check", "integration-trivy", "integration-falco", "integration-wazuh"] },
  { id: "curriculum", wave: "4.1", title: "Ejer-curriculum", docs: ["docs/spec/curriculum.md", "curriculum/", "docs/adr/0012-ejer-curriculum.md"], checks: ["curriculum-check", "curriculum-test"] },
  { id: "iam-adapter", wave: "4.2", title: "Yderligere adaptere (IAM)", docs: ["docs/spec/iam-adapter.md", "modules/keycloak-adapter/"], checks: ["iam-adapter-test", "iam-adapter-evidence", "integration-keycloak"] },
  { id: "pitch", wave: "4.3", title: "Pitch / LinkedIn", docs: ["docs/pitch/", "pitch/"], checks: ["pitch-check", "pitch-test"] },
  { id: "ci", wave: "CI", title: "CI og reproducerbar baselinekontrol", docs: ["tools/baseline/", "docs/status/implementation-matrix.md"], checks: ["integration-github-actions"] },
];

export function checkById(id) {
  const found = CHECKS.find((c) => c.id === id);
  if (!found) throw new Error(`Ukendt check-id: ${id}`);
  return found;
}

export function componentById(id) {
  const found = COMPONENTS.find((c) => c.id === id);
  if (!found) throw new Error(`Ukendt komponent-id: ${id}`);
  return found;
}
