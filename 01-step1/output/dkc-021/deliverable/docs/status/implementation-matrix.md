# Implementation matrix — faktisk modenhed pr. komponent

> Genereret af `tools/baseline/baseline.mjs` fra en konkret kørsel. Denne fil erstatter ikke de historiske bølger i [BACKLOG.md](../../BACKLOG.md); den supplerer dem med, hvad der faktisk kan efterprøves i en ren checkout.

**Genereret:** 2026-09-24T09:04:04.155Z · **Commit:** `83ad91a` · **Node:** v22.22.1 · **CI:** nej

**Resultat:** FAIL — 118 pass, 1 fail, 33 not run, 0 error (152 checks).

## Sådan læses niveauerne

| Niveau | Betydning |
| --- | --- |
| Real (`real`) | Førsteparts implementering, deterministisk efterprøvet |
| Mock (`mock`) | Efterprøvet mod test-dobbelt for eksternt system |
| Fixture (`fixture`) | Sample- eller negativdata, ikke drift |
| Contract (`contract`) | Kontrakt-/skemavalidering |
| Integration (`integration`) | Kræver levende eksternt system — ikke kørt her |

Et niveau beskriver **hvad beviset dækker**, ikke hvor vigtigt komponenten er. En `mock`-check er en ægte test af førstepartskoden, men den siger intet om en rigtig ekstern installation. `NOT RUN` er ikke det samme som PASS.

## Miljø

| Felt | Værdi |
| --- | --- |
| Commit | `83ad91a963d8055f77c29fb4361455689df95acb` (HEAD) |
| Dirty worktree | ja (462 filer) |
| Node / npm | v22.22.1 / 9.2.0 |
| Platform | linux x64 (6.18.33.2-microsoft-standard-WSL2) |
| CI | nej |
| Evidens | `/tmp/dkc-work/00-core/.conformance-out/baseline/runs/2026-09-24T09-04-04-155Z-83ad91a.json` |

## Reproducerbarhed

Kørslen ændrede **30 sporede fil(er)**. Det betyder, at en ren checkout ikke forbliver ren, og at nogle bevisgeneratorer skriver ikke-deterministiske data ind i committede fixtures.

| Ændret fil |
| --- |
| `M 00-core/modules/audit-service/conformance/events/agent-action.json` |
| `M 00-core/modules/audit-service/conformance/events/human-action.json` |
| `M 00-core/modules/audit-service/conformance/evidence/backup.json` |
| `M 00-core/modules/audit-service/conformance/evidence/drain.json` |
| `M 00-core/modules/audit-service/conformance/evidence/health.json` |
| `M 00-core/modules/audit-service/conformance/evidence/migrate.json` |
| `M 00-core/modules/audit-service/conformance/evidence/policy-decision.json` |
| `M 00-core/modules/audit-service/conformance/evidence/restore.json` |
| `M 00-core/modules/audit-service/conformance/evidence/retention.policy.json` |
| `M 00-core/modules/audit-service/conformance/evidence/rollback.json` |
| `M 00-core/modules/audit-service/conformance/evidence/slo.json` |
| `M 00-core/modules/audit-service/conformance/evidence/subject.erase.json` |
| `M 00-core/modules/audit-service/conformance/evidence/subject.export.json` |
| `M 00-core/modules/audit-service/conformance/evidence/subject.legal_hold.json` |
| `M 00-core/modules/audit-service/conformance/evidence/subject.locate.json` |
| `M 00-core/modules/audit-service/conformance/evidence/upgrade.dry-run.json` |
| `M 00-core/modules/audit-service/conformance/evidence/upgrade.json` |
| `M 00-core/modules/audit-service/conformance/evidence/verify-restore.json` |
| `M 00-core/modules/keycloak-adapter/conformance/events/agent-action.json` |
| `M 00-core/modules/keycloak-adapter/conformance/events/human-action.json` |
| `M 00-core/modules/keycloak-adapter/conformance/evidence/health.json` |
| `M 00-core/modules/keycloak-adapter/conformance/evidence/policy-decision.json` |
| `M 00-core/modules/keycloak-adapter/conformance/evidence/subject.export.json` |
| `M 00-core/modules/keycloak-adapter/conformance/evidence/subject.locate.json` |
| `M 00-core/modules/mattermost-adapter/conformance/events/agent-action.json` |
| `M 00-core/modules/mattermost-adapter/conformance/events/human-action.json` |
| `M 00-core/modules/mattermost-adapter/conformance/evidence/health.json` |
| `M 00-core/modules/mattermost-adapter/conformance/evidence/policy-decision.json` |
| `M 00-core/modules/mattermost-adapter/conformance/evidence/subject.export.json` |
| `M 00-core/modules/mattermost-adapter/conformance/evidence/subject.locate.json` |

## Fejl (skal udbedres)

Disse checks fejlede i denne kørsel. De er **ikke** deaktiveret for at opnå grøn status.

| Check | Kommando | Exit | Evidenslog |
| --- | --- | --- | --- |
| Fejl hvis commits mangler DCO sign-off | `make changelog-check` | 2 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/changelog-check.log` |

## NOT RUN (kræver eksternt system, værktøj eller er langtkørende)

Disse checks er **ikke** kørt, og deres manglende bevis indgår ikke som PASS.

| Check | Kommando | Grund |
| --- | --- | --- |
| Produktionsgendannelse ved tab af primær database (rigtig klynge) | `make backup-drill` | Ingen produktionsklynge eller ekstern PostgreSQL i dette miljø. Øvelsen er kørt rigtigt mod den lokale SQLite-persistens; en produktionsøvelse med tab af den primære database kræver ekstern infrastruktur og et navngivet menneskes godkendelse. |
| Rigtigt S3/MinIO-objektlager som eksternt backupmål | `make backup-target-canary` | Ingen rigtig S3/MinIO-instans i dette miljø. SigV4-klienten og preflight/canary efterprøves mod en protokolfast test-dobbelt; en rigtig instans kræver ekstern infrastruktur og credentials. |
| Målt failover på en rigtig PostgreSQL/operator | `true` | Der findes ingen levende PostgreSQL-installation, operator eller klynge i dette miljø. Sync-quorum, commitkvitteringer, fencing, partition, rejoin og schemaopgradering er efterprøvet deterministisk mod den rigtige SQLite-persistens; en målt failover og en faktisk WAL-arkivering er NOT RUN. |
| Målt fejlmodel på et levende CSI-/objektlager (host-/diskfejl og rebalance) | `true` | Der findes ingen levende CSI-driver (Longhorn) eller S3-kompatibelt objektlager (MinIO) i dette miljø. Replikering, versionsstyrede checksums, scrub/repair, quorum, tenantnøgler, cache/indeks og relokation er efterprøvet deterministisk over et rigtigt filsystem; en målt host-/diskfejl og en faktisk rebalance under produktion er NOT RUN. |
| Rigtig broker med publisher confirms og consumer-acks | `true` | Der findes ingen kørende NATS/AMQP/Kafka-broker i dette miljø. Outbox, inbox, dedup, rækkefølge, fencing og backpressure er efterprøvet mod den rigtige SQLite-persistens; en faktisk brokerbekræftelse og målt leverance er NOT RUN. |
| Reviewer-effektmålings-dashboard (langtkørende server) | `make reviewer-metrics` | Starter en HTTP-server på 127.0.0.1:8484 og terminerer ikke; det er ikke en afsluttende check. Effektmålingen er dækket af reviewer-test. |
| Målt WORM-verifikation på et levende S3-/objektlager | `true` | Der findes ingen levende S3-/objektlager-instans i dette miljø. Object-lock i GOVERNANCE/COMPLIANCE, afvisning af sletning, retention og versionsskjul er efterprøvet deterministisk mod den rigtige fillager-model; en målt verifikation på et rigtigt storage-produkt kræver uafhængig driftsverifikation. |
| Målt sletning mod levende upstream-API'er og et rigtigt objektlager | `make retention-demo` | Der findes ingen levende modelleverandør med slette-API og intet rigtigt objektlager i dette miljø. Sletning, hold-blokering, suppressionsjournal og restoregate er efterprøvet deterministisk på den rigtige fillager-model; en målt sletning hos en ekstern leverandør er NOT RUN. |
| Rigtige metrics-, log- og trace-backends (Prometheus/Loki/OTel) | `promtool check rules observability/` | Der findes ingen kørende Prometheus/Loki/OTel-collector i dette miljø. Indsamling og minimering er efterprøvet lokalt; den rigtige backend er NOT RUN. |
| Rigtig alarmkanal (pager/webhook) hos en rigtig modtager | `true` | Der er ingen pager- eller webhook-konto i dette miljø. Den lokale testmodtager er en rigtig fil-bakket modtager, men en rigtig kanal er NOT RUN. |
| Rigtig OTel-/Prometheus-backend til telemetri-API'et | `true` | Der findes ingen kørende OTel-collector/Prometheus i dette miljø. Indtagning, scope og views er efterprøvet lokalt; den rigtige backend er NOT RUN. |
| Rigtig Grafana/Loki-instans provisioneret gennem en adapter | `true` | Der er ingen rigtig Grafana/Loki-instans i dette miljø. Adapterkontrakten og udskifteligheden er efterprøvet lokalt mod det samme view; en rigtig instans er NOT RUN. |
| Rigtig rapportmodtager/-destination (SMTP, filshare eller ekstern portal) | `true` | Der findes ingen rigtig SMTP-/filshare-/portalmodtager i dette miljø. Revalidering ved kørsel og afsendelse er efterprøvet lokalt; en rigtig leveringskanal er NOT RUN. |
| Rigtig IdP/sessionsudbyder ved offboarding | `true` | Der er ingen rigtig IdP eller tokenudbyder i dette miljø. De fem rettighedsklasser lukkes lokalt i et holdbart lager; en rigtig IdP-tilbagekaldelse er NOT RUN. |
| Rigtig failover-måling ved tab af én server | `true` | Der findes ingen levende HA-klynge eller servere i dette miljø. Quorum, N+1 og failover-adfærd er simuleret deterministisk; en målt overtagelse inden for servicemålet er NOT RUN. |
| Faktisk netværksplugin håndhæver tenantadskillelse | `true` | Der er ingen kørende Cilium/Calico-installation i dette miljø. Politikkerne er strukturelt valideret; faktisk afvisning af krydskunde-trafik er NOT RUN. |
| Trivy filesystem-scan (rigtigt værktøj) | `trivy fs --severity CRITICAL,HIGH .` | Trivy er ikke installeret i dette miljø; CI-workflowet er fjernet. Sample-data dækker kun normaliseringen. |
| Falco runtime-regler i en klynge | `falco -r security/falco/platform-rules.yaml` | Kræver en levende container-runtime/klynge. Reglerne er kun konfiguration i repoet. |
| Wazuh SIEM-regler i en klynge | `wazuh -t -r security/wazuh/local_rules.xml` | Kræver en levende SIEM-installation. Reglerne er kun konfiguration i repoet. |
| Rigtig Mattermost-installation | `make adapter-run` | Ingen MATTERMOST_URL/credentials i dette miljø. Kun mock-adfærd er bevist. |
| Rigtig Keycloak/Authentik-instans | `make iam-adapter-run` | Ingen IAM-instans i dette miljø. Kun mock-adfærd er bevist. |
| Live integration af Mattermost- og Keycloak-adapterne mod rigtige instanser (DKC-024) | `make adapter-live-run` | Ingen rigtige Mattermost-/Keycloak-instanser og ingen DKC_LIVE_*-bindinger/credentials i dette miljø. Live-køreren skriver not-run med begrundelse; et injiceret fetch-pass tæller ikke som driftsbevis. |
| DSAR på tværs af levende tredjepartsapps (DKC-020) | `make privacy-run` | Ingen levende tredjepartsapps/upstream i dette miljø. To-app fan-out er efterprøvet mod de rigtige adaptere med mock-upstream og i conformance-testen; DSAR mod rigtige apps og rigtige kundedata er NOT RUN. |
| Rigtig modelleverandør gennem AI-gateway | `make gateway-run` | Den reelle OpenAI-kompatible adapter findes og testes mod loopback-HTTP; ingen leverandørnøgle/-endpoint er konfigureret i dette miljø. |
| Rigtig OIDC-identitetsudbyder | `make runtime-demo` | Identitet er kontraktvalideret og simuleret; ingen rigtig IdP er koblet på. |
| Målt serviceniveau over tid (rigtige prober og fejltests) | `make continuity-report` | Ingen levende probe-/fejltest-infrastruktur i dette miljø. Målene er kontraktvalideret og et erklæret niveau er ikke et målt niveau. |
| Rigtig PostgreSQL-instans | `make data-services-test` | Ingen PostgreSQL installeret i dette miljø. Driveren taler den rigtige wire-protokol og efterprøves mod en protokolfast test-dobbelt; en rigtig server kræver ekstern installation. |
| GitHub Actions CI | `gh workflow run Supply chain` | Actions er slået fra på repo-niveau, og det gamle ci.yml blev fjernet i commit 76e4782. Workflows for release-gate, DCO og forsyningskæde er konfiguration; kun lokal `make ci`/`make baseline` kan køres. |
| Rigtigt containerbuild, SBOM-scanning og signering i CI | `make supply-chain-containers-build` | Docker er ikke tilgængeligt i WSL-distroen, og cosign/syft/trivy er ikke installeret. Dockerfiles, base-digests og byggeplan er kontrolleret statisk; selve byggeriet, scanningen og signeringen kræver CI. |
| Rigtig drift i en stagingklynge | `make infrastructure-drift` | Der findes ingen stagingklynge og ingen kubectl/kubeconfig i dette miljø. Reconcile er efterprøvet mod injiceret observeret tilstand i tests, men rigtig drift kræver en levende klynge. |
| Rigtig provisionering af staging via OpenTofu | `tofu -chdir=infrastructure/iac/small-vps plan -var-file=env/staging.tfvars` | OpenTofu/Terraform er ikke installeret i dette miljø. Modulet er statisk kontrolleret (pinned providere, default-deny firewall, kryptering), men plan/apply er NOT RUN. |
| Integration/runtime-prober mod en levende staginginstallation (DKC-018) | `make evidence-probe` | Der findes ingen kørende PDP/audit/gateway/runtime i dette miljø, og DKC_PROBE_*-bindingen (commit/image/miljø/run-ID) er ikke sat. Probekøreren skriver not-run med begrundelse; et fixture-pass tæller ikke som driftsbevis. |
| Rigtige scannere (Trivy/OSV/Semgrep/Gitleaks) og dynamisk staging-scanning (DKC-064) | `make vulnerability-scan` | Hverken Trivy, OSV-scanner, Semgrep, Gitleaks eller en isoleret stagingklynge er installeret/tilgængelig her. Beholdningen bygges fra committede, repræsentative scannerfixtures; de rigtige scannere og dynamisk scanning er NOT RUN og dækningen er derfor erklæret ufuldstændig. |

## PASS (reelt efterprøvet i denne kørsel)

| Check | Niveau | Kommando |
| --- | --- | --- |
| Metavalidér kontraktskemaer og eksempler | Contract | `make validate` |
| Lint JSON og tekstfiler | Contract | `make lint` |
| Conformance-suitens egne tests | Real | `make test` |
| Fælles identitetsverifikation (OIDC, workload, session, ingress) | Real | `make identity-test` |
| Autentiske, ændringsbundne godkendelser (binding, unikke godkendere, persistence, tilbagekaldelse) | Real | `make approval-test` |
| Godkendelsesbinding og state machine i eksempler | Contract | `make approval-check` |
| Deployment-, identitets- og kandidatkontrakter (skema + semantik) | Real | `make architecture-test` |
| Serviceklasser, moduldækning og deployment-profilkompatibilitet valideres (DKC-037) | Contract | `make continuity-check` |
| Serviceklasser og recoverymål: holdbarhed, fejldomæner, N+1 og foreslået vs. vedtaget (DKC-037) | Real | `make continuity-test` |
| Krypteret backup og gendannelsesrapport valideres (skema + nøgle-/komponent-/gate-semantik) (DKC-016) | Contract | `make backup-check` |
| Backup/gendannelse: AES-256-GCM, separat nøgleadgang, isoleret restore, suppressionsjournal og målt RPO/RTO (DKC-016) | Real | `make backup-test` |
| Eksterne backupmål og målsæt valideres (skema + credentials-/WORM-/TLS-/domæne-/kildesemantik) (DKC-057) | Contract | `make backup-target-check` |
| S3-backend (SigV4), preflight, canary, synkronisering og skift af backupmål (DKC-057) | Mock | `make backup-target-test` |
| Katalog, installationsprofiler, platformmatrix og dependency-resolver valideres (DKC-053) | Contract | `make distribution-check` |
| Dependency-resolver: cyklus, version, konflikt, fjernet delt afhængighed og BI-only (DKC-053) | Real | `make distribution-test` |
| Deterministisk installationspreview af valgt closure og begrundelser (DKC-053) | Real | `make distribution-preview PROFILE=ha-cluster APPS=bi,hr` |
| Testmatrix, trusselmodel, undtagelser og uafhængige vurderinger valideres (DKC-063) | Contract | `make release-check` |
| Release-gate: failed/skipped/not-run/unsupported/stale/wrong-artifact kan ikke bestå (DKC-063) | Real | `make release-test` |
| SBOM, artefaktmanifest, Dockerfiles og branch protection valideres (DKC-014) | Contract | `make supply-chain-check` |
| Deterministisk SBOM, digest-/pladsholderafvisning, Ed25519-signatur og beskyttet ændring (DKC-014) | Real | `make supply-chain-test` |
| Cachet OSV-scanning evalueres mod ejergodkendt sårbarhedspolitik (DKC-014) | Real | `make supply-chain-vuln-check` |
| Infrastrukturplan, IaC, miljøadskillelse, netværk, secrets og omkostning valideres (DKC-015) | Contract | `make infrastructure-check` |
| Miljøadskillelse, netværksisolation, secret-injektion, break-glass og drift (DKC-015) | Real | `make infrastructure-test` |
| GitOps-gates for dev/staging/prod og bevis på miljøadskillelse (DKC-015) | Real | `make infrastructure-verify` |
| OpenTofu-modulet er pinnet, hærdet og uden klartekst-hemmeligheder (DKC-015) | Real | `make infrastructure-iac-check` |
| Evidensposter og probemanifest: mode, commit, image, miljø, upstream, run-ID og udløb valideres (DKC-018) | Contract | `make evidence-mode-check` |
| Fixture-only uden produktionsbadge, udløb/forkert artefakt, tampering, PDP-nedbrud og direkte endpoints (DKC-018) | Real | `make evidence-mode-test` |
| Sårbarhedsbeholdning: dedup, prioritet, livscyklus, dækning og inventarrekonciliation valideres (DKC-064) | Contract | `make vulnerability-check` |
| Syntetiske sårbarheds- og secret-canary-fixtures, dedup, AI-undertrykkelse, restriance og uafhængig verifikation (DKC-064) | Real | `make vulnerability-test` |
| Kandidatrapport og releaseprofil pr. upstream-version/edition: conformance pr. verbum, versionsforhandling, native admin-beskyttelse og hård SSO-/licensgate (DKC-023) | Contract | `make adapter-sdk-check` |
| Fælles adapter-SDK og godkendelsesharness: auth/tenant/PDP/audit/idempotens/health/versionsforhandling samt API-fejl, rate limits, versionsskift, backup og negative adgangstest (DKC-023) | Real | `make adapter-sdk-test` |
| Live-mål pinnet til eksakt upstream-version/edition, obligatorisk backup/rollback og ærlig partial-conformance pr. privacy-verbum (DKC-024) | Contract | `make adapter-live-check` |
| Live-kører (bindinger, not-run uden endpoint, partial-ærlighed), demo-værn i produktion og opgraderings-/rollbackplanens semantik (DKC-024) | Real | `make adapter-live-test` |
| Privacy-eksportkontrakt, udløbs-/modtagerbinding og fail-closed identitetsmatchning på tværs af tenant og ejer (DKC-020) | Contract | `make privacy-check` |
| Holdbar DSAR-sag: autoriseret sagsbehandler, genoptagelig to-app fan-out, timeout/nedetid som failed/unknown og sikret eksport (DKC-020) | Real | `make privacy-test` |
| Tenantisolering gennem kontrolplanet (kontekst, datalager, API, gateway, godkendelser) | Real | `make tenant-test` |
| Tenant-kontekst og ressource-ID-kontrakt i eksempler | Contract | `make tenant-check` |
| PDP'ens tests | Real | `make policy-test` |
| Verificér signeret policy-bundle | Real | `make policy-verify` |
| Træf eksempelbeslutning gennem PDP | Real | `make policy-decide` |
| GitOps-værktøjernes tests | Real | `make gitops-test` |
| GitOps-policy-gates (digests, labels, hardening, fail-closed) | Real | `make gitops-verify` |
| Reconcile mod simuleret observeret tilstand | Fixture | `make gitops-reconcile` |
| Bevis at simulerede ændringer uden om git opdages | Fixture | `make gitops-drift` |
| Udled maskinlæsbar change log fra git | Real | `make changelog` |
| Referencemodulets tests (identitet, hash-kæde, PDP, fail-closed) | Real | `make audit-service-test` |
| Fremkald konformansbevis ved at køre verberne | Real | `make audit-service-evidence` |
| Mattermost-adapterens tests | Mock | `make adapter-test` |
| Adapterbevis mod mock Mattermost + rigtig PDP | Mock | `make adapter-evidence` |
| IAM-adapterens tests (mock Keycloak/Authentik) | Mock | `make iam-adapter-test` |
| IAM-adapterbevis mod mock Keycloak + partial-erkendelse | Mock | `make iam-adapter-evidence` |
| AI-gatewayens tests (routing, dataklasser, budget, idempotens, modelversion) | Mock | `make gateway-test` |
| Serverstyrede routes, dataklasser og model-egress-allowliste valideres (DKC-012) | Contract | `make gateway-check` |
| Modelgatewayens accepttests: budgetbinding, dataklasser, timeout/streaming-afregning og egress (DKC-012) | Real | `make model-gateway-test` |
| Atomiske budgetreservationer og holdbar idempotens for modelgatewayen (DKC-012) | Real | `make budget-test` |
| GitOps-netværkspolitik blokerer direkte model-egress uden om gatewayen (DKC-012) | Real | `make model-egress-check` |
| Agent-runtime tests (grænsevalidering, miljø/scope/datakategori, A4-klassifikation, digest-bundet evidens, budget, loop, JIT, godkendelser) | Real | `make runtime-test` |
| Runtimegrænse og fælles klassifikation (PDP-binding, miljø/scope/datakategori, A4-aliaser, evidensdigest) | Real | `make boundary-test` |
| Holdbar tilstand: versionerede migrationer, genstart, samtidige writes, tenantgrænser og backup/restore (DKC-008) | Real | `make persistence-test` |
| Persistensskema, migrationer, tenant-views og databaseidentiteter valideres | Contract | `make persistence-check` |
| Database-HA-plan, operator, sync-replikering, fencing, read-consistency, WAL/PITR og manifester valideres (DKC-039) | Contract | `make db-ha-check` |
| Database-HA: sync-quorum, commitkvitteringer, fencing, partition, rejoin og schemaopgradering (DKC-039) | Real | `make db-ha-test` |
| Deterministisk database-failover: alle commitkvitteringer findes efter promotion (DKC-039) | Real | `make db-ha-drill` |
| Lagerplan, vedligeholdt CSI-/objektlager, topologi, quorum, klasser, checksums, scrub/repair, nøgler og manifester valideres (DKC-041) | Contract | `make storage-check` |
| Holdbart fil- og objektlager: versioner, checksums, quorum, tenantnøgler, scrub/repair, cache, indeks og relokation (DKC-041) | Real | `make storage-test` |
| Deterministisk lager-holdbarhedsøvelse: relokation, silent corruption, quorumtab, cachetab og repair under belastning (DKC-041) | Real | `make storage-drill` |
| Holdbar audit: intent/outcome, idempotens, reconciliation, checkpoint, roller og genstart (DKC-009) | Real | `make audit-durability-test` |
| Audit-skrive-/læserroller, eksternt checkpoint og secret-redaktion valideres | Contract | `make audit-durability-check` |
| Kortlivede, scope-bundne rettigheder, tilbagekaldelse og nødstop (DKC-010) | Real | `make credentials-test` |
| Signerer, JWKS, holdbar tilbagekaldelse/nødstop og A4-afvisning valideres | Contract | `make credentials-check` |
| Servervaliderede typede værktøjer, egress og flersproget injection-korpus (DKC-011) | Real | `make tool-boundary-test` |
| Værktøjsallowlist, parametre, størrelsesgrænser, egress og korpusdækning valideres | Contract | `make tool-boundary-check` |
| Genoptagelig og idempotent jobkørsel: tilstand, leases, retries, dead-letter og handlingsklassifikation (DKC-013) | Real | `make jobs-test` |
| Jobtilstandsmaskine, idempotency-keys, leases, retry og dead-letter valideres | Contract | `make jobs-check` |
| Beskedtopologi, transaktionel outbox, dedup, rækkefølge og fencing valideres (DKC-040) | Contract | `make messaging-check` |
| Holdbar beskedudveksling: outbox/inbox, publisher confirms, dedup, rækkefølge, leases, backpressure og poison (DKC-040) | Real | `make messaging-test` |
| Præcis én uforanderlig rolle pr. agent (roller, register, handoff, scheduler, runtime-vagt) | Real | `make agent-registry-test` |
| Alle agent-manifester har præcis én gyldig rolle | Contract | `make agent-registry-check` |
| De seks agent-konformanstests | Real | `make agent-conformance-test` |
| Reviewer-agent og effektmåling | Real | `make reviewer-test` |
| Kontrolmappingens tests | Real | `make compliance-test` |
| Kontrolmapping i sync med registry | Real | `make compliance-check` |
| Dataregister, retention og tredjelandsvurdering valideres og krydsrefereres (DKC-019) | Contract | `make data-register-check` |
| Dataregister: ejerbeslutning, blocker, retention, holds og tenantautorisation (DKC-019) | Real | `make data-register-test` |
| Beskyttede dataklasser (AI-immutable), forbud og modul-dækning valideres (DKC-047) | Contract | `make data-protection-check` |
| Beskyttelsesguard: AI-ændringsforbud, no-AI-access, transitioner og runtimehåndhævelse (DKC-047) | Real | `make data-protection-test` |
| Immutable-håndhævelse: object-lock, rollematrix, agentnægtelse, append-only audit-ingest, beskyttede ressourcer og to-personers kontrol valideres (DKC-048) | Contract | `make immutable-check` |
| Immutable data: WORM-låse, retention, versionsskjul, rolle-håndhævelse, nøglebeskyttelse, backup/restore og lagersemantik (DKC-048) | Real | `make immutable-test` |
| Sletningsdækning, hold-blokering og genanvendelse ved restore valideres (DKC-021) | Contract | `make retention-check` |
| Sletning, legal hold, ærlige kvitteringer, restoregate og holdbar persistens (DKC-021) | Real | `make retention-test` |
| Databaseprofiler, datakilder, bindinger og scope valideres (DKC-056) | Contract | `make data-services-check` |
| Datatjenester: drivere, connector-scope, migrationsguard, recovery, registry og persistens (DKC-056) | Real | `make data-services-test` |
| Observability-generatorens tests | Real | `make observability-test` |
| Dashboards i sync med modulernes SLO | Real | `make observability-check` |
| Sikkerhedsnormaliseringens tests | Real | `make security-test` |
| Sikkerhedsfund validerer og er i sync med rådata | Fixture | `make security-check` |
| Sensorkatalog, alarmregler og deres ejerskab/runbooks valideres (DKC-017) | Contract | `make monitoring-check` |
| Telemetri minimeres, tenantadgang håndhæves, friskhed giver ikke falsk grønt og alarmer leveres (DKC-017) | Real | `make monitoring-test` |
| Fremkaldt tjenestefejl og backupfejl udløser alarm hos testmodtager (DKC-017) | Real | `make monitoring-drill` |
| Collectorkatalog og DKC-066-kontrakter (envelope, view, adapter, collector, testkørsel, recovery) valideres (DKC-066) | Contract | `make telemetry-api-check` |
| Stabile ressource-ID'er, server-side scope, dedup/replay, tenant-scopede views, udskiftelige adaptere, collector-selvovervågning og audit-adskillelse (DKC-066) | Real | `make telemetry-api-test` |
| Kontrolleret staging-fejl linker version, trace, alarm og incident gennem API, views og adaptere (DKC-066) | Real | `make telemetry-api-demo` |
| Funktionsprofiler og DKC-060-kontrakter (profil, rapportdefinition, rapportkørsel, offboarding) valideres (DKC-060) | Contract | `make feature-access-check` |
| Default-deny ressource-/række-/feltkontrol, fladelighed, gæster, servicekonti, offboarding, rapportering og beskyttet connector (DKC-060) | Real | `make feature-access-test` |
| Kontrolleret DKC-060-forløb: BI vs. HR, rapportering, offboarding og beskyttet connector | Real | `make feature-access-demo` |
| HA-plan, quorum, N+1, ingress/DNS, mTLS og workload-HA valideres (DKC-038) | Contract | `make ha-check` |
| Quorumtab, frivillig drain vs. hårdt nedbrud, N+1, ingress/DNS, mTLS og stateful-plan (DKC-038) | Real | `make ha-test` |
| Deterministisk failover-simulering: frivillig drain og hårdt nedbrud separat (DKC-038) | Real | `make ha-drill` |
| Ejer-curriculummets tests | Real | `make curriculum-test` |
| Validér curriculum og afvisningsscenarier | Real | `make curriculum-check` |
| Pitch-checkerens tests | Real | `make pitch-test` |
| Hvert bevis i pitch-decket findes i repoet | Real | `make pitch-check` |
| Konformans mod alle rigtige moduler | Real | `make conform-all` |
| Generér OSCAL-assessment-results | Real | `make oscal-evidence` |
| Evidens-emitterens tests | Real | `make evidence-test` |
| Bevidst brudt fixture skal fejle | Fixture | `make conform-negative` |
| DSAR-fan-out mod dummy-moduler | Fixture | `make dsar-demo` |
| CloudEvent end-to-end gennem collectoren | Real | `make telemetry-test` |

## Komponentmatrix

Alle rækker er kørt mod commit `83ad91a`. Kolonnen **Niveau** angiver bevisets dækning; **Åbne mangler** er det, der endnu ikke er bevist.

### Bølge 0.1

| Komponent | Niveau | Testkommando | Resultat | Åbne mangler |
| --- | --- | --- | --- | --- |
| Repo-skelet og beslutningslog | Contract | `make lint`<br>`make validate` | ✔ PASS | — |

### Bølge 2

| Komponent | Niveau | Testkommando | Resultat | Åbne mangler |
| --- | --- | --- | --- | --- |
| Verificerbar identitet (DKC-003) | Real | `make identity-test` | ✔ PASS | — |
| Krypteret backup og gendannelsesøvelse (DKC-016) | Real + Contract + Integration | `make backup-check`<br>`make backup-test`<br>`make backup-drill` | ✔ PASS | NOT RUN integration-backup-production-drill: Ingen produktionsklynge eller ekstern PostgreSQL i dette miljø. Øvelsen er kørt rigtigt mod den lokale SQLite-persistens; en produktionsøvelse med tab af den primære database kræver ekstern infrastruktur og et navngivet menneskes godkendelse. |
| Eksterne backupmål og skift af mål (DKC-057) | Mock + Contract + Integration | `make backup-target-check`<br>`make backup-target-test`<br>`make backup-target-canary` | ✔ PASS | NOT RUN integration-backup-external-target: Ingen rigtig S3/MinIO-instans i dette miljø. SigV4-klienten og preflight/canary efterprøves mod en protokolfast test-dobbelt; en rigtig instans kræver ekstern infrastruktur og credentials. |
| Adskillelse af kontraktchecks, integration og driftsbevis (DKC-018) | Real + Contract + Integration | `make evidence-mode-check`<br>`make evidence-mode-test`<br>`make evidence-probe` | ✔ PASS | NOT RUN evidence-probe-staging: Der findes ingen kørende PDP/audit/gateway/runtime i dette miljø, og DKC_PROBE_*-bindingen (commit/image/miljø/run-ID) er ikke sat. Probekøreren skriver not-run med begrundelse; et fixture-pass tæller ikke som driftsbevis. |
| Kontinuerlig sikkerhedskontrol og sårbarhedslivscyklus (DKC-064) | Real + Contract + Integration | `make vulnerability-scan`<br>`make vulnerability-check`<br>`make vulnerability-test` | ✔ PASS | NOT RUN integration-vulnerability-scan: Hverken Trivy, OSV-scanner, Semgrep, Gitleaks eller en isoleret stagingklynge er installeret/tilgængelig her. Beholdningen bygges fra committede, repræsentative scannerfixtures; de rigtige scannere og dynamisk scanning er NOT RUN og dækningen er derfor erklæret ufuldstændig. |
| Fælles adapterværktøjer og godkendelsestest (DKC-023) | Real + Contract | `make adapter-sdk-check`<br>`make adapter-sdk-test` | ✔ PASS | Harnessen kører mod mock-upstream og den rigtige PDP. Rigtige upstream-instanser og en levende stagingklynge er separate integrationer (NOT RUN). |
| Live integration og opgraderingsplan for adaptere (DKC-024) | Real + Contract + Integration | `make adapter-live-check`<br>`make adapter-live-test`<br>`make adapter-live-run` | ✔ PASS | Køreren efterprøves med injiceret fetch; rigtige Mattermost-/Keycloak-instanser kræver DKC_LIVE_*-bindinger og er NOT RUN her.<br>NOT RUN integration-adapter-live: Ingen rigtige Mattermost-/Keycloak-instanser og ingen DKC_LIVE_*-bindinger/credentials i dette miljø. Live-køreren skriver not-run med begrundelse; et injiceret fetch-pass tæller ikke som driftsbevis. |
| Indsigt og eksport som tværgående proces (DKC-020) | Real + Contract + Integration | `make privacy-run`<br>`make privacy-check`<br>`make privacy-test` | ✔ PASS | NOT RUN integration-privacy-live: Ingen levende tredjepartsapps/upstream i dette miljø. To-app fan-out er efterprøvet mod de rigtige adaptere med mock-upstream og i conformance-testen; DSAR mod rigtige apps og rigtige kundedata er NOT RUN.<br>To-app fan-out efterprøves mod de rigtige adaptere med mock-upstream; rigtige upstream-instanser er NOT RUN. |
| Reproducerbar staging med GitOps (DKC-015) | Real + Contract + Integration | `make infrastructure-check`<br>`make infrastructure-iac-check`<br>`make infrastructure-test`<br>`make infrastructure-verify`<br>`make infrastructure-drift`<br>`tofu -chdir=infrastructure/iac/small-vps plan -var-file=env/staging.tfvars` | ✔ PASS | NOT RUN integration-staging-drift: Der findes ingen stagingklynge og ingen kubectl/kubeconfig i dette miljø. Reconcile er efterprøvet mod injiceret observeret tilstand i tests, men rigtig drift kræver en levende klynge.<br>NOT RUN integration-staging-provision: OpenTofu/Terraform er ikke installeret i dette miljø. Modulet er statisk kontrolleret (pinned providere, default-deny firewall, kryptering), men plan/apply er NOT RUN. |
| Immutable data uden for agentens kontrol (DKC-048) | Real + Contract + Integration | `make immutable-check`<br>`make immutable-test`<br>`true` | ✔ PASS | NOT RUN integration-immutable-live: Der findes ingen levende S3-/objektlager-instans i dette miljø. Object-lock i GOVERNANCE/COMPLIANCE, afvisning af sletning, retention og versionsskjul er efterprøvet deterministisk mod den rigtige fillager-model; en målt verifikation på et rigtigt storage-produkt kræver uafhængig driftsverifikation. |
| Sletning, legal hold og gendannelsesregler (DKC-021) | Real + Contract + Integration | `make retention-demo`<br>`make retention-check`<br>`make retention-test` | ✔ PASS | NOT RUN integration-retention-live: Der findes ingen levende modelleverandør med slette-API og intet rigtigt objektlager i dette miljø. Sletning, hold-blokering, suppressionsjournal og restoregate er efterprøvet deterministisk på den rigtige fillager-model; en målt sletning hos en ekstern leverandør er NOT RUN. |
| Indbyggede og eksterne datatjenester med entydigt ejerskab (DKC-056) | Real + Contract + Integration | `make data-services-check`<br>`make data-services-test`<br>`make data-services-test` | ✔ PASS | PostgreSQL-driveren efterprøves mod en protokolfast test-dobbelt (mock); ingen installeret PostgreSQL indgår (NOT RUN, se integration-postgresql).<br>NOT RUN integration-postgresql: Ingen PostgreSQL installeret i dette miljø. Driveren taler den rigtige wire-protokol og efterprøves mod en protokolfast test-dobbelt; en rigtig server kræver ekstern installation. |

### Bølge 0

| Komponent | Niveau | Testkommando | Resultat | Åbne mangler |
| --- | --- | --- | --- | --- |
| Serviceklasser, fejldomæner og recoverymål (DKC-037) | Real + Contract + Integration | `make continuity-check`<br>`make continuity-test`<br>`make continuity-report` | ✔ PASS | NOT RUN integration-continuity-measurement: Ingen levende probe-/fejltest-infrastruktur i dette miljø. Målene er kontraktvalideret og et erklæret niveau er ikke et målt niveau. |
| Installationsprofiler og dependency-resolver (DKC-053) | Real + Contract | `make distribution-check`<br>`make distribution-preview PROFILE=ha-cluster APPS=bi,hr`<br>`make distribution-test` | ✔ PASS | — |
| Testmatrix og CI-releasegates (DKC-063) | Real + Contract | `make release-check`<br>`make release-test` | ✔ PASS | — |
| Reproducerbare artefakter og beskyttet releasevej (DKC-014) | Real + Contract + Integration | `make supply-chain-containers-build`<br>`make supply-chain-check`<br>`make supply-chain-test`<br>`make supply-chain-vuln-check` | ✔ PASS | NOT RUN integration-container-build: Docker er ikke tilgængeligt i WSL-distroen, og cosign/syft/trivy er ikke installeret. Dockerfiles, base-digests og byggeplan er kontrolleret statisk; selve byggeriet, scanningen og signeringen kræver CI.<br>Scanningen er et øjebliksbillede af OSV-databasen på queriedAt; den køres mod de låste versioner og opdateres med 'make supply-chain-scan' (netværk). |
| Beskyttede dataklasser og AI-immutable (DKC-047) | Real + Contract | `make data-protection-check`<br>`make data-protection-test` | ✔ PASS | — |

### Bølge 1

| Komponent | Niveau | Testkommando | Resultat | Åbne mangler |
| --- | --- | --- | --- | --- |
| Deployment- og identitetskontrakter (DKC-002) | Real + Contract | `make architecture-test`<br>`make validate` | ✔ PASS | — |
| Holdbar tilstand og migrationer (DKC-008) | Real + Contract | `make persistence-check`<br>`make persistence-test` | ✔ PASS | — |
| Holdbar audit og fail-closed handlinger (DKC-009) | Real + Contract | `make audit-durability-check`<br>`make audit-durability-test` | ✔ PASS | — |
| Præcis én uforanderlig rolle pr. agent (DKC-055) | Real + Contract | `make agent-conformance-test`<br>`make agent-registry-check`<br>`make agent-registry-test` | ✔ PASS | — |

### Bølge 0.2

| Komponent | Niveau | Testkommando | Resultat | Åbne mangler |
| --- | --- | --- | --- | --- |
| Identitetsplan | Integration | `make runtime-demo` | • NOT RUN | NOT RUN integration-oidc: Identitet er kontraktvalideret og simuleret; ingen rigtig IdP er koblet på. |

### Bølge 0.3

| Komponent | Niveau | Testkommando | Resultat | Åbne mangler |
| --- | --- | --- | --- | --- |
| Telemetriplan | Real | `make telemetry-test` | ✔ PASS | — |

### Bølge 0.4

| Komponent | Niveau | Testkommando | Resultat | Åbne mangler |
| --- | --- | --- | --- | --- |
| Ops-kontrakt | Contract | `make validate` | ✔ PASS | — |

### Bølge 0.5

| Komponent | Niveau | Testkommando | Resultat | Åbne mangler |
| --- | --- | --- | --- | --- |
| Privacy-verber | Fixture | `make dsar-demo` | ✔ PASS | Fan-out demonstreres mod dummy-moduler, ikke mod rigtige tjenester. |

### Bølge 0.6

| Komponent | Niveau | Testkommando | Resultat | Åbne mangler |
| --- | --- | --- | --- | --- |
| Konformanssuite | Real + Fixture | `make conform-all`<br>`make conform-negative`<br>`make test` | ✔ PASS | — |

### Bølge 1.1

| Komponent | Niveau | Testkommando | Resultat | Åbne mangler |
| --- | --- | --- | --- | --- |
| Policy-plan (PDP) | Real | `make policy-decide`<br>`make policy-test`<br>`make policy-verify` | ✔ PASS | — |

### Bølge 1.2

| Komponent | Niveau | Testkommando | Resultat | Åbne mangler |
| --- | --- | --- | --- | --- |
| GitOps-skelet | Real + Fixture | `make changelog`<br>`make changelog-check`<br>`make gitops-drift`<br>`make gitops-reconcile`<br>`make gitops-test`<br>`make gitops-verify` | ✘ FAIL | changelog-check fejlede (exit 2): se evidensloggen.<br>Driften er simuleret i repoet; ingen Argo CD/klynge er koblet på.<br>Observeret tilstand er en committet simulering, ikke en rigtig klynge. |

### Bølge 1.3

| Komponent | Niveau | Testkommando | Resultat | Åbne mangler |
| --- | --- | --- | --- | --- |
| Referencemodul A (audit-service) | Real | `make audit-service-evidence`<br>`make audit-service-test` | ✔ PASS | Referencetjenesten kører in-process/file-backed; intet deployet runtime er bevist. Skriver capturedAt/durationMs til committede fixtures og er ikke idempotent. |

### Bølge 1.4

| Komponent | Niveau | Testkommando | Resultat | Åbne mangler |
| --- | --- | --- | --- | --- |
| Referenceadapter B (Mattermost) | Mock + Integration | `make adapter-evidence`<br>`make adapter-test`<br>`make adapter-run` | ✔ PASS | Beviset gælder adfærd mod mock; rigtig Mattermost er en separat integration (NOT RUN). Skriver ikke-idempotente fixtures.<br>Testes mod mock Mattermost, ikke en rigtig installation.<br>NOT RUN integration-mattermost: Ingen MATTERMOST_URL/credentials i dette miljø. Kun mock-adfærd er bevist. |

### Bølge 2.1

| Komponent | Niveau | Testkommando | Resultat | Åbne mangler |
| --- | --- | --- | --- | --- |
| Agent-manifest + approval-payload | Contract | `make validate` | ✔ PASS | — |
| HA-klynge og sikker kommunikation mellem servere (DKC-038) | Real + Contract + Integration | `make ha-check`<br>`make ha-drill`<br>`make ha-test`<br>`true`<br>`true` | ✔ PASS | NOT RUN integration-ha-failover: Der findes ingen levende HA-klynge eller servere i dette miljø. Quorum, N+1 og failover-adfærd er simuleret deterministisk; en målt overtagelse inden for servicemålet er NOT RUN.<br>NOT RUN integration-network-policy-plugin: Der er ingen kørende Cilium/Calico-installation i dette miljø. Politikkerne er strukturelt valideret; faktisk afvisning af krydskunde-trafik er NOT RUN. |

### Bølge 2.2

| Komponent | Niveau | Testkommando | Resultat | Åbne mangler |
| --- | --- | --- | --- | --- |
| AI-gateway med serverstyret routing og bindende budgetter (DKC-012) | Real + Mock + Contract + Integration | `make budget-test`<br>`make gateway-check`<br>`make gateway-test`<br>`make gateway-run`<br>`make model-egress-check`<br>`make model-gateway-test` | ✔ PASS | Reel OpenAI-kompatibel adapter testes mod en loopback-HTTP-server og echo bruges til deterministiske tests. Ingen rigtig leverandørnøgle/-endpoint er konfigureret i dette miljø (se integration-llm).<br>NOT RUN integration-llm: Den reelle OpenAI-kompatible adapter findes og testes mod loopback-HTTP; ingen leverandørnøgle/-endpoint er konfigureret i dette miljø. |
| Database-HA med fencing og konsistent failover (DKC-039) | Real + Contract + Integration | `make db-ha-check`<br>`make db-ha-drill`<br>`make db-ha-test`<br>`true` | ✔ PASS | NOT RUN integration-db-failover: Der findes ingen levende PostgreSQL-installation, operator eller klynge i dette miljø. Sync-quorum, commitkvitteringer, fencing, partition, rejoin og schemaopgradering er efterprøvet deterministisk mod den rigtige SQLite-persistens; en målt failover og en faktisk WAL-arkivering er NOT RUN. |
| Holdbart fil- og objektlager med quorum, checksums og scrub/repair (DKC-041) | Real + Contract + Integration | `true`<br>`make storage-check`<br>`make storage-drill`<br>`make storage-test` | ✔ PASS | NOT RUN integration-storage-live: Der findes ingen levende CSI-driver (Longhorn) eller S3-kompatibelt objektlager (MinIO) i dette miljø. Replikering, versionsstyrede checksums, scrub/repair, quorum, tenantnøgler, cache/indeks og relokation er efterprøvet deterministisk over et rigtigt filsystem; en målt host-/diskfejl og en faktisk rebalance under produktion er NOT RUN. |

### Bølge 2.3

| Komponent | Niveau | Testkommando | Resultat | Åbne mangler |
| --- | --- | --- | --- | --- |
| Agent-runtime (DKC-005: godkendelser verificeres hos tjenesten; DKC-007: grænsevalidering og A4-klassifikation; DKC-011: typet værktøjsgrænse) | Real + Contract | `make boundary-test`<br>`make runtime-test`<br>`make tool-boundary-check`<br>`make tool-boundary-test` | ✔ PASS | — |
| Kortlivede, scope-bundne rettigheder og nødstop (DKC-010) | Real + Contract | `make credentials-check`<br>`make credentials-test` | ✔ PASS | — |
| Servervalideret værktøjsgrænse og injection-tests (DKC-011) | Real + Contract | `make tool-boundary-check`<br>`make tool-boundary-test` | ✔ PASS | — |

### Bølge 2.4

| Komponent | Niveau | Testkommando | Resultat | Åbne mangler |
| --- | --- | --- | --- | --- |
| Kundeadskillelse gennem kontrolplanet (DKC-006) | Real + Contract | `make tenant-check`<br>`make tenant-test` | ✔ PASS | — |
| Approval-service + UI (autentisk og ændringsbundet, DKC-004) | Real + Contract | `make agent-conformance-test`<br>`make approval-check`<br>`make approval-test`<br>`make test` | ✔ PASS | — |

### Bølge 2.6

| Komponent | Niveau | Testkommando | Resultat | Åbne mangler |
| --- | --- | --- | --- | --- |
| Genoptagelig og idempotent eksekvering (DKC-013) | Real + Contract | `make jobs-check`<br>`make jobs-test` | ✔ PASS | — |
| Agent-konformanstests (seks) | Real | `make agent-conformance-test` | ✔ PASS | — |

### Bølge 2.7

| Komponent | Niveau | Testkommando | Resultat | Åbne mangler |
| --- | --- | --- | --- | --- |
| Holdbar beskedudveksling mellem servere (DKC-040) | Real + Contract + Integration | `true`<br>`make messaging-check`<br>`make messaging-test` | ✔ PASS | NOT RUN integration-message-broker: Der findes ingen kørende NATS/AMQP/Kafka-broker i dette miljø. Outbox, inbox, dedup, rækkefølge, fencing og backpressure er efterprøvet mod den rigtige SQLite-persistens; en faktisk brokerbekræftelse og målt leverance er NOT RUN. |
| Reviewer-effektmåling | Real | `make reviewer-metrics` | • NOT RUN | NOT RUN reviewer-metrics: Starter en HTTP-server på 127.0.0.1:8484 og terminerer ikke; det er ikke en afsluttende check. Effektmålingen er dækket af reviewer-test. |

### Bølge 2.5

| Komponent | Niveau | Testkommando | Resultat | Åbne mangler |
| --- | --- | --- | --- | --- |
| Adversarial reviewer-agent | Real | `make reviewer-test` | ✔ PASS | — |

### Bølge 3.1

| Komponent | Niveau | Testkommando | Resultat | Åbne mangler |
| --- | --- | --- | --- | --- |
| Compliance-evidens-emitter (OSCAL) | Real | `make evidence-test`<br>`make oscal-evidence` | ✔ PASS | — |

### Bølge 3.2

| Komponent | Niveau | Testkommando | Resultat | Åbne mangler |
| --- | --- | --- | --- | --- |
| Kontrolmapping NIS2/GDPR/AI Act | Real | `make compliance-check`<br>`make compliance-test` | ✔ PASS | — |

### Bølge 3.5

| Komponent | Niveau | Testkommando | Resultat | Åbne mangler |
| --- | --- | --- | --- | --- |
| Dataregister, retention og underleverandører (DKC-019) | Real + Contract | `make data-register-check`<br>`make data-register-test` | ✔ PASS | — |

### Bølge 3.3

| Komponent | Niveau | Testkommando | Resultat | Åbne mangler |
| --- | --- | --- | --- | --- |
| Ops-dashboards (Prometheus/Grafana/Loki) | Real | `make observability-check`<br>`make observability-test` | ✔ PASS | — |
| Reel overvågning, tenantadskilt telemetri og handlingsdygtige alarmer (DKC-017) | Real + Contract + Integration | `true`<br>`promtool check rules observability/`<br>`make monitoring-check`<br>`make monitoring-drill`<br>`make monitoring-test` | ✔ PASS | NOT RUN integration-alert-delivery: Der er ingen pager- eller webhook-konto i dette miljø. Den lokale testmodtager er en rigtig fil-bakket modtager, men en rigtig kanal er NOT RUN.<br>NOT RUN integration-monitoring-backend: Der findes ingen kørende Prometheus/Loki/OTel-collector i dette miljø. Indsamling og minimering er efterprøvet lokalt; den rigtige backend er NOT RUN. |
| Autoriseret telemetri-API og udskiftelige dashboards (DKC-066) | Real + Contract + Integration | `true`<br>`true`<br>`make telemetry-api-check`<br>`make telemetry-api-demo`<br>`make telemetry-api-test` | ✔ PASS | NOT RUN integration-dashboard-adapter: Der er ingen rigtig Grafana/Loki-instans i dette miljø. Adapterkontrakten og udskifteligheden er efterprøvet lokalt mod det samme view; en rigtig instans er NOT RUN.<br>NOT RUN integration-telemetry-backend: Der findes ingen kørende OTel-collector/Prometheus i dette miljø. Indtagning, scope og views er efterprøvet lokalt; den rigtige backend er NOT RUN. |

### Bølge 3.4

| Komponent | Niveau | Testkommando | Resultat | Åbne mangler |
| --- | --- | --- | --- | --- |
| Security-plan (Trivy/Falco/Wazuh) | Real + Fixture + Integration | `falco -r security/falco/platform-rules.yaml`<br>`trivy fs --severity CRITICAL,HIGH .`<br>`wazuh -t -r security/wazuh/local_rules.xml`<br>`make security-check`<br>`make security-test` | ✔ PASS | NOT RUN integration-falco: Kræver en levende container-runtime/klynge. Reglerne er kun konfiguration i repoet.<br>NOT RUN integration-trivy: Trivy er ikke installeret i dette miljø; CI-workflowet er fjernet. Sample-data dækker kun normaliseringen.<br>NOT RUN integration-wazuh: Kræver en levende SIEM-installation. Reglerne er kun konfiguration i repoet.<br>Rådata er committede samples; ingen rigtig Trivy/Falco/Wazuh-kørsel indgår (NOT RUN). |

### Bølge 4.2

| Komponent | Niveau | Testkommando | Resultat | Åbne mangler |
| --- | --- | --- | --- | --- |
| Tværgående IAM og dataadgang for Communications, HR, BI og Reporting (DKC-060) | Real + Contract + Integration | `make feature-access-check`<br>`make feature-access-demo`<br>`make feature-access-test`<br>`true`<br>`true` | ✔ PASS | NOT RUN integration-idp-offboarding: Der er ingen rigtig IdP eller tokenudbyder i dette miljø. De fem rettighedsklasser lukkes lokalt i et holdbart lager; en rigtig IdP-tilbagekaldelse er NOT RUN.<br>NOT RUN integration-reporting-delivery: Der findes ingen rigtig SMTP-/filshare-/portalmodtager i dette miljø. Revalidering ved kørsel og afsendelse er efterprøvet lokalt; en rigtig leveringskanal er NOT RUN. |
| Yderligere adaptere (IAM) | Mock + Integration | `make iam-adapter-evidence`<br>`make iam-adapter-test`<br>`make iam-adapter-run` | ✔ PASS | Beviset gælder adfærd mod mock; rigtig Keycloak/Authentik er en separat integration (NOT RUN). Skriver ikke-idempotente fixtures.<br>Testes mod mock Keycloak, ikke en rigtig IAM-instans.<br>NOT RUN integration-keycloak: Ingen IAM-instans i dette miljø. Kun mock-adfærd er bevist. |

### Bølge 4.1

| Komponent | Niveau | Testkommando | Resultat | Åbne mangler |
| --- | --- | --- | --- | --- |
| Ejer-curriculum | Real | `make curriculum-check`<br>`make curriculum-test` | ✔ PASS | — |

### Bølge 4.3

| Komponent | Niveau | Testkommando | Resultat | Åbne mangler |
| --- | --- | --- | --- | --- |
| Pitch / LinkedIn | Real | `make pitch-check`<br>`make pitch-test` | ✔ PASS | — |

### Bølge CI

| Komponent | Niveau | Testkommando | Resultat | Åbne mangler |
| --- | --- | --- | --- | --- |
| CI og reproducerbar baselinekontrol | Integration | `gh workflow run Supply chain` | • NOT RUN | NOT RUN integration-github-actions: Actions er slået fra på repo-niveau, og det gamle ci.yml blev fjernet i commit 76e4782. Workflows for release-gate, DCO og forsyningskæde er konfiguration; kun lokal `make ci`/`make baseline` kan køres. |

## Rå checkliste

| Check | Komponent | Niveau | Status | Exit | Varighed (ms) | Log |
| --- | --- | --- | --- | --- | --- | --- |
| validate | repo-skeleton | contract | PASS | 0 | 2456 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/validate.log` |
| lint | repo-skeleton | contract | PASS | 0 | 235 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/lint.log` |
| test | conformance-suite | real | PASS | 0 | 4002 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/test.log` |
| identity-test | identity-verification | real | PASS | 0 | 860 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/identity-test.log` |
| approval-test | approvals | real | PASS | 0 | 864 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/approval-test.log` |
| approval-check | approvals | contract | PASS | 0 | 298 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/approval-check.log` |
| architecture-test | architecture-contracts | real | PASS | 0 | 969 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/architecture-test.log` |
| continuity-check | continuity | contract | PASS | 0 | 549 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/continuity-check.log` |
| continuity-test | continuity | real | PASS | 0 | 1901 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/continuity-test.log` |
| backup-check | backup | contract | PASS | 0 | 396 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/backup-check.log` |
| backup-test | backup | real | PASS | 0 | 1168 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/backup-test.log` |
| integration-backup-production-drill | backup | integration | NOT RUN | — | 0 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/integration-backup-production-drill.log` |
| backup-target-check | backup-targets | contract | PASS | 0 | 392 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/backup-target-check.log` |
| backup-target-test | backup-targets | mock | PASS | 0 | 1150 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/backup-target-test.log` |
| integration-backup-external-target | backup-targets | integration | NOT RUN | — | 0 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/integration-backup-external-target.log` |
| distribution-check | distribution | contract | PASS | 0 | 484 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/distribution-check.log` |
| distribution-test | distribution | real | PASS | 0 | 1358 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/distribution-test.log` |
| distribution-preview | distribution | real | PASS | 0 | 176 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/distribution-preview.log` |
| release-check | release-gates | contract | PASS | 0 | 322 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/release-check.log` |
| release-test | release-gates | real | PASS | 0 | 1589 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/release-test.log` |
| supply-chain-check | supply-chain | contract | PASS | 0 | 417 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/supply-chain-check.log` |
| supply-chain-test | supply-chain | real | PASS | 0 | 588 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/supply-chain-test.log` |
| supply-chain-vuln-check | supply-chain | real | PASS | 0 | 174 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/supply-chain-vuln-check.log` |
| infrastructure-check | staging | contract | PASS | 0 | 307 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/infrastructure-check.log` |
| infrastructure-test | staging | real | PASS | 0 | 499 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/infrastructure-test.log` |
| infrastructure-verify | staging | real | PASS | 0 | 184 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/infrastructure-verify.log` |
| infrastructure-iac-check | staging | real | PASS | 0 | 188 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/infrastructure-iac-check.log` |
| evidence-mode-check | evidence-modes | contract | PASS | 0 | 283 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/evidence-mode-check.log` |
| evidence-mode-test | evidence-modes | real | PASS | 0 | 1065 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/evidence-mode-test.log` |
| vulnerability-check | vulnerability-management | contract | PASS | 0 | 311 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/vulnerability-check.log` |
| vulnerability-test | vulnerability-management | real | PASS | 0 | 872 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/vulnerability-test.log` |
| adapter-sdk-check | adapter-sdk | contract | PASS | 0 | 456 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/adapter-sdk-check.log` |
| adapter-sdk-test | adapter-sdk | real | PASS | 0 | 1985 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/adapter-sdk-test.log` |
| adapter-live-check | adapter-live | contract | PASS | 0 | 364 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/adapter-live-check.log` |
| adapter-live-test | adapter-live | real | PASS | 0 | 1148 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/adapter-live-test.log` |
| privacy-check | privacy | contract | PASS | 0 | 154 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/privacy-check.log` |
| privacy-test | privacy | real | PASS | 0 | 1358 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/privacy-test.log` |
| tenant-test | tenant-isolation | real | PASS | 0 | 3625 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/tenant-test.log` |
| tenant-check | tenant-isolation | contract | PASS | 0 | 276 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/tenant-check.log` |
| policy-test | policy | real | PASS | 0 | 538 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/policy-test.log` |
| policy-verify | policy | real | PASS | 0 | 168 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/policy-verify.log` |
| policy-decide | policy | real | PASS | 0 | 177 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/policy-decide.log` |
| gitops-test | gitops | real | PASS | 0 | 411 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/gitops-test.log` |
| gitops-verify | gitops | real | PASS | 0 | 164 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/gitops-verify.log` |
| gitops-reconcile | gitops | fixture | PASS | 0 | 148 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/gitops-reconcile.log` |
| gitops-drift | gitops | fixture | PASS | 0 | 131 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/gitops-drift.log` |
| changelog-check | gitops | real | FAIL | 2 | 188 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/changelog-check.log` |
| changelog | gitops | real | PASS | 0 | 192 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/changelog.log` |
| audit-service-test | audit-service | real | PASS | 0 | 609 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/audit-service-test.log` |
| audit-service-evidence | audit-service | real | PASS | 0 | 299 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/audit-service-evidence.log` |
| adapter-test | mattermost-adapter | mock | PASS | 0 | 510 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/adapter-test.log` |
| adapter-evidence | mattermost-adapter | mock | PASS | 0 | 284 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/adapter-evidence.log` |
| iam-adapter-test | iam-adapter | mock | PASS | 0 | 460 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/iam-adapter-test.log` |
| iam-adapter-evidence | iam-adapter | mock | PASS | 0 | 276 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/iam-adapter-evidence.log` |
| gateway-test | ai-gateway | mock | PASS | 0 | 514 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/gateway-test.log` |
| gateway-check | ai-gateway | contract | PASS | 0 | 144 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/gateway-check.log` |
| model-gateway-test | ai-gateway | real | PASS | 0 | 1250 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/model-gateway-test.log` |
| budget-test | ai-gateway | real | PASS | 0 | 354 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/budget-test.log` |
| model-egress-check | ai-gateway | real | PASS | 0 | 134 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/model-egress-check.log` |
| runtime-test | agent-runtime | real | PASS | 0 | 578 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/runtime-test.log` |
| boundary-test | agent-runtime | real | PASS | 0 | 377 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/boundary-test.log` |
| persistence-test | persistence | real | PASS | 0 | 1309 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/persistence-test.log` |
| persistence-check | persistence | contract | PASS | 0 | 249 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/persistence-check.log` |
| db-ha-check | database-ha | contract | PASS | 0 | 289 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/db-ha-check.log` |
| db-ha-test | database-ha | real | PASS | 0 | 1238 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/db-ha-test.log` |
| db-ha-drill | database-ha | real | PASS | 0 | 186 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/db-ha-drill.log` |
| integration-db-failover | database-ha | integration | NOT RUN | — | 0 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/integration-db-failover.log` |
| storage-check | storage | contract | PASS | 0 | 312 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/storage-check.log` |
| storage-test | storage | real | PASS | 0 | 1326 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/storage-test.log` |
| storage-drill | storage | real | PASS | 0 | 231 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/storage-drill.log` |
| integration-storage-live | storage | integration | NOT RUN | — | 0 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/integration-storage-live.log` |
| audit-durability-test | audit-durability | real | PASS | 0 | 1597 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/audit-durability-test.log` |
| audit-durability-check | audit-durability | contract | PASS | 0 | 170 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/audit-durability-check.log` |
| credentials-test | credentials | real | PASS | 0 | 1740 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/credentials-test.log` |
| credentials-check | credentials | contract | PASS | 0 | 167 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/credentials-check.log` |
| tool-boundary-test | tool-boundary | real | PASS | 0 | 659 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/tool-boundary-test.log` |
| tool-boundary-check | tool-boundary | contract | PASS | 0 | 122 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/tool-boundary-check.log` |
| jobs-test | jobs | real | PASS | 0 | 861 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/jobs-test.log` |
| jobs-check | jobs | contract | PASS | 0 | 151 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/jobs-check.log` |
| messaging-check | messaging | contract | PASS | 0 | 409 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/messaging-check.log` |
| messaging-test | messaging | real | PASS | 0 | 1529 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/messaging-test.log` |
| integration-message-broker | messaging | integration | NOT RUN | — | 0 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/integration-message-broker.log` |
| agent-registry-test | agent-registry | real | PASS | 0 | 397 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/agent-registry-test.log` |
| agent-registry-check | agent-registry | contract | PASS | 0 | 132 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/agent-registry-check.log` |
| agent-conformance-test | agent-conformance | real | PASS | 0 | 387 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/agent-conformance-test.log` |
| reviewer-test | reviewer | real | PASS | 0 | 442 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/reviewer-test.log` |
| reviewer-metrics | reviewer-metrics | real | NOT RUN | — | 0 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/reviewer-metrics.log` |
| compliance-test | control-mapping | real | PASS | 0 | 856 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/compliance-test.log` |
| compliance-check | control-mapping | real | PASS | 0 | 295 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/compliance-check.log` |
| data-register-check | data-register | contract | PASS | 0 | 595 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/data-register-check.log` |
| data-register-test | data-register | real | PASS | 0 | 1894 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/data-register-test.log` |
| data-protection-check | data-protection | contract | PASS | 0 | 636 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/data-protection-check.log` |
| data-protection-test | data-protection | real | PASS | 0 | 1851 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/data-protection-test.log` |
| immutable-check | immutable-enforcement | contract | PASS | 0 | 400 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/immutable-check.log` |
| immutable-test | immutable-enforcement | real | PASS | 0 | 1613 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/immutable-test.log` |
| integration-immutable-live | immutable-enforcement | integration | NOT RUN | — | 0 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/integration-immutable-live.log` |
| retention-check | retention | contract | PASS | 0 | 444 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/retention-check.log` |
| retention-test | retention | real | PASS | 0 | 2124 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/retention-test.log` |
| integration-retention-live | retention | integration | NOT RUN | — | 0 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/integration-retention-live.log` |
| data-services-check | data-services | contract | PASS | 0 | 780 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/data-services-check.log` |
| data-services-test | data-services | real | PASS | 0 | 2469 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/data-services-test.log` |
| observability-test | observability | real | PASS | 0 | 374 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/observability-test.log` |
| observability-check | observability | real | PASS | 0 | 116 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/observability-check.log` |
| security-test | security-plan | real | PASS | 0 | 516 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/security-test.log` |
| security-check | security-plan | fixture | PASS | 0 | 276 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/security-check.log` |
| monitoring-check | monitoring | contract | PASS | 0 | 307 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/monitoring-check.log` |
| monitoring-test | monitoring | real | PASS | 0 | 706 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/monitoring-test.log` |
| monitoring-drill | monitoring | real | PASS | 0 | 190 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/monitoring-drill.log` |
| integration-monitoring-backend | monitoring | integration | NOT RUN | — | 0 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/integration-monitoring-backend.log` |
| integration-alert-delivery | monitoring | integration | NOT RUN | — | 0 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/integration-alert-delivery.log` |
| telemetry-api-check | telemetry-api | contract | PASS | 0 | 314 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/telemetry-api-check.log` |
| telemetry-api-test | telemetry-api | real | PASS | 0 | 1740 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/telemetry-api-test.log` |
| telemetry-api-demo | telemetry-api | real | PASS | 0 | 224 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/telemetry-api-demo.log` |
| integration-telemetry-backend | telemetry-api | integration | NOT RUN | — | 0 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/integration-telemetry-backend.log` |
| integration-dashboard-adapter | telemetry-api | integration | NOT RUN | — | 0 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/integration-dashboard-adapter.log` |
| feature-access-check | feature-access | contract | PASS | 0 | 646 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/feature-access-check.log` |
| feature-access-test | feature-access | real | PASS | 0 | 1716 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/feature-access-test.log` |
| feature-access-demo | feature-access | real | PASS | 0 | 175 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/feature-access-demo.log` |
| integration-reporting-delivery | feature-access | integration | NOT RUN | — | 0 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/integration-reporting-delivery.log` |
| integration-idp-offboarding | feature-access | integration | NOT RUN | — | 0 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/integration-idp-offboarding.log` |
| ha-check | ha-cluster | contract | PASS | 0 | 304 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/ha-check.log` |
| ha-test | ha-cluster | real | PASS | 0 | 1251 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/ha-test.log` |
| ha-drill | ha-cluster | real | PASS | 0 | 168 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/ha-drill.log` |
| integration-ha-failover | ha-cluster | integration | NOT RUN | — | 0 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/integration-ha-failover.log` |
| integration-network-policy-plugin | ha-cluster | integration | NOT RUN | — | 0 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/integration-network-policy-plugin.log` |
| curriculum-test | curriculum | real | PASS | 0 | 700 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/curriculum-test.log` |
| curriculum-check | curriculum | real | PASS | 0 | 338 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/curriculum-check.log` |
| pitch-test | pitch | real | PASS | 0 | 290 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/pitch-test.log` |
| pitch-check | pitch | real | PASS | 0 | 124 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/pitch-check.log` |
| conform-all | conformance-suite | real | PASS | 0 | 393 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/conform-all.log` |
| oscal-evidence | oscal-evidence | real | PASS | 0 | 1092 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/oscal-evidence.log` |
| evidence-test | oscal-evidence | real | PASS | 0 | 1730 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/evidence-test.log` |
| conform-negative | conformance-suite | fixture | PASS | 0 | 340 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/conform-negative.log` |
| dsar-demo | privacy-verbs | fixture | PASS | 0 | 283 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/dsar-demo.log` |
| telemetry-test | telemetry-plan | real | PASS | 0 | 687 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/telemetry-test.log` |
| integration-trivy | security-plan | integration | NOT RUN | — | 0 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/integration-trivy.log` |
| integration-falco | security-plan | integration | NOT RUN | — | 0 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/integration-falco.log` |
| integration-wazuh | security-plan | integration | NOT RUN | — | 0 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/integration-wazuh.log` |
| integration-mattermost | mattermost-adapter | integration | NOT RUN | — | 0 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/integration-mattermost.log` |
| integration-keycloak | iam-adapter | integration | NOT RUN | — | 0 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/integration-keycloak.log` |
| integration-adapter-live | adapter-live | integration | NOT RUN | — | 0 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/integration-adapter-live.log` |
| integration-privacy-live | privacy | integration | NOT RUN | — | 0 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/integration-privacy-live.log` |
| integration-llm | ai-gateway | integration | NOT RUN | — | 0 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/integration-llm.log` |
| integration-oidc | identity-plan | integration | NOT RUN | — | 0 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/integration-oidc.log` |
| integration-continuity-measurement | continuity | integration | NOT RUN | — | 0 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/integration-continuity-measurement.log` |
| integration-postgresql | data-services | integration | NOT RUN | — | 0 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/integration-postgresql.log` |
| integration-github-actions | ci | integration | NOT RUN | — | 0 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/integration-github-actions.log` |
| integration-container-build | supply-chain | integration | NOT RUN | — | 0 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/integration-container-build.log` |
| integration-staging-drift | staging | integration | NOT RUN | — | 0 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/integration-staging-drift.log` |
| integration-staging-provision | staging | integration | NOT RUN | — | 0 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/integration-staging-provision.log` |
| evidence-probe-staging | evidence-modes | integration | NOT RUN | — | 0 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/evidence-probe-staging.log` |
| integration-vulnerability-scan | vulnerability-management | integration | NOT RUN | — | 0 | `/tmp/dkc-work/00-core/.conformance-out/baseline/logs/integration-vulnerability-scan.log` |

---

Filen genereres på ny med `make baseline`. Historiske bølger bevares i [BACKLOG.md](../../BACKLOG.md), og en `NOT RUN`-linje må ikke læses som en godkendelse.
