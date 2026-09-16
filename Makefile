SHELL := bash
NODE  := node
CONF  := conformance
CLI   := $(NODE) $(CONF)/src/cli.mjs

.DEFAULT_GOAL := help

.PHONY: help install validate lint test conform conform-all conform-negative dsar-demo telemetry-test policy-verify policy-test policy-decide gitops-verify gitops-test gitops-reconcile gitops-drift changelog changelog-check audit-service-test audit-service-evidence audit-service-run adapter-test adapter-evidence adapter-run gateway-test gateway-run runtime-test runtime-demo agent-conformance-test reviewer-test reviewer-metrics ci clean

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

ci: validate lint test policy-test policy-verify gitops-test gitops-verify gitops-reconcile gitops-drift changelog-check audit-service-test adapter-test gateway-test runtime-test agent-conformance-test reviewer-test conform-all conform-negative ## Det fulde CI-løb lokalt

clean: ## Ryd genereret output
	rm -rf .conformance-out
