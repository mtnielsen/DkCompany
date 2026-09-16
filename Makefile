SHELL := bash
NODE  := node
CONF  := conformance
CLI   := $(NODE) $(CONF)/src/cli.mjs

.DEFAULT_GOAL := help

.PHONY: help install validate lint test conform conform-all conform-negative dsar-demo telemetry-test policy-verify policy-test policy-decide gitops-verify gitops-test gitops-reconcile gitops-drift changelog changelog-check audit-service-test audit-service-evidence audit-service-run adapter-test adapter-evidence adapter-run iam-adapter-test iam-adapter-evidence iam-adapter-run gateway-test gateway-run runtime-test runtime-demo agent-conformance-test reviewer-test reviewer-metrics oscal-evidence evidence-test compliance-mapping compliance-check compliance-test observability-dashboards observability-check observability-test security-ingest security-check security-test curriculum-check curriculum-render curriculum-test ci clean

help: ## Vis denne hjælp
	@echo "Platformens kontrakter — tilgængelige mål:"
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

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

gateway-test: ## Kør AI-gatewayens tests
	cd gateway && $(NODE) --test

gateway-run: ## Start AI-gatewayen lokalt (echo-leverandør)
	$(NODE) gateway/src/cli.mjs

runtime-test: ## Kør agent-runtimens tests
	cd runtime && $(NODE) --test

runtime-demo: ## Kør en agent-task (kræver kørende PDP + gateway)
	$(NODE) runtime/src/cli.mjs --manifest modules/dummy-ok/agents/backup-agent.json --task contracts/examples/agent-task.example.json

agent-conformance-test: ## Kør de seks agent-konformanstests
	cd $(CONF) && $(NODE) --test test/agent-conformance.test.mjs

reviewer-test: ## Kør reviewer-agentens tests (inkl. effektmåling)
	cd reviewer && $(NODE) --test

reviewer-metrics: ## Kør effektmålings-dashboardet lokalt
	$(NODE) reviewer/src/metrics-cli.mjs

ci: validate lint test policy-test policy-verify gitops-test gitops-verify gitops-reconcile gitops-drift changelog-check audit-service-test adapter-test iam-adapter-test gateway-test runtime-test agent-conformance-test reviewer-test curriculum-test curriculum-check compliance-test compliance-check observability-test observability-check security-test security-check conform-all oscal-evidence evidence-test conform-negative ## Det fulde CI-løb lokalt

clean: ## Ryd genereret output
	rm -rf .conformance-out
