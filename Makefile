SHELL := bash
NODE  := node
CONF  := conformance
CLI   := $(NODE) $(CONF)/src/cli.mjs

.DEFAULT_GOAL := help

.PHONY: help install validate lint test conform conform-all conform-negative dsar-demo telemetry-test policy-verify policy-test policy-decide gitops-verify gitops-test gitops-reconcile gitops-drift changelog changelog-check ci clean

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

ci: validate lint test policy-test policy-verify gitops-test gitops-verify gitops-reconcile gitops-drift changelog-check conform-all conform-negative ## Det fulde CI-løb lokalt

clean: ## Ryd genereret output
	rm -rf .conformance-out
