# Implementation matrix — faktisk modenhed pr. komponent

> Genereret af `tools/baseline/baseline.mjs` fra en konkret kørsel. Denne fil erstatter ikke de historiske bølger i [BACKLOG.md](../../BACKLOG.md); den supplerer dem med, hvad der faktisk kan efterprøves i en ren checkout.

**Genereret:** 2026-09-23T11:36:29.488Z · **Commit:** `83ad91a` · **Node:** v22.22.1 · **CI:** nej

**Resultat:** FAIL — 54 pass, 1 fail, 9 not run, 0 error (64 checks).

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
| Dirty worktree | ja (147 filer) |
| Node / npm | v22.22.1 / 9.2.0 |
| Platform | linux x64 (6.18.33.2-microsoft-standard-WSL2) |
| CI | nej |
| Evidens | `/tmp/dkc-011/00-core/.conformance-out/baseline/runs/2026-09-23T11-36-29-488Z-83ad91a.json` |

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
| Fejl hvis commits mangler DCO sign-off | `make changelog-check` | 2 | `/tmp/dkc-011/00-core/.conformance-out/baseline/logs/changelog-check.log` |

## NOT RUN (kræver eksternt system, værktøj eller er langtkørende)

Disse checks er **ikke** kørt, og deres manglende bevis indgår ikke som PASS.

| Check | Kommando | Grund |
| --- | --- | --- |
| Reviewer-effektmålings-dashboard (langtkørende server) | `make reviewer-metrics` | Starter en HTTP-server på 127.0.0.1:8484 og terminerer ikke; det er ikke en afsluttende check. Effektmålingen er dækket af reviewer-test. |
| Trivy filesystem-scan (rigtigt værktøj) | `trivy fs --severity CRITICAL,HIGH .` | Trivy er ikke installeret i dette miljø; CI-workflowet er fjernet. Sample-data dækker kun normaliseringen. |
| Falco runtime-regler i en klynge | `falco -r security/falco/platform-rules.yaml` | Kræver en levende container-runtime/klynge. Reglerne er kun konfiguration i repoet. |
| Wazuh SIEM-regler i en klynge | `wazuh -t -r security/wazuh/local_rules.xml` | Kræver en levende SIEM-installation. Reglerne er kun konfiguration i repoet. |
| Rigtig Mattermost-installation | `make adapter-run` | Ingen MATTERMOST_URL/credentials i dette miljø. Kun mock-adfærd er bevist. |
| Rigtig Keycloak/Authentik-instans | `make iam-adapter-run` | Ingen IAM-instans i dette miljø. Kun mock-adfærd er bevist. |
| Rigtig modelleverandør gennem AI-gateway | `make gateway-run` | Kun echo-provider findes; ingen leverandørnøgle/-endpoint er konfigureret. |
| Rigtig OIDC-identitetsudbyder | `make runtime-demo` | Identitet er kontraktvalideret og simuleret; ingen rigtig IdP er koblet på. |
| GitHub Actions CI | `gh workflow run CI` | Workflowet blev fjernet i commit 76e4782, og Actions er slået fra på repo-niveau. Kun lokal `make ci`/`make baseline` kan køres. |

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
| AI-gatewayens tests (routing, budget, modelversion) | Mock | `make gateway-test` |
| Agent-runtime tests (grænsevalidering, miljø/scope/datakategori, A4-klassifikation, digest-bundet evidens, budget, loop, JIT, godkendelser) | Real | `make runtime-test` |
| Runtimegrænse og fælles klassifikation (PDP-binding, miljø/scope/datakategori, A4-aliaser, evidensdigest) | Real | `make boundary-test` |
| Holdbar tilstand: versionerede migrationer, genstart, samtidige writes, tenantgrænser og backup/restore (DKC-008) | Real | `make persistence-test` |
| Persistensskema, migrationer, tenant-views og databaseidentiteter valideres | Contract | `make persistence-check` |
| Holdbar audit: intent/outcome, idempotens, reconciliation, checkpoint, roller og genstart (DKC-009) | Real | `make audit-durability-test` |
| Audit-skrive-/læserroller, eksternt checkpoint og secret-redaktion valideres | Contract | `make audit-durability-check` |
| Kortlivede, scope-bundne rettigheder, tilbagekaldelse og nødstop (DKC-010) | Real | `make credentials-test` |
| Signerer, JWKS, holdbar tilbagekaldelse/nødstop og A4-afvisning valideres | Contract | `make credentials-check` |
| Servervaliderede typede værktøjer, egress og flersproget injection-korpus (DKC-011) | Real | `make tool-boundary-test` |
| Værktøjsallowlist, parametre, størrelsesgrænser, egress og korpusdækning valideres | Contract | `make tool-boundary-check` |
| Præcis én uforanderlig rolle pr. agent (roller, register, handoff, scheduler, runtime-vagt) | Real | `make agent-registry-test` |
| Alle agent-manifester har præcis én gyldig rolle | Contract | `make agent-registry-check` |
| De seks agent-konformanstests | Real | `make agent-conformance-test` |
| Reviewer-agent og effektmåling | Real | `make reviewer-test` |
| Kontrolmappingens tests | Real | `make compliance-test` |
| Kontrolmapping i sync med registry | Real | `make compliance-check` |
| Observability-generatorens tests | Real | `make observability-test` |
| Dashboards i sync med modulernes SLO | Real | `make observability-check` |
| Sikkerhedsnormaliseringens tests | Real | `make security-test` |
| Sikkerhedsfund validerer og er i sync med rådata | Fixture | `make security-check` |
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

### Bølge 2.2

| Komponent | Niveau | Testkommando | Resultat | Åbne mangler |
| --- | --- | --- | --- | --- |
| AI-gateway | Mock + Integration | `make gateway-test`<br>`make gateway-run` | ✔ PASS | Provideren er en echo-stub; ingen rigtig modelleverandør er koblet på (NOT RUN).<br>NOT RUN integration-llm: Kun echo-provider findes; ingen leverandørnøgle/-endpoint er konfigureret. |

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

### Bølge 2.5

| Komponent | Niveau | Testkommando | Resultat | Åbne mangler |
| --- | --- | --- | --- | --- |
| Adversarial reviewer-agent | Real | `make reviewer-test` | ✔ PASS | — |

### Bølge 2.6

| Komponent | Niveau | Testkommando | Resultat | Åbne mangler |
| --- | --- | --- | --- | --- |
| Agent-konformanstests (seks) | Real | `make agent-conformance-test` | ✔ PASS | — |

### Bølge 2.7

| Komponent | Niveau | Testkommando | Resultat | Åbne mangler |
| --- | --- | --- | --- | --- |
| Reviewer-effektmåling | Real | `make reviewer-metrics` | • NOT RUN | NOT RUN reviewer-metrics: Starter en HTTP-server på 127.0.0.1:8484 og terminerer ikke; det er ikke en afsluttende check. Effektmålingen er dækket af reviewer-test. |

### Bølge 3.1

| Komponent | Niveau | Testkommando | Resultat | Åbne mangler |
| --- | --- | --- | --- | --- |
| Compliance-evidens-emitter (OSCAL) | Real | `make evidence-test`<br>`make oscal-evidence` | ✔ PASS | — |

### Bølge 3.2

| Komponent | Niveau | Testkommando | Resultat | Åbne mangler |
| --- | --- | --- | --- | --- |
| Kontrolmapping NIS2/GDPR/AI Act | Real | `make compliance-check`<br>`make compliance-test` | ✔ PASS | — |

### Bølge 3.3

| Komponent | Niveau | Testkommando | Resultat | Åbne mangler |
| --- | --- | --- | --- | --- |
| Ops-dashboards (Prometheus/Grafana/Loki) | Real | `make observability-check`<br>`make observability-test` | ✔ PASS | — |

### Bølge 3.4

| Komponent | Niveau | Testkommando | Resultat | Åbne mangler |
| --- | --- | --- | --- | --- |
| Security-plan (Trivy/Falco/Wazuh) | Real + Fixture + Integration | `falco -r security/falco/platform-rules.yaml`<br>`trivy fs --severity CRITICAL,HIGH .`<br>`wazuh -t -r security/wazuh/local_rules.xml`<br>`make security-check`<br>`make security-test` | ✔ PASS | NOT RUN integration-falco: Kræver en levende container-runtime/klynge. Reglerne er kun konfiguration i repoet.<br>NOT RUN integration-trivy: Trivy er ikke installeret i dette miljø; CI-workflowet er fjernet. Sample-data dækker kun normaliseringen.<br>NOT RUN integration-wazuh: Kræver en levende SIEM-installation. Reglerne er kun konfiguration i repoet.<br>Rådata er committede samples; ingen rigtig Trivy/Falco/Wazuh-kørsel indgår (NOT RUN). |

### Bølge 4.1

| Komponent | Niveau | Testkommando | Resultat | Åbne mangler |
| --- | --- | --- | --- | --- |
| Ejer-curriculum | Real | `make curriculum-check`<br>`make curriculum-test` | ✔ PASS | — |

### Bølge 4.2

| Komponent | Niveau | Testkommando | Resultat | Åbne mangler |
| --- | --- | --- | --- | --- |
| Yderligere adaptere (IAM) | Mock + Integration | `make iam-adapter-evidence`<br>`make iam-adapter-test`<br>`make iam-adapter-run` | ✔ PASS | Beviset gælder adfærd mod mock; rigtig Keycloak/Authentik er en separat integration (NOT RUN). Skriver ikke-idempotente fixtures.<br>Testes mod mock Keycloak, ikke en rigtig IAM-instans.<br>NOT RUN integration-keycloak: Ingen IAM-instans i dette miljø. Kun mock-adfærd er bevist. |

### Bølge 4.3

| Komponent | Niveau | Testkommando | Resultat | Åbne mangler |
| --- | --- | --- | --- | --- |
| Pitch / LinkedIn | Real | `make pitch-check`<br>`make pitch-test` | ✔ PASS | — |

### Bølge CI

| Komponent | Niveau | Testkommando | Resultat | Åbne mangler |
| --- | --- | --- | --- | --- |
| CI og reproducerbar baselinekontrol | Integration | `gh workflow run CI` | • NOT RUN | NOT RUN integration-github-actions: Workflowet blev fjernet i commit 76e4782, og Actions er slået fra på repo-niveau. Kun lokal `make ci`/`make baseline` kan køres. |

## Rå checkliste

| Check | Komponent | Niveau | Status | Exit | Varighed (ms) | Log |
| --- | --- | --- | --- | --- | --- | --- |
| validate | repo-skeleton | contract | PASS | 0 | 587 | `/tmp/dkc-011/00-core/.conformance-out/baseline/logs/validate.log` |
| lint | repo-skeleton | contract | PASS | 0 | 179 | `/tmp/dkc-011/00-core/.conformance-out/baseline/logs/lint.log` |
| test | conformance-suite | real | PASS | 0 | 1023 | `/tmp/dkc-011/00-core/.conformance-out/baseline/logs/test.log` |
| identity-test | identity-verification | real | PASS | 0 | 742 | `/tmp/dkc-011/00-core/.conformance-out/baseline/logs/identity-test.log` |
| approval-test | approvals | real | PASS | 0 | 835 | `/tmp/dkc-011/00-core/.conformance-out/baseline/logs/approval-test.log` |
| approval-check | approvals | contract | PASS | 0 | 269 | `/tmp/dkc-011/00-core/.conformance-out/baseline/logs/approval-check.log` |
| architecture-test | architecture-contracts | real | PASS | 0 | 760 | `/tmp/dkc-011/00-core/.conformance-out/baseline/logs/architecture-test.log` |
| tenant-test | tenant-isolation | real | PASS | 0 | 2931 | `/tmp/dkc-011/00-core/.conformance-out/baseline/logs/tenant-test.log` |
| tenant-check | tenant-isolation | contract | PASS | 0 | 225 | `/tmp/dkc-011/00-core/.conformance-out/baseline/logs/tenant-check.log` |
| policy-test | policy | real | PASS | 0 | 453 | `/tmp/dkc-011/00-core/.conformance-out/baseline/logs/policy-test.log` |
| policy-verify | policy | real | PASS | 0 | 164 | `/tmp/dkc-011/00-core/.conformance-out/baseline/logs/policy-verify.log` |
| policy-decide | policy | real | PASS | 0 | 172 | `/tmp/dkc-011/00-core/.conformance-out/baseline/logs/policy-decide.log` |
| gitops-test | gitops | real | PASS | 0 | 365 | `/tmp/dkc-011/00-core/.conformance-out/baseline/logs/gitops-test.log` |
| gitops-verify | gitops | real | PASS | 0 | 127 | `/tmp/dkc-011/00-core/.conformance-out/baseline/logs/gitops-verify.log` |
| gitops-reconcile | gitops | fixture | PASS | 0 | 126 | `/tmp/dkc-011/00-core/.conformance-out/baseline/logs/gitops-reconcile.log` |
| gitops-drift | gitops | fixture | PASS | 0 | 133 | `/tmp/dkc-011/00-core/.conformance-out/baseline/logs/gitops-drift.log` |
| changelog-check | gitops | real | FAIL | 2 | 193 | `/tmp/dkc-011/00-core/.conformance-out/baseline/logs/changelog-check.log` |
| changelog | gitops | real | PASS | 0 | 195 | `/tmp/dkc-011/00-core/.conformance-out/baseline/logs/changelog.log` |
| audit-service-test | audit-service | real | PASS | 0 | 608 | `/tmp/dkc-011/00-core/.conformance-out/baseline/logs/audit-service-test.log` |
| audit-service-evidence | audit-service | real | PASS | 0 | 291 | `/tmp/dkc-011/00-core/.conformance-out/baseline/logs/audit-service-evidence.log` |
| adapter-test | mattermost-adapter | mock | PASS | 0 | 435 | `/tmp/dkc-011/00-core/.conformance-out/baseline/logs/adapter-test.log` |
| adapter-evidence | mattermost-adapter | mock | PASS | 0 | 275 | `/tmp/dkc-011/00-core/.conformance-out/baseline/logs/adapter-evidence.log` |
| iam-adapter-test | iam-adapter | mock | PASS | 0 | 444 | `/tmp/dkc-011/00-core/.conformance-out/baseline/logs/iam-adapter-test.log` |
| iam-adapter-evidence | iam-adapter | mock | PASS | 0 | 279 | `/tmp/dkc-011/00-core/.conformance-out/baseline/logs/iam-adapter-evidence.log` |
| gateway-test | ai-gateway | mock | PASS | 0 | 452 | `/tmp/dkc-011/00-core/.conformance-out/baseline/logs/gateway-test.log` |
| runtime-test | agent-runtime | real | PASS | 0 | 491 | `/tmp/dkc-011/00-core/.conformance-out/baseline/logs/runtime-test.log` |
| boundary-test | agent-runtime | real | PASS | 0 | 368 | `/tmp/dkc-011/00-core/.conformance-out/baseline/logs/boundary-test.log` |
| persistence-test | persistence | real | PASS | 0 | 1051 | `/tmp/dkc-011/00-core/.conformance-out/baseline/logs/persistence-test.log` |
| persistence-check | persistence | contract | PASS | 0 | 169 | `/tmp/dkc-011/00-core/.conformance-out/baseline/logs/persistence-check.log` |
| audit-durability-test | audit-durability | real | PASS | 0 | 1466 | `/tmp/dkc-011/00-core/.conformance-out/baseline/logs/audit-durability-test.log` |
| audit-durability-check | audit-durability | contract | PASS | 0 | 153 | `/tmp/dkc-011/00-core/.conformance-out/baseline/logs/audit-durability-check.log` |
| credentials-test | credentials | real | PASS | 0 | 1675 | `/tmp/dkc-011/00-core/.conformance-out/baseline/logs/credentials-test.log` |
| credentials-check | credentials | contract | PASS | 0 | 145 | `/tmp/dkc-011/00-core/.conformance-out/baseline/logs/credentials-check.log` |
| tool-boundary-test | tool-boundary | real | PASS | 0 | 649 | `/tmp/dkc-011/00-core/.conformance-out/baseline/logs/tool-boundary-test.log` |
| tool-boundary-check | tool-boundary | contract | PASS | 0 | 125 | `/tmp/dkc-011/00-core/.conformance-out/baseline/logs/tool-boundary-check.log` |
| agent-registry-test | agent-registry | real | PASS | 0 | 381 | `/tmp/dkc-011/00-core/.conformance-out/baseline/logs/agent-registry-test.log` |
| agent-registry-check | agent-registry | contract | PASS | 0 | 123 | `/tmp/dkc-011/00-core/.conformance-out/baseline/logs/agent-registry-check.log` |
| agent-conformance-test | agent-conformance | real | PASS | 0 | 363 | `/tmp/dkc-011/00-core/.conformance-out/baseline/logs/agent-conformance-test.log` |
| reviewer-test | reviewer | real | PASS | 0 | 424 | `/tmp/dkc-011/00-core/.conformance-out/baseline/logs/reviewer-test.log` |
| reviewer-metrics | reviewer-metrics | real | NOT RUN | — | 0 | `/tmp/dkc-011/00-core/.conformance-out/baseline/logs/reviewer-metrics.log` |
| compliance-test | control-mapping | real | PASS | 0 | 537 | `/tmp/dkc-011/00-core/.conformance-out/baseline/logs/compliance-test.log` |
| compliance-check | control-mapping | real | PASS | 0 | 235 | `/tmp/dkc-011/00-core/.conformance-out/baseline/logs/compliance-check.log` |
| observability-test | observability | real | PASS | 0 | 295 | `/tmp/dkc-011/00-core/.conformance-out/baseline/logs/observability-test.log` |
| observability-check | observability | real | PASS | 0 | 121 | `/tmp/dkc-011/00-core/.conformance-out/baseline/logs/observability-check.log` |
| security-test | security-plan | real | PASS | 0 | 466 | `/tmp/dkc-011/00-core/.conformance-out/baseline/logs/security-test.log` |
| security-check | security-plan | fixture | PASS | 0 | 243 | `/tmp/dkc-011/00-core/.conformance-out/baseline/logs/security-check.log` |
| curriculum-test | curriculum | real | PASS | 0 | 613 | `/tmp/dkc-011/00-core/.conformance-out/baseline/logs/curriculum-test.log` |
| curriculum-check | curriculum | real | PASS | 0 | 302 | `/tmp/dkc-011/00-core/.conformance-out/baseline/logs/curriculum-check.log` |
| pitch-test | pitch | real | PASS | 0 | 281 | `/tmp/dkc-011/00-core/.conformance-out/baseline/logs/pitch-test.log` |
| pitch-check | pitch | real | PASS | 0 | 112 | `/tmp/dkc-011/00-core/.conformance-out/baseline/logs/pitch-check.log` |
| conform-all | conformance-suite | real | PASS | 0 | 345 | `/tmp/dkc-011/00-core/.conformance-out/baseline/logs/conform-all.log` |
| oscal-evidence | oscal-evidence | real | PASS | 0 | 959 | `/tmp/dkc-011/00-core/.conformance-out/baseline/logs/oscal-evidence.log` |
| evidence-test | oscal-evidence | real | PASS | 0 | 1549 | `/tmp/dkc-011/00-core/.conformance-out/baseline/logs/evidence-test.log` |
| conform-negative | conformance-suite | fixture | PASS | 0 | 304 | `/tmp/dkc-011/00-core/.conformance-out/baseline/logs/conform-negative.log` |
| dsar-demo | privacy-verbs | fixture | PASS | 0 | 240 | `/tmp/dkc-011/00-core/.conformance-out/baseline/logs/dsar-demo.log` |
| telemetry-test | telemetry-plan | real | PASS | 0 | 588 | `/tmp/dkc-011/00-core/.conformance-out/baseline/logs/telemetry-test.log` |
| integration-trivy | security-plan | integration | NOT RUN | — | 0 | `/tmp/dkc-011/00-core/.conformance-out/baseline/logs/integration-trivy.log` |
| integration-falco | security-plan | integration | NOT RUN | — | 0 | `/tmp/dkc-011/00-core/.conformance-out/baseline/logs/integration-falco.log` |
| integration-wazuh | security-plan | integration | NOT RUN | — | 0 | `/tmp/dkc-011/00-core/.conformance-out/baseline/logs/integration-wazuh.log` |
| integration-mattermost | mattermost-adapter | integration | NOT RUN | — | 0 | `/tmp/dkc-011/00-core/.conformance-out/baseline/logs/integration-mattermost.log` |
| integration-keycloak | iam-adapter | integration | NOT RUN | — | 0 | `/tmp/dkc-011/00-core/.conformance-out/baseline/logs/integration-keycloak.log` |
| integration-llm | ai-gateway | integration | NOT RUN | — | 0 | `/tmp/dkc-011/00-core/.conformance-out/baseline/logs/integration-llm.log` |
| integration-oidc | identity-plan | integration | NOT RUN | — | 0 | `/tmp/dkc-011/00-core/.conformance-out/baseline/logs/integration-oidc.log` |
| integration-github-actions | ci | integration | NOT RUN | — | 0 | `/tmp/dkc-011/00-core/.conformance-out/baseline/logs/integration-github-actions.log` |

---

Filen genereres på ny med `make baseline`. Historiske bølger bevares i [BACKLOG.md](../../BACKLOG.md), og en `NOT RUN`-linje må ikke læses som en godkendelse.
