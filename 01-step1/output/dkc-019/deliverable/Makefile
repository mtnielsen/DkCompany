SHELL := bash
NODE  := node
CONF  := conformance
CLI   := $(NODE) $(CONF)/src/cli.mjs

.DEFAULT_GOAL := help

.PHONY: help continuity-check continuity-test continuity-report distribution-check distribution-test distribution-preview release-check release-test release-write release-gate release install validate lint test conform conform-all conform-negative dsar-demo telemetry-test policy-verify policy-test policy-decide gitops-verify gitops-test gitops-reconcile gitops-drift changelog changelog-check audit-service-test audit-service-evidence audit-service-run adapter-test adapter-evidence adapter-run iam-adapter-test iam-adapter-evidence iam-adapter-run gateway-test gateway-check gateway-run budget-test model-egress-check model-gateway-test runtime-test boundary-test runtime-demo agent-conformance-test reviewer-test reviewer-metrics oscal-evidence evidence-test compliance-mapping compliance-check compliance-test data-register-write data-register-check data-register-test observability-dashboards observability-check observability-test security-ingest security-check security-test curriculum-check curriculum-render curriculum-test pitch-check pitch-test baseline baseline-render baseline-test architecture-check architecture-test identity-test tenant-check tenant-test approval-check approval-test approval-run persistence-check persistence-test audit-durability-check audit-durability-test agent-registry-check agent-registry-test credentials-check credentials-test tool-boundary-check tool-boundary-test jobs-check jobs-test ci clean

help: ## Vis denne hjælp
	@echo "Platformens kontrakter — tilgængelige mål:"
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

baseline: ## Kør baselinekontrol: checks + evidens + docs/status/implementation-matrix.md
	$(NODE) tools/baseline/baseline.mjs run

baseline-render: ## Genskab implementation-matrix.md fra seneste baselineevidens
	$(NODE) tools/baseline/baseline.mjs render

baseline-test: ## Kør baseline-værktøjets egne tests
	cd tools/baseline && $(NODE) --test

architecture-check: ## Validér deployment-, identitets- og kandidatkontrakter (skema + semantik)
	$(NODE) $(CONF)/src/validate-schemas.mjs

continuity-check: ## Validér serviceklasser, moduldækning og deployment-profilkompatibilitet (DKC-037)
	$(NODE) --no-warnings continuity/src/check.mjs

continuity-test: ## Kør serviceklasse- og recovery-testene (DKC-037)
	cd continuity && $(NODE) --no-warnings --test
	cd $(CONF) && $(NODE) --test test/service-class-conformance.test.mjs

continuity-report: ## Skriv recovery-rapporten fra serviceklasser og prober (DKC-037)
	$(NODE) --no-warnings continuity/src/report.mjs

distribution-check: ## Validér katalog, installationsprofiler, platformmatrix og resolver (DKC-053)
	$(NODE) --no-warnings distribution/src/check.mjs

distribution-test: ## Kør katalog-, profil- og resolver-testene (DKC-053)
	cd distribution && $(NODE) --no-warnings --test
	cd $(CONF) && $(NODE) --test test/distribution-conformance.test.mjs

distribution-preview: ## Vis et deterministisk installationspreview (DKC-053); brug PROFILE= og APPS=
	$(NODE) --no-warnings distribution/src/preview.mjs --profile $(or $(PROFILE),small-vps) --apps "$(APPS)"

release-check: ## Validér testmatrix, trusselmodel, undtagelser og uafhængige vurderinger (DKC-063)
	$(NODE) --no-warnings release/src/check.mjs

release-write: ## Genskab docs/testing/test-matrix.md og docs/security/threat-model.md (DKC-063)
	$(NODE) --no-warnings release/src/cli.mjs write

release-test: ## Kør release-gate-testene (failed/skipped/not-run/stale/wrong-artifact kan ikke bestå) (DKC-063)
	cd release && $(NODE) --no-warnings --test
	cd $(CONF) && $(NODE) --test test/release-conformance.test.mjs

release-gate: ## Evaluer seneste baseline mod testmatricen og skriv release-gate (DKC-063)
	$(NODE) --no-warnings release/src/cli.mjs gate

release: baseline release-gate ## Kør baseline og bagefter release-gaten (DKC-063)

architecture-test: ## Kør arkitektur-/identitetskontrakternes tests
	cd $(CONF) && $(NODE) --test test/architecture.test.mjs

identity-test: ## Kør den fælles identitetsverifikation (OIDC, workload, session, ingress)
	cd identity && $(NODE) --test

tenant-check: ## Validér tenant-kontekst og ressource-ID-kontrakt (skema + semantik)
	$(NODE) $(CONF)/src/tenant-check.mjs

tenant-test: ## Kør tenantisolations-testene (kontekst, datalager, API, UI-backend, gateway)
	cd identity && $(NODE) --test test/tenant.test.mjs test/tenant-store.test.mjs
	cd $(CONF) && $(NODE) --test test/tenant-conformance.test.mjs
	cd gateway && $(NODE) --test
	cd modules/audit-service/service && $(NODE) --test
	cd modules/mattermost-adapter/service && $(NODE) --test
	cd modules/keycloak-adapter/service && $(NODE) --test
	cd approvals && $(NODE) --test

approval-check: ## Validér godkendelsesbinding og state machine (skema + semantik)
	$(NODE) $(CONF)/src/approval-check.mjs

approval-test: ## Kør godkendelseskonformansen (autentiske, ændringsbundne godkendelser + persistence)
	cd approvals && $(NODE) --test
	cd $(CONF) && $(NODE) --test test/approval-conformance.test.mjs

approval-run: ## Start approval-servicen med filbaseret lager og audit-log (kræver OIDC/JWKS)
	$(NODE) approvals/src/cli.mjs

persistence-check: ## Validér migrationer, tenant-views og databaseidentiteter (DKC-008)
	$(NODE) --no-warnings persistence/src/check.mjs

persistence-test: ## Kør persistenslagets tests (migrationer, genstart, samtidighed, tenantgrænser, backup)
	cd persistence && $(NODE) --no-warnings --test

audit-durability-check: ## Validér holdbar audit: intent/outcome, idempotens, checkpoint og roller (DKC-009)
	$(NODE) --no-warnings persistence/src/audit-check.mjs

audit-durability-test: ## Kør DKC-009-testene (journal, checkpoint, runtime, audit-service, konformans)
	cd persistence && $(NODE) --no-warnings --test test/audit-journal.test.mjs test/checkpoint.test.mjs
	cd runtime && $(NODE) --test test/audit-durability-runtime.test.mjs
	cd modules/audit-service/service && $(NODE) --test test/audit-durability.test.mjs
	cd $(CONF) && $(NODE) --test test/audit-durability-conformance.test.mjs

credentials-check: ## Validér signerede, scope-bundne rettigheder, tilbagekaldelse og nødstop (DKC-010)
	$(NODE) --no-warnings credentials/src/check.mjs

credentials-test: ## Kør DKC-010-testene (credentials, runtime, audit-service-modtager, gitops, konformans)
	cd credentials && $(NODE) --test
	cd runtime && $(NODE) --test test/credentials-runtime.test.mjs
	cd modules/audit-service/service && $(NODE) --test test/credential-receiver.test.mjs
	cd gitops && $(NODE) --test test/verify.test.mjs
	cd $(CONF) && $(NODE) --test test/credentials-conformance.test.mjs

tool-boundary-check: ## Validér værktøjsallowlist, parametre, egress og angrebskorpus (DKC-011)
	$(NODE) --no-warnings runtime/src/tool-check.mjs

tool-boundary-test: ## Kør DKC-011-testene (typede værktøjer, injection-korpus, model-output, konformans)
	cd runtime && $(NODE) --test test/tool-boundary.test.mjs test/injection.test.mjs
	cd $(CONF) && $(NODE) --test test/tool-boundary-conformance.test.mjs

jobs-check: ## Validér jobtilstandsmaskine, leases, retry, dead-letter og handlingsklassifikation (DKC-013)
	$(NODE) --no-warnings jobs/src/check.mjs

jobs-test: ## Kør DKC-013-testene (tilstand/retry, runner, reconciliation, konformans)
	cd jobs && $(NODE) --test
	cd $(CONF) && $(NODE) --test test/jobs-conformance.test.mjs

agent-registry-check: ## Validér at hvert agent-manifest har præcis én gyldig rolle (DKC-055)
	$(NODE) --no-warnings agent-registry/src/check.mjs

agent-registry-test: ## Kør testene for rollehåndhævelse, register, handoff og scheduler (DKC-055)
	cd agent-registry && $(NODE) --no-warnings --test

install: ## Installér conformance-suitens afhængigheder
	cd $(CONF) && npm ci --no-audit --no-fund

validate: ## Metavalidér kontraktskemaer og eksempler
	$(NODE) $(CONF)/src/validate-schemas.mjs

lint: ## Lint JSON og tekstfiler
	$(NODE) $(CONF)/src/lint.mjs

test: ## Kør conformance-suitens egne tests
	cd $(CONF) && $(NODE) --test

conform: ## Kør konformans mod ét modul: make conform MODULE=dummy-ok
	@test -n "$(MODULE)" || (echo "Brug: make conform MODULE=<navn>"; exit 2)
	$(CLI) --module $(MODULE)

conform-all: ## Kør konformans mod alle rigtige moduler og skriv rapport + badge
	@mkdir -p .conformance-out
	$(CLI) --all --exclude dummy-broken --report .conformance-out/report.json --badge .conformance-out/badge.json

conform-negative: ## Bevis at den bevidst brudte fixture faktisk fejler
	$(CLI) --module dummy-broken --expect-fail

oscal-evidence: conform-all changelog security-ingest ## Generér OSCAL-assessment-results fra platformens artefakter
	$(NODE) evidence/src/cli.mjs --out .conformance-out/oscal-assessment-results.json

evidence-test: oscal-evidence ## Kør evidens-emitterens tests (validerer OSCAL-pakken)
	cd evidence && $(NODE) --test

compliance-mapping: ## Genskab docs/compliance/mapping.md fra den kanoniske registry
	$(NODE) compliance/src/cli.mjs write

compliance-check: ## Fejl hvis docs/compliance/mapping.md er ude af trit med registry
	$(NODE) compliance/src/cli.mjs check

compliance-test: ## Kør kontrolmappingens tests (validering + krydsreferencer)
	cd compliance && $(NODE) --test

data-register-write: ## Genskab docs/compliance/data-register.md fra det kanoniske register (DKC-019)
	$(NODE) compliance/src/data-register-cli.mjs write

data-register-check: ## Fejl hvis dataregisteret er ude af trit eller mangler ejer/aftale/vurdering (DKC-019)
	$(NODE) compliance/src/data-register-cli.mjs check
	$(NODE) compliance/src/data-register-cli.mjs verify

data-register-test: ## Kør dataregister-, retention-, blocker- og tenantautorisationstestene (DKC-019)
	cd compliance && $(NODE) --test test/data-register.test.mjs test/data-register-service.test.mjs
	cd persistence && $(NODE) --no-warnings --test test/data-register.test.mjs
	cd $(CONF) && $(NODE) --test test/data-register-conformance.test.mjs

observability-dashboards: ## Genskab Prometheus-regler og Grafana-dashboards fra modulets SLO
	$(NODE) observability/src/cli.mjs write

observability-check: ## Fejl hvis dashboards/regler er ude af trit med modulets SLO
	$(NODE) observability/src/cli.mjs check

observability-test: ## Kør observability-generatorens tests
	cd observability && $(NODE) --test

security-ingest: ## Normalisér Trivy/Falco/Wazuh-fund til security/generated/security-findings.json
	$(NODE) security/src/cli.mjs write

security-check: ## Validér sikkerhedsfundene og fejl hvis de er ude af trit med rådata
	$(NODE) security/src/cli.mjs check

security-test: ## Kør sikkerhedsnormaliseringens tests
	cd security && $(NODE) --test

curriculum-check: ## Validér ejer-curriculumet og dets afvisningsscenarier
	$(NODE) curriculum/src/cli.mjs check

curriculum-render: ## Vis curriculumets moduler og scenarier
	$(NODE) curriculum/src/cli.mjs render

curriculum-test: ## Kør curriculumets tests (inkl. håndhævelse i 2.4)
	cd curriculum && $(NODE) --test

pitch-check: ## Efterprøv at hvert bevis i pitch-decket findes
	$(NODE) pitch/src/cli.mjs check

pitch-test: ## Kør pitch-checkerens tests
	cd pitch && $(NODE) --test

dsar-demo: ## Demonstrér DSAR-fan-out mod alle dummy-moduler
	$(NODE) $(CONF)/src/dsar.mjs --verb subject.erase --tenant acme --identifier email=kunde@example.org

telemetry-test: ## Validér et CloudEvent end-to-end gennem collectoren
	cd $(CONF) && $(NODE) --test test/telemetry.test.mjs

policy-verify: ## Verificér den signerede policy-bundle mod betroede nøgler
	$(NODE) policy/pdp/src/cli.mjs verify

policy-test: ## Kør PDP'ens tests
	cd policy/pdp && $(NODE) --test

policy-decide: ## Træf en eksempelbeslutning (upgrade i staging)
	$(NODE) policy/pdp/src/cli.mjs decide --input contracts/examples/policy-input.example.json

gitops-test: ## Kør GitOps-værktøjernes tests
	cd gitops && $(NODE) --test

gitops-verify: ## Kontrollér GitOps-policy-gates (image-digests, labels, hardening)
	$(NODE) gitops/src/cli.mjs verify --exclude dummy-broken

gitops-reconcile: ## Sammenlign git med observeret tilstand (forventer in-sync)
	$(NODE) gitops/src/cli.mjs reconcile

gitops-drift: ## Bevis at ændringer uden om git opdages og føres tilbage
	$(NODE) gitops/src/cli.mjs drift

changelog: ## Udled maskinlæsbar change log fra git (NIS2)
	@mkdir -p .conformance-out
	$(NODE) gitops/src/cli.mjs changelog --out .conformance-out/CHANGELOG.jsonl

changelog-check: ## Fejl hvis nogen commit mangler DCO sign-off
	$(NODE) gitops/src/cli.mjs changelog --check

audit-service-test: ## Kør referencemodulets (audit-service) tests
	cd modules/audit-service/service && $(NODE) --test

audit-service-evidence: ## Generér konformansbevis ved at køre verberne mod tjenesten
	$(NODE) modules/audit-service/service/src/evidence.mjs

audit-service-run: ## Start audit-service lokalt (kræver kørende PDP)
	$(NODE) modules/audit-service/service/src/cli.mjs

adapter-test: ## Kør referenceadapterens (mattermost) tests
	cd modules/mattermost-adapter/service && $(NODE) --test

adapter-evidence: ## Generér adapterbevis mod mock Mattermost + rigtig PDP
	$(NODE) modules/mattermost-adapter/service/src/evidence.mjs

adapter-run: ## Start Mattermost-adapteren lokalt
	$(NODE) modules/mattermost-adapter/service/src/cli.mjs

iam-adapter-test: ## Kør IAM-adapterens (keycloak) tests
	cd modules/keycloak-adapter/service && $(NODE) --test

iam-adapter-evidence: ## Generér IAM-adapterbevis mod mock Keycloak + rigtig PDP
	$(NODE) modules/keycloak-adapter/service/src/evidence.mjs

iam-adapter-run: ## Start keycloak-adapteren lokalt
	$(NODE) modules/keycloak-adapter/service/src/cli.mjs

gateway-test: ## Kør AI-gatewayens tests (routing, budget, idempotens, egress)
	cd gateway && $(NODE) --test

gateway-check: ## Validér serverstyrede routes, dataklasser og model-egress-allowliste (DKC-012)
	$(NODE) --no-warnings gateway/src/check.mjs

budget-test: ## Kør reservations-/idempotens-testene for modelgatewayens budget (DKC-012)
	cd persistence && $(NODE) --no-warnings --test test/model-gateway-budgets.test.mjs

model-egress-check: ## Kontrollér at direkte model-egress er blokeret i GitOps-materialet (DKC-012)
	$(NODE) --no-warnings gitops/src/cli.mjs egress

model-gateway-test: ## Kør DKC-012-accepttestene (gateway + konformans)
	cd gateway && $(NODE) --test
	cd $(CONF) && $(NODE) --test test/model-gateway-conformance.test.mjs

gateway-run: ## Start AI-gatewayen lokalt (echo; sæt MODEL_PROVIDER_BASE_URL for reel leverandør)
	$(NODE) gateway/src/cli.mjs

runtime-test: ## Kør agent-runtimens tests
	cd runtime && $(NODE) --test

boundary-test: ## Kør runtimegrænse- og klassifikationstestene (DKC-007)
	cd runtime && $(NODE) --test test/policy-boundary.test.mjs test/classification.test.mjs

runtime-demo: ## Kør en agent-task (kræver kørende PDP + gateway)
	$(NODE) runtime/src/cli.mjs --manifest modules/dummy-ok/agents/backup-agent.json --task contracts/examples/agent-task.example.json

agent-conformance-test: ## Kør de seks agent-konformanstests
	cd $(CONF) && $(NODE) --test test/agent-conformance.test.mjs

reviewer-test: ## Kør reviewer-agentens tests (inkl. effektmåling)
	cd reviewer && $(NODE) --test

reviewer-metrics: ## Kør effektmålings-dashboardet lokalt
	$(NODE) reviewer/src/metrics-cli.mjs

ci: validate lint test policy-test policy-verify gitops-test gitops-verify gitops-reconcile gitops-drift changelog-check audit-service-test adapter-test iam-adapter-test gateway-check gateway-test budget-test model-egress-check model-gateway-test runtime-test agent-conformance-test reviewer-test curriculum-test curriculum-check compliance-test compliance-check data-register-check data-register-test observability-test observability-check security-test security-check pitch-test pitch-check architecture-check architecture-test continuity-check continuity-test distribution-check distribution-test release-check release-test identity-test tenant-check tenant-test approval-check approval-test boundary-test persistence-check persistence-test audit-durability-check audit-durability-test credentials-check credentials-test agent-registry-check agent-registry-test tool-boundary-check tool-boundary-test jobs-check jobs-test conform-all oscal-evidence evidence-test conform-negative baseline-test ## Det fulde CI-løb lokalt

clean: ## Ryd genereret output
	rm -rf .conformance-out
