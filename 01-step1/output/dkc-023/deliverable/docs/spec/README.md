# Specifikationer

De fire planer og den suite, der bevogter dem. Hver spec svarer til et punkt i `BACKLOG.md` bølge 0.

- [Identitetsplanen](identity-plan.md) — 0.2
- [Telemetriplanen](telemetry-plan.md) — 0.3
- [Ops-kontrakten](ops-contract.md) — 0.4
- [Privacy-verberne](privacy-verbs.md) — 0.5
- [Konformanssuiten](conformance-suite.md) — 0.6
- [Policy-planen (PDP)](policy-plan.md) — 1.1
- [GitOps-skelettet](gitops.md) — 1.2
- [Referencemodul A: audit-service](reference-module.md) — 1.3
- [Referenceadapter B: Mattermost](adapter.md) — 1.4
- [AI-gatewayen](ai-gateway.md) — 2.2 · DKC-012
- [Agent-runtimen](agent-runtime.md) — 2.3 · DKC-005
- [Approval-service](approval-service.md) — 2.4 · DKC-004
- [Adversarial reviewer-agent](reviewer.md) — 2.5
- [Agent-konformanstests](agent-conformance.md) — 2.6
- [Reviewer-effektmåling](reviewer-metrics.md) — 2.7
- [OSCAL-evidens-emitteren](oscal-evidence.md) — 3.1
- [Kontrolmapping: NIS2, GDPR og AI Act](control-mapping.md) — 3.2
- [Ops-dashboards: Prometheus, Grafana og Loki](observability.md) — 3.3
- [Sikkerhedsplan: Trivy, Falco og Wazuh](security-plan.md) — 3.4
- [Ejer-curriculum](curriculum.md) — 4.1
- [IAM-adapter: Keycloak / Authentik](iam-adapter.md) — 4.2
- [Arkitektur- og identitetskontrakter](architecture-contracts.md) — DKC-002
- [Verificerbar identitet](identity-verification.md) — DKC-003
- [Kundeadskillelse gennem kontrolplanet](tenant-isolation.md) — DKC-006
- [Policy-, scope- og evidenskontrol ved runtimegrænsen](policy-boundary.md) — DKC-007
- [Holdbar tilstand, migrationer og databaseidentiteter](persistence.md) — DKC-008
- [Holdbar audit og fail-closed handlinger](audit-durability.md) — DKC-009
- [Kortlivede rettigheder og nødstop](credentials.md) — DKC-010
- [Værktøjsgrænse og injection-forsvar](tool-boundary.md) — DKC-011
- [Genoptagelig og idempotent eksekvering](jobs.md) — DKC-013
- [Serviceklasser, fejldomæner og recoverymål](service-classes.md) — DKC-037
- [Installationsprofiler og dependency-resolver](distribution-profiles.md) — DKC-053
- [Testmatrix og release-gates](release-gates.md) — DKC-063
- [Dataregister og retention](data-register.md) — DKC-019
- [Beskyttede dataklasser (AI-immutable)](data-protection.md) — DKC-047
- [Indbyggede og eksterne datatjenester](data-services.md) — DKC-056
- [Reproducerbare artefakter og beskyttet releasevej](supply-chain.md) — DKC-014
- [Reproducerbar staging med GitOps](staging.md) — DKC-015
- [Evidensmodes: kontraktchecks, integration og driftsbevis](evidence-modes.md) — DKC-018
- [Kontinuerlig sikkerhedskontrol og sårbarhedslivscyklus](vulnerability-management.md) — DKC-064
- [Én rolle pr. agent](agent-registry.md) — DKC-055
- [Fælles adapter-SDK og godkendelsestest](adapter-sdk.md) — DKC-023

Arkitekturvalgene bag findes i [`docs/adr`](../adr/).
