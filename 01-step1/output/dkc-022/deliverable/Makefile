SHELL := bash
NODE  := node
CONF  := conformance
CLI   := $(NODE) $(CONF)/src/cli.mjs

.DEFAULT_GOAL := help

.PHONY: help continuity-check continuity-test continuity-report backup-check backup-test backup-drill backup-target-check backup-target-test backup-target-preflight backup-target-canary dr-check dr-test dr-write dr-drill distribution-check distribution-test distribution-preview release-check release-test release-write release-gate release supply-chain-sbom supply-chain-check supply-chain-test supply-chain-vuln-check supply-chain-scan supply-chain-verify supply-chain-sign supply-chain-containers-check supply-chain-containers-plan supply-chain-containers-build infrastructure-render infrastructure-check infrastructure-test infrastructure-verify infrastructure-iac-check infrastructure-cost infrastructure-drift install validate lint test conform conform-all conform-negative dsar-demo telemetry-test policy-verify policy-test policy-decide gitops-verify gitops-test gitops-reconcile gitops-drift changelog changelog-check audit-service-test audit-service-evidence audit-service-run adapter-test adapter-evidence adapter-run iam-adapter-test iam-adapter-evidence iam-adapter-run gateway-test gateway-check gateway-run budget-test model-egress-check model-gateway-test runtime-test boundary-test runtime-demo agent-conformance-test reviewer-test reviewer-metrics oscal-evidence evidence-test compliance-mapping compliance-check compliance-test data-register-write data-register-check data-register-test assurance-write assurance-check assurance-test assurance-export assurance-drill data-protection-write data-protection-check data-protection-test data-services-write data-services-check data-services-test observability-dashboards observability-check observability-test monitoring-check monitoring-test monitoring-posture monitoring-drill telemetry-api-check telemetry-api-test telemetry-api-demo telemetry-api-serve feature-access-check feature-access-test feature-access-demo ha-render ha-check ha-test ha-drill security-ingest security-check security-test curriculum-check curriculum-render curriculum-test pitch-check pitch-test baseline baseline-render baseline-test architecture-check architecture-test identity-test tenant-check tenant-test approval-check approval-test approval-run persistence-check persistence-test db-ha-render db-ha-check db-ha-test db-ha-drill storage-render storage-check storage-test storage-drill dedup-write dedup-check dedup-test dedup-drill immutable-render immutable-check immutable-test retention-write retention-check retention-test retention-demo logging-write logging-check logging-test logging-demo audit-durability-check audit-durability-test agent-registry-check agent-registry-test credentials-check credentials-test tool-boundary-check tool-boundary-test jobs-check jobs-test messaging-check messaging-test evidence-mode-check evidence-mode-test evidence-probe vulnerability-write vulnerability-check vulnerability-test vulnerability-scan adapter-sdk-write adapter-sdk-check adapter-sdk-test adapter-sdk-report adapter-live-write adapter-live-check adapter-live-test adapter-live-plan adapter-live-run privacy-check privacy-test privacy-run ci clean

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

backup-check: ## Validér backup-manifest og gendannelsesrapport (skema + semantik) (DKC-016)
	$(NODE) --no-warnings backup/src/check.mjs

backup-test: ## Kør DKC-016-testene: kryptering, isoleret restore, suppression og RPO/RTO
	cd backup && $(NODE) --no-warnings --test test/crypto.test.mjs test/suppression.test.mjs test/vault.test.mjs test/restore.test.mjs test/drill.test.mjs test/authz.test.mjs
	cd $(CONF) && $(NODE) --test test/backup-conformance.test.mjs

backup-drill: ## Kør en rigtig krypteret backup + isoleret gendannelsesøvelse (DKC-016)
	$(NODE) --no-warnings backup/src/cli.mjs drill

backup-target-check: ## Validér eksterne backupmål og målsæt (skema + semantik) (DKC-057)
	$(NODE) --no-warnings backup/src/target-check.mjs

backup-target-test: ## Kør DKC-057-testene: S3-backend, preflight, canary, synk og målskift
	cd backup && $(NODE) --no-warnings --test test/s3-backend.test.mjs test/targets.test.mjs test/target-switch.test.mjs
	cd $(CONF) && $(NODE) --test test/backup-target-conformance.test.mjs

backup-target-preflight: ## Kør read-only preflight mod det lokale backupmål (DKC-057)
	@root=$$(mktemp -d); DKC_BACKUP_LOCAL_ROOT=$$root $(NODE) --no-warnings backup/src/cli.mjs preflight backup/targets/local-filesystem.json; rm -rf $$root

backup-target-canary: ## Kør canary backup/restore mod det lokale backupmål (DKC-057)
	@root=$$(mktemp -d); DKC_BACKUP_LOCAL_ROOT=$$root $(NODE) --no-warnings backup/src/cli.mjs canary backup/targets/local-filesystem.json; rm -rf $$root

dr-write: ## Genskab docs/continuity/dr-plan.md fra den kanoniske DR-plan (DKC-042)
	$(NODE) --no-warnings backup/src/dr/cli.mjs write

dr-check: ## Validér DR-plan, recovery-adgang, PITR og øvelse (skema + semantik) (DKC-042)
	$(NODE) --no-warnings backup/src/dr/check.mjs

dr-test: ## Kør DKC-042-testene: 3-2-1-1-0, PITR/ACL, recovery-adgang og isoleret DR-øvelse
	cd backup && $(NODE) --no-warnings --test test/dr-plan.test.mjs test/dr-pitr.test.mjs test/dr-access.test.mjs test/dr-drill.test.mjs
	cd $(CONF) && $(NODE) --test test/disaster-recovery-conformance.test.mjs

dr-drill: ## Kør en rigtig PITR + isoleret katastrofegendannelsesøvelse (DKC-042)
	$(NODE) --no-warnings backup/src/dr/cli.mjs drill

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

evidence-mode-check: ## Validér evidensposter (mode/commit/image/miljø/upstream/udløb/digest) og probemanifest (DKC-018)
	$(NODE) --no-warnings conformance/src/evidence-mode-check.mjs

evidence-mode-test: ## Kør evidensmode- og probe-testene (fixture-only, udløb, tampering, PDP-nedbrud, direkte endpoints) (DKC-018)
	cd $(CONF) && $(NODE) --test test/evidence-mode.test.mjs
	cd evidence && $(NODE) --test test/probes.test.mjs

evidence-probe: ## Kør integration/runtime-prober mod levende endpoints (kræver DKC_PROBE_*-binding; ellers NOT RUN) (DKC-018)
	$(NODE) --no-warnings evidence/src/probe-cli.mjs run

vulnerability-write: ## Genskab vulnerability-management/inventory.json og statusdokumentet (DKC-064)
	$(NODE) --no-warnings vulnerability-management/src/cli.mjs write

vulnerability-check: ## Validér sårbarhedsbeholdning: dedup, prioritet, livscyklus, dækning og inventar (DKC-064)
	$(NODE) --no-warnings vulnerability-management/src/check.mjs

vulnerability-test: ## Kør sårbarhedslivscyklus- og scannerfixture-testene (DKC-064)
	cd vulnerability-management && $(NODE) --no-warnings --test
	cd $(CONF) && $(NODE) --test test/vulnerability-conformance.test.mjs

vulnerability-scan: ## Kør de rigtige scannere (kræver binærer/CI; ellers NOT RUN) (DKC-064)
	$(NODE) --no-warnings vulnerability-management/src/cli.mjs scan

adapter-sdk-write: ## Genskab releaseprofiler pr. upstream-version/edition og statusdokument (DKC-023)
	$(NODE) --no-warnings adapter-sdk/src/cli.mjs write

adapter-sdk-check: ## Validér kandidatrapporter/releaseprofiler og at de er i trit (DKC-023)
	$(NODE) --no-warnings adapter-sdk/src/cli.mjs check

adapter-sdk-test: ## Kør adapter-SDK'ens og godkendelsesharnessens tests (DKC-023)
	cd adapter-sdk && $(NODE) --no-warnings --test
	cd $(CONF) && $(NODE) --test test/adapter-sdk-conformance.test.mjs
	cd modules/mattermost-adapter/service && $(NODE) --test test/sdk-harness.test.mjs

adapter-sdk-report: ## Vis kandidatrapport pr. adapter (DKC-023)
	$(NODE) --no-warnings adapter-sdk/src/cli.mjs report

adapter-live-write: ## Genskab opgraderings-/rollbackplaner og statusdokument (DKC-024)
	$(NODE) --no-warnings adapter-sdk/src/live-cli.mjs write

adapter-live-check: ## Validér live-mål, pinning og opgraderings-/rollbackplaner (DKC-024)
	$(NODE) --no-warnings adapter-sdk/src/live-cli.mjs check

adapter-live-test: ## Kør live-kørerens, demo-værnets og opgraderingsplanens tests (DKC-024)
	cd adapter-sdk && $(NODE) --no-warnings --test test/live.test.mjs test/upgrade.test.mjs test/demo-guard.test.mjs
	cd $(CONF) && $(NODE) --test test/adapter-live-conformance.test.mjs

adapter-live-plan: ## Vis opgraderings- og rollbackplanerne (DKC-024)
	$(NODE) --no-warnings adapter-sdk/src/live-cli.mjs plan

adapter-live-run: ## Kør live-prøver mod rigtige instanser (kræver DKC_LIVE_*-binding; ellers NOT RUN) (DKC-024)
	$(NODE) --no-warnings adapter-sdk/src/live-cli.mjs run

privacy-check: ## Validér privacy-eksportkontrakten og den fail-closed identitetsmatchning (DKC-020)
	$(NODE) --no-warnings privacy/src/check.mjs

privacy-test: ## Kør den holdbare DSAR-sag, sikre eksport og to-app fan-out (DKC-020)
	cd privacy && $(NODE) --no-warnings --test
	cd $(CONF) && $(NODE) --test test/privacy-conformance.test.mjs

privacy-run: ## Demonstrér DSAR-processen offline: sag, per-modul status og eksport (DKC-020)
	$(NODE) --no-warnings privacy/src/cli.mjs demo

release: baseline release-gate ## Kør baseline og bagefter release-gaten (DKC-063)

supply-chain-sbom: ## Generér deterministisk SBOM, artefaktmanifest og statusdokument (DKC-014)
	$(NODE) --no-warnings supply-chain/src/cli.mjs render

supply-chain-check: ## Validér SBOM, artefaktmanifest, Dockerfiles og branch protection (DKC-014)
	$(NODE) --no-warnings supply-chain/src/cli.mjs check

supply-chain-test: ## Kør forsyningskædens tests (SBOM, digest, signatur, containere, beskyttelse) (DKC-014)
	cd supply-chain && $(NODE) --no-warnings --test

supply-chain-vuln-check: ## Evaluer cachet OSV-scanning mod sårbarhedspolitikken (DKC-014)
	$(NODE) --no-warnings supply-chain/src/cli.mjs vuln-check

supply-chain-scan: ## Hent levende OSV-advisories for de låste npm-versioner (netværk) (DKC-014)
	$(NODE) --no-warnings supply-chain/src/cli.mjs scan

supply-chain-verify: ## Afvis pladsholder- og usignerede deployment-digests før GitOps (DKC-014)
	$(NODE) --no-warnings supply-chain/src/cli.mjs verify

supply-chain-sign: ## Signér byggede artefakter med DKC_RELEASE_SIGNING_KEY (NOT RUN uden nøgle) (DKC-014)
	$(NODE) --no-warnings supply-chain/src/cli.mjs sign

supply-chain-containers-check: ## Kontrollér Dockerfiles og pinnede base-digests (DKC-014)
	$(NODE) --no-warnings supply-chain/src/cli.mjs containers check

supply-chain-containers-plan: ## Vis docker buildx-kommandoerne for kontroltjenesterne (DKC-014)
	$(NODE) --no-warnings supply-chain/src/cli.mjs containers plan

supply-chain-containers-build: ## Byg containere (kræver Docker; ellers NOT RUN) (DKC-014)
	$(NODE) --no-warnings supply-chain/src/cli.mjs containers build

infrastructure-render: ## Generér GitOps-manifester, Argo CD-apps og omkostning fra infrastrukturplanen (DKC-015)
	$(NODE) --no-warnings infrastructure/src/cli.mjs render

infrastructure-check: ## Validér infrastrukturplan, IaC, miljøadskillelse, netværk, secrets og omkostning (DKC-015)
	$(NODE) --no-warnings infrastructure/src/cli.mjs check

infrastructure-test: ## Kør infrastrukturmodulets tests (plan, rendering, netværk, secrets, break-glass, drift) (DKC-015)
	cd infrastructure && $(NODE) --no-warnings --test

infrastructure-verify: ## Kør GitOps-gates for dev/staging/prod og bevis miljøadskillelse (DKC-015)
	$(NODE) --no-warnings infrastructure/src/cli.mjs verify

infrastructure-iac-check: ## Statisk kontrol af OpenTofu-modulet: pinnede providere, firewall, kryptering (DKC-015)
	$(NODE) --no-warnings infrastructure/src/cli.mjs iac-check

ha-render: ## Skriv HA-manifester fra HA-planen (DKC-038)
	$(NODE) --no-warnings infrastructure/src/ha-cli.mjs render

ha-check: ## Validér HA-plan, semantik, rendering, netværk og serviceklasser (DKC-038)
	$(NODE) --no-warnings infrastructure/src/ha-cli.mjs check

ha-test: ## Kør HA-testene: quorum, N+1, ingress/DNS, mTLS, workloads og konformans (DKC-038)
	cd infrastructure && $(NODE) --no-warnings --test test/ha.test.mjs
	cd $(CONF) && $(NODE) --test test/ha-conformance.test.mjs

ha-drill: ## Simulér frivillig drain og hårdt servernedbrud separat (DKC-038)
	$(NODE) --no-warnings infrastructure/src/ha-cli.mjs drill

infrastructure-cost: ## Registrér stagingomkostningen fra planen (DKC-015)
	$(NODE) --no-warnings infrastructure/src/cli.mjs render

infrastructure-drift: ## Mål rigtig drift mod staging (kræver kubectl + kubeconfig; ellers NOT RUN) (DKC-015)
	$(NODE) --no-warnings infrastructure/src/cli.mjs drift --env staging

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

db-ha-render: ## Skriv database-HA-manifester fra planen (DKC-039)
	$(NODE) --no-warnings persistence/src/ha-cli.mjs render

db-ha-check: ## Validér database-HA-plan, semantik, manifester, databaseprofil og serviceklasser (DKC-039)
	$(NODE) --no-warnings persistence/src/ha-cli.mjs check

db-ha-test: ## Kør DKC-039-testene: replikering, receipts, fencing, partition, rejoin og konformans (DKC-039)
	cd persistence && $(NODE) --no-warnings --test test/ha.test.mjs
	cd $(CONF) && $(NODE) --test test/database-ha-conformance.test.mjs

db-ha-drill: ## Kør en deterministisk database-failover med commitkvitteringer (DKC-039)
	$(NODE) --no-warnings persistence/src/ha-cli.mjs drill

storage-render: ## Skriv lager-manifester fra planen (DKC-041)
	$(NODE) --no-warnings storage/src/cli.mjs render

storage-check: ## Validér lagerplan, semantik, manifester, serviceklasser og HA-plan (DKC-041)
	$(NODE) --no-warnings storage/src/cli.mjs check

storage-test: ## Kør DKC-041-testene: objektlager, checksums, scrub/repair, quorum, cache, indeks og konformans (DKC-041)
	cd storage && $(NODE) --no-warnings --test
	cd $(CONF) && $(NODE) --test test/storage-conformance.test.mjs

storage-drill: ## Kør en deterministisk lager-holdbarhedsøvelse (DKC-041)
	$(NODE) --no-warnings storage/src/cli.mjs drill

dedup-write: ## Skriv dedup-planen fra politikken (DKC-043)
	$(NODE) --no-warnings dedup/src/cli.mjs write

dedup-check: ## Validér dedup-politik, semantik, providers og dokumentsync (DKC-043)
	$(NODE) --no-warnings dedup/src/check.mjs

dedup-test: ## Kør DKC-043-testene: chunking, referencekæde, crash-recovery, GC-lease, korrupt chunk og konformans (DKC-043)
	cd dedup && $(NODE) --no-warnings --test
	cd $(CONF) && $(NODE) --test test/dedup-conformance.test.mjs

dedup-drill: ## Kør en rigtig backup → dedup → mål → fuld restore (DKC-043)
	$(NODE) --no-warnings dedup/src/cli.mjs drill

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

messaging-check: ## Validér beskedtopologi, outbox-/inbox-kontrakt og rækkefølgepolitik (DKC-040)
	$(NODE) --no-warnings jobs/src/messaging-cli.mjs check

messaging-test: ## Kør DKC-040-testene: outbox/inbox, dedup, rækkefølge, fencing, backpressure og poison (DKC-040)
	cd jobs && $(NODE) --no-warnings --test test/messaging.test.mjs
	cd $(CONF) && $(NODE) --test test/messaging-conformance.test.mjs

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

assurance-write: ## Skriv docs/compliance/assurance.md fra evidens- og risikoregisteret (DKC-022)
	$(NODE) --no-warnings compliance/src/assurance-cli.mjs write

assurance-check: ## Validér evidens-/risikoregister, DPIA/anvendelighed/incident/exit og dokumentsync (DKC-022)
	$(NODE) --no-warnings compliance/src/assurance-cli.mjs check

assurance-test: ## Kør DKC-022-testene: register, evidenspakke, friskhed/artefakt-binding, acceptautorisation og journal (DKC-022)
	cd compliance && $(NODE) --no-warnings --test test/assurance.test.mjs test/assurance-service.test.mjs
	cd $(CONF) && $(NODE) --test test/assurance-conformance.test.mjs

assurance-export: ## Saml evidenspakken fra evidence/records og skriv evidence/generated/assurance-package.json (DKC-022)
	$(NODE) --no-warnings compliance/src/assurance-cli.mjs export

assurance-drill: ## Kør en deterministisk brudøvelse med dokumenteret anmeldelsesbeslutning (DKC-022)
	$(NODE) --no-warnings compliance/src/assurance-cli.mjs drill

data-protection-write: ## Genskab docs/compliance/protected-data.md fra beskyttelsesregisteret (DKC-047)
	$(NODE) data-protection/src/cli.mjs write

data-protection-check: ## Validér beskyttede dataklasser, forbud og modul-dækning (DKC-047)
	$(NODE) data-protection/src/check.mjs
	$(NODE) data-protection/src/cli.mjs check

data-protection-test: ## Kør guard-, transition-, register- og runtimebeskyttelsestestene (DKC-047)
	cd data-protection && $(NODE) --test
	cd runtime && $(NODE) --test test/protected-data-runtime.test.mjs
	cd $(CONF) && $(NODE) --test test/protected-data-conformance.test.mjs

immutable-render: ## Skriv håndhævelsesmanifester fra den immutable politik (DKC-048)
	$(NODE) data-protection/src/enforcement-cli.mjs render

immutable-check: ## Validér object-lock, rollematrix, manifester, register og lagersemantik (DKC-048)
	$(NODE) data-protection/src/enforcement-cli.mjs check

immutable-test: ## Kør WORM-, enforcement-, nøgle-, backup- og semantiktestene (DKC-048)
	cd data-protection && $(NODE) --test
	cd $(CONF) && $(NODE) --test test/immutable-enforcement-conformance.test.mjs

retention-write: ## Genskab docs/compliance/deletion-coverage.md fra slettepolitikken (DKC-021)
	$(NODE) --no-warnings retention/src/cli.mjs write

retention-check: ## Validér slettepolitik, dækning, hold-blokering og genanvendelse ved restore (DKC-021)
	$(NODE) --no-warnings retention/src/check.mjs

retention-test: ## Kør slette-, hold-, kvitterings-, restoregate- og persistens-testene (DKC-021)
	cd retention && $(NODE) --test
	cd persistence && $(NODE) --no-warnings --test test/retention.test.mjs
	cd $(CONF) && $(NODE) --test test/retention-conformance.test.mjs

retention-demo: ## Kør et fuldt sletteforløb på den rigtige stak (DKC-021)
	$(NODE) --no-warnings retention/src/cli.mjs demo

logging-write: ## Genskab docs/compliance/log-coverage.md fra loggepolitikken (DKC-049)
	$(NODE) --no-warnings logging/src/cli.mjs write

logging-check: ## Validér loggepolitik, korrelation, provenance, WORM-arkiv og default-deny adgang (DKC-049)
	$(NODE) --no-warnings logging/src/check.mjs

logging-test: ## Kør log-, ledger-, arkiv-, kvitterings-, adgangs- og rekonstruktionstestene (DKC-049)
	cd logging && $(NODE) --test
	cd $(CONF) && $(NODE) --test test/logging-conformance.test.mjs

logging-demo: ## Kør et fuldt tværserverforløb på den rigtige stak (DKC-049)
	$(NODE) --no-warnings logging/src/cli.mjs demo

data-services-write: ## Genskab docs/compliance/data-services.md og .html fra registry (DKC-056)
	$(NODE) data-services/src/cli.mjs write

data-services-check: ## Validér databaseprofiler, datakilder, bindinger og scope (DKC-056)
	$(NODE) data-services/src/check.mjs
	$(NODE) data-services/src/cli.mjs check

data-services-test: ## Kør driver-, connector-, migrations-, recovery-, registry- og persistens-testene (DKC-056)
	cd data-services && $(NODE) --no-warnings --test
	cd persistence && $(NODE) --no-warnings --test test/data-services.test.mjs
	cd $(CONF) && $(NODE) --test test/data-services-conformance.test.mjs

observability-dashboards: ## Genskab Prometheus-regler og Grafana-dashboards fra modulets SLO
	$(NODE) observability/src/cli.mjs write

observability-check: ## Fejl hvis dashboards/regler er ude af trit med modulets SLO
	$(NODE) observability/src/cli.mjs check

observability-test: ## Kør observability-generatorens tests
	cd observability && $(NODE) --test

monitoring-check: ## Validér sensorkatalog, alarmregler og deres ejerskab/runbooks (DKC-017)
	$(NODE) --no-warnings observability/src/check.mjs

monitoring-test: ## Kør DKC-017-testene: telemetri, tenantadgang, friskhed, alarmer og konformans
	cd observability && $(NODE) --no-warnings --test test/telemetry.test.mjs test/sensors.test.mjs test/alerts.test.mjs
	cd $(CONF) && $(NODE) --test test/monitoring-conformance.test.mjs

monitoring-posture: ## Byg sikkerhedsstatussen fra sensorkataloget (DKC-017)
	$(NODE) --no-warnings observability/src/monitoring-cli.mjs posture

monitoring-drill: ## Fremkald tjenestefejl, backupfejl og forældet sensor og lever alarmer til testmodtageren (DKC-017)
	$(NODE) --no-warnings observability/src/monitoring-cli.mjs drill

telemetry-api-check: ## Validér collectorkatalog og DKC-066-kontrakteksempler (skema + semantik)
	$(NODE) --no-warnings telemetry-api/src/cli.mjs check

telemetry-api-test: ## Kør DKC-066-testene: ressource-ID'er, envelope, lager, indtagning, authz, views, query, adaptere, collectors, server og konformans
	cd telemetry-api && $(NODE) --no-warnings --test
	cd $(CONF) && $(NODE) --test test/telemetry-api-conformance.test.mjs

telemetry-api-demo: ## Kør et kontrolleret staging-fejlforløb gennem API, views og adaptere (DKC-066)
	$(NODE) --no-warnings telemetry-api/src/cli.mjs demo

telemetry-api-serve: ## Start telemetri-API'et (kræver DKC_TELEMETRY_JWKS; ellers NOT RUN) (DKC-066)
	$(NODE) --no-warnings telemetry-api/src/cli.mjs serve

feature-access-check: ## Validér funktionsprofiler og DKC-060-kontrakteksempler (skema + semantik) (DKC-060)
	$(NODE) --no-warnings feature-access/src/check.mjs

feature-access-test: ## Kør DKC-060-testene: profiler, adgang, flader, gæster, servicekonti, offboarding, rapportering, connector-guard og konformans
	cd feature-access && $(NODE) --no-warnings --test
	cd $(CONF) && $(NODE) --test test/feature-access-conformance.test.mjs

feature-access-demo: ## Kør et kontrolleret DKC-060-forløb: BI vs. HR, rapportering, offboarding og connector
	$(NODE) --no-warnings feature-access/src/cli.mjs demo

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

ci: validate lint test policy-test policy-verify gitops-test gitops-verify gitops-reconcile gitops-drift changelog-check audit-service-test adapter-test iam-adapter-test gateway-check gateway-test budget-test model-egress-check model-gateway-test runtime-test agent-conformance-test reviewer-test curriculum-test curriculum-check compliance-test compliance-check data-register-check data-register-test assurance-check assurance-test assurance-drill data-protection-check data-protection-test data-services-check data-services-test observability-test observability-check monitoring-check monitoring-test telemetry-api-check telemetry-api-test feature-access-check feature-access-test security-test security-check pitch-test pitch-check architecture-check architecture-test continuity-check continuity-test backup-check backup-test backup-target-check backup-target-test dr-check dr-test distribution-check distribution-test release-check release-test identity-test tenant-check tenant-test approval-check approval-test boundary-test persistence-check persistence-test db-ha-check db-ha-test storage-check storage-test dedup-check dedup-test immutable-check immutable-test retention-check retention-test logging-check logging-test audit-durability-check audit-durability-test credentials-check credentials-test agent-registry-check agent-registry-test tool-boundary-check tool-boundary-test jobs-check jobs-test messaging-check messaging-test evidence-mode-check evidence-mode-test vulnerability-check vulnerability-test adapter-sdk-check adapter-sdk-test adapter-live-check adapter-live-test privacy-check privacy-test conform-all oscal-evidence evidence-test conform-negative baseline-test supply-chain-check supply-chain-test supply-chain-vuln-check infrastructure-check infrastructure-test infrastructure-verify infrastructure-iac-check ha-check ha-test ## Det fulde CI-løb lokalt

clean: ## Ryd genereret output
	rm -rf .conformance-out
