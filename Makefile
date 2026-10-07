SHELL := bash
NODE  := node
TOOLS := tools
PLAT  := platform
CONF  := $(PLAT)/conformance

.DEFAULT_GOAL := help

.PHONY: help assemble assemble-force assemble-check install validate lint \
	assembler-test security-test conformance-test test probes ci clean

help: ## Vis tilgængelige mål
	@echo "DkCompany workspace — kanonisk platform i $(PLAT)/"
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

assemble: ## Materialisér platform/ deterministisk fra 00-core og de 66 historiske overlays
	$(NODE) $(TOOLS)/assemble-platform.mjs --target $(PLAT)

assemble-force: ## Genskab platform/ (kræver at målet bærer denne staks PROVENANCE.json)
	$(NODE) $(TOOLS)/assemble-platform.mjs --target $(PLAT) --force

assemble-check: ## Verificér at platform/ er byte-identisk med en frisk deterministisk samling
	$(NODE) $(TOOLS)/assemble-platform.mjs --target $(PLAT) --check

install: ## Installér platformens testafhængigheder (npm ci)
	$(MAKE) -C $(PLAT) install

validate: assemble-check ## Validér samlingen og platformens kontrakter
	$(MAKE) -C $(PLAT) validate
	$(MAKE) -C $(PLAT) lint

lint: ## Lint platformens JSON- og tekstfiler
	$(MAKE) -C $(PLAT) lint

assembler-test: ## Kør assemblerens egne tests (inkl. negative sikkerhedstilfælde)
	$(NODE) --test $(TOOLS)/test/*.test.mjs

security-test: ## Kør de sikkerhedsfokuserede modultests (S1-fundene R1-R4)
	cd $(PLAT)/runtime && $(NODE) --test
	cd $(PLAT)/approvals && $(NODE) --test
	cd $(PLAT)/identity && $(NODE) --test
	cd $(PLAT)/data-protection && $(NODE) --test
	cd $(PLAT)/agent-registry && $(NODE) --no-warnings --test

conformance-test: ## Kør den samlede konformanssuite (platform/conformance)
	cd $(CONF) && $(NODE) --test

test: assembler-test security-test conformance-test ## Kør assembler-, sikkerheds- og konformanstests

probes: ## Kør 2026-10-06-reviewets lokale prober mod platform/ (PROBE_OUT=sti)
	$(NODE) 02-stabilization/reference/security-probes.mjs $(PLAT) $(if $(PROBE_OUT),$(PROBE_OUT),probe-results.json)

ci: assemble-check install validate test ## Fuld lokal validering (kræver netværk til npm ci)

clean: ## Fjern lokale probe- og testresultater (rører ikke platform/)
	rm -rf probe-results.json $(CONF)/node_modules $(PLAT)/.conformance-out
