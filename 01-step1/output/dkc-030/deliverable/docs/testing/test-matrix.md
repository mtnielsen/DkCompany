# Testmatrix (DKC-063)

> Genereret fra `release/matrix/test-matrix.json` (matrixversion 1.38.0). Hvert obligatoriske krav mapper til navngivne checks eller til en eksplicit udestående uafhængig vurdering.

**Ejer:** Anna Andersen · **Tærskler accepteret af:** Anna Andersen (2026-09-23T08:00:00Z)
**Freshness:** standard 30 dage, maks 90 dage
**Tærskler:** alle obligatoriske skal bestå = ja · maks åbne undtagelser = 0 · implementørevidens til release = nej

## Understøttede miljøer

`linux-amd64-node22`, `linux-arm64-node22`, `windows-wsl2-amd64-node22`

## CI-trin

| Trin | Blokerer | Kommandoer |
| --- | --- | --- |
| Kontrakt og lint (`contract`) | ja | `make validate`<br>`make lint`<br>`make release-check`<br>`make messaging-check` |
| Enheds- og konformanstests (`unit`) | ja | `make test`<br>`make boundary-test`<br>`make persistence-test` |
| Autorisation og identitet (`authorization`) | ja | `make tenant-test`<br>`make identity-test`<br>`make approval-test`<br>`make credentials-test`<br>`make tool-boundary-test` |
| Integration mod testdobbelt (`integration`) | ja | `make gateway-test`<br>`make model-gateway-test`<br>`make adapter-test`<br>`make iam-adapter-test` |
| Installation og migration (`installation`) | ja | `make distribution-check`<br>`make distribution-test`<br>`make persistence-check`<br>`make db-ha-check`<br>`make storage-check`<br>`make immutable-check` |
| Recovery og holdbarhed (`recovery`) | ja | `make audit-durability-test`<br>`make jobs-test`<br>`make continuity-test`<br>`make messaging-test`<br>`make db-ha-test`<br>`make storage-test`<br>`make storage-drill`<br>`make immutable-test` |
| Samlet baseline og release-gate (`baseline`) | ja | `make baseline`<br>`make release-gate` |

## Krav

| Krav | Obligatorisk | Testtyper | Checks | Frist (dage) | Uafhængig vurdering |
| --- | --- | --- | --- | --- | --- |
| `REQ-TENANT-001` Tenant isolation gennem kontrolplanet | ja | authorization, unit, contract | `tenant-test`<br>`tenant-check` | 30 | nej |
| `REQ-IDENTITY-001` Verificerbar identitet | ja | authorization, unit, contract | `identity-test`<br>`architecture-test` | 30 | nej |
| `REQ-APPROVAL-001` Autentiske, ændringsbundne godkendelser | ja | authorization, unit, contract | `approval-test`<br>`approval-check` | 30 | nej |
| `REQ-AGENT-ROLE-001` Præcis én uforanderlig rolle pr. agent | ja | authorization, unit, contract | `agent-registry-test`<br>`agent-registry-check` | 30 | nej |
| `REQ-AGENT-HANDOFF-001` Verificeret agent-handoff | ja | end-to-end | `agent-conformance-test` | 30 | nej |
| `REQ-POLICY-001` Default-deny policygrænse | ja | authorization, unit, contract | `policy-test`<br>`boundary-test`<br>`policy-verify` | 30 | nej |
| `REQ-AUDIT-001` Holdbar audit og fail-closed handlinger | ja / nonExcepted | recovery, unit, contract | `audit-durability-test`<br>`audit-durability-check`<br>`audit-service-test` | 30 | nej |
| `REQ-CREDENTIALS-001` Kortlivede, scope-bundne rettigheder og nødstop | ja | authorization, unit, contract | `credentials-test`<br>`credentials-check` | 30 | nej |
| `REQ-TOOL-001` Servervalideret værktøjsgrænse og injection-forsvar | ja | authorization, unit, contract | `tool-boundary-test`<br>`tool-boundary-check` | 30 | nej |
| `REQ-JOBS-001` Genoptagelig og idempotent eksekvering | ja | recovery, unit, contract | `jobs-test`<br>`jobs-check` | 30 | nej |
| `REQ-GATEWAY-001` Modelgateway med routing, egress og budget | ja | integration, unit, contract | `gateway-check`<br>`gateway-test`<br>`model-gateway-test`<br>`budget-test`<br>`model-egress-check` | 30 | nej |
| `REQ-PERSIST-001` Holdbar tilstand og versionerede migrationer | ja | migration, unit, contract | `persistence-test`<br>`persistence-check` | 30 | nej |
| `REQ-INSTALL-001` Installationsprofiler og dependency-resolver | ja | installation, unit, contract | `distribution-check`<br>`distribution-test`<br>`distribution-preview` | 30 | nej |
| `REQ-CONFIGURATION-001` Installer og fælles konfiguration med sikre standarder | ja / nonExcepted | installation, contract, unit, authorization | `configuration-check`<br>`configuration-test`<br>`installer-preflight`<br>`installer-plan`<br>`configuration-preview` | 30 | nej |
| `REQ-HOST-001` Valgfri sikker server- og OS-administration | ja / nonExcepted | unit, contract, authorization, installation, integration | `host-management-check`<br>`host-management-test`<br>`host-management-status`<br>`integration-host-management-live` | 30 | nej |
| `REQ-CONTINUITY-001` Recoverymål og serviceklasser | ja | recovery, contract | `continuity-check`<br>`continuity-test` | 30 | ja (live-measurement) |
| `REQ-BACKUP-001` Krypteret backup og gennemført gendannelsesøvelse | ja / nonExcepted | recovery, authorization, contract | `backup-check`<br>`backup-test`<br>`integration-backup-production-drill` | 30 | ja (live-measurement) |
| `REQ-BACKUP-002` Eksterne backupmål og bevaret recoveryhistorik | ja / nonExcepted | contract, recovery, integration | `backup-target-check`<br>`backup-target-test`<br>`integration-backup-external-target` | 30 | nej |
| `REQ-PRIVACY-001` Privacy-verber og DSAR-fan-out | ja | end-to-end, authorization | `conform-all`<br>`dsar-demo` | 30 | nej |
| `REQ-PRIVACY-002` Holdbar DSAR-sag og sikret eksport | ja / nonExcepted | authorization, end-to-end | `privacy-check`<br>`privacy-test`<br>`integration-privacy-live` | 30 | nej |
| `REQ-COMPLIANCE-001` Kontrolmapping og OSCAL-evidens | ja | contract, end-to-end | `compliance-test`<br>`compliance-check`<br>`oscal-evidence`<br>`evidence-test` | 30 | nej |
| `REQ-OBSERVABILITY-001` Dashboards og SLO fra modulmanifestet | ja | contract, unit | `observability-test`<br>`observability-check`<br>`telemetry-test` | 30 | nej |
| `REQ-SECURITY-001` Sårbarheds- og runtime-håndtering | ja / nonExcepted | contract, unit, integration | `security-test`<br>`security-check` | 30 | ja (independent-assessment) |
| `REQ-MONITORING-001` Reel overvågning, tenantadskilt telemetri og handlingsdygtige alarmer | ja / nonExcepted | contract, unit, authorization, integration | `monitoring-check`<br>`monitoring-test`<br>`monitoring-drill`<br>`integration-monitoring-backend` | 30 | ja (live-measurement) |
| `REQ-TELEMETRY-API-001` Autoriseret telemetri-API og udskiftelige dashboards | ja / nonExcepted | contract, unit, authorization, integration | `telemetry-api-check`<br>`telemetry-api-test`<br>`telemetry-api-demo`<br>`integration-telemetry-backend`<br>`integration-dashboard-adapter` | 30 | ja (live-measurement) |
| `REQ-GITOPS-001` Git som eneste ændringskanal | ja | contract, unit | `gitops-test`<br>`gitops-verify`<br>`changelog-check` | 30 | nej |
| `REQ-CURRICULUM-001` Ejer-curriculum og menneskeligt tilsyn | ja | unit, contract | `curriculum-test`<br>`curriculum-check` | 30 | nej |
| `REQ-REVIEW-001` Adversarielt reviewer-lag | ja | unit, contract | `reviewer-test`<br>`compliance-test` | 30 | nej |
| `REQ-PERFORMANCE-001` Ydeevne og belastning | ja | performance | — | 30 | ja (independent-assessment) |
| `REQ-SUPPLY-001` Reproducerbare artefakter og beskyttet releasevej | ja / nonExcepted | contract, unit, integration | `supply-chain-check`<br>`supply-chain-test`<br>`supply-chain-vuln-check`<br>`integration-container-build` | 30 | nej |
| `REQ-STAGING-001` Reproducerbar staging med miljøadskillelse og rigtig drift | ja / nonExcepted | contract, unit, integration | `infrastructure-check`<br>`infrastructure-test`<br>`infrastructure-verify`<br>`integration-staging-drift`<br>`integration-staging-provision` | 30 | nej |
| `REQ-EVIDENCE-001` Adskillelse af kontraktchecks, integration og driftsbevis | ja / nonExcepted | contract, integration | `evidence-mode-check`<br>`evidence-mode-test`<br>`evidence-probe-staging` | 30 | nej |
| `REQ-VULN-001` Kontinuerlig sikkerhedskontrol og sårbarhedslivscyklus | ja / nonExcepted | contract, integration | `vulnerability-check`<br>`vulnerability-test`<br>`integration-vulnerability-scan` | 14 | nej |
| `REQ-ADAPTER-001` Fælles adapter-SDK og godkendelsestest | ja / nonExcepted | contract | `adapter-sdk-check`<br>`adapter-sdk-test` | 30 | nej |
| `REQ-ADAPTER-002` Live integration og opgradering af adaptere | ja / nonExcepted | contract, integration | `adapter-live-check`<br>`adapter-live-test`<br>`integration-adapter-live` | 30 | nej |
| `REQ-GOVERNANCE-001` Release-gate, tærskler og producent-adskillelse | ja / nonExcepted | contract | `release-check`<br>`release-test` | 30 | nej |
| `REQ-FEATURE-ACCESS-001` Tværgående IAM og dataadgang for Communications, HR, BI og Reporting | ja / nonExcepted | contract, unit, authorization, integration | `feature-access-check`<br>`feature-access-test`<br>`feature-access-demo`<br>`integration-reporting-delivery`<br>`integration-idp-offboarding` | 30 | ja (live-measurement) |
| `REQ-HA-001` HA-klynge og sikker kommunikation mellem servere | ja / nonExcepted | contract, unit, authorization, integration | `ha-check`<br>`ha-test`<br>`ha-drill`<br>`integration-ha-failover`<br>`integration-network-policy-plugin` | 30 | ja (live-measurement) |
| `REQ-MSG-001` Holdbar beskedudveksling på tværs af servere | ja / nonExcepted | unit, contract, recovery, integration | `messaging-check`<br>`messaging-test`<br>`integration-message-broker` | 30 | ja (live-measurement) |
| `REQ-DBHA-001` Database-HA med fencing og konsistent failover | ja / nonExcepted | unit, contract, recovery, authorization, integration | `db-ha-check`<br>`db-ha-test`<br>`db-ha-drill`<br>`integration-db-failover` | 30 | ja (live-measurement) |
| `REQ-STORAGE-001` Holdbart fil- og objektlager med quorum, checksums og scrub/repair | ja / nonExcepted | unit, contract, recovery, authorization, integration | `storage-check`<br>`storage-test`<br>`storage-drill`<br>`integration-storage-live` | 30 | ja (live-measurement) |
| `REQ-IMMUTABLE-001` Immutable data uden for agentens kontrol | ja / nonExcepted | unit, contract, authorization, recovery, integration | `immutable-check`<br>`immutable-test`<br>`integration-immutable-live` | 30 | ja (live-measurement) |
| `REQ-RETENTION-001` Sletning, legal hold og gendannelsesregler | ja / nonExcepted | unit, contract, authorization, recovery, integration | `retention-check`<br>`retention-test`<br>`integration-retention-live` | 30 | ja (live-measurement) |
| `REQ-LOGGING-001` Komplet, korreleret og manipuleringssikker logging | ja / nonExcepted | unit, contract, authorization, integration | `logging-check`<br>`logging-test`<br>`integration-logging-live` | 30 | ja (live-measurement) |
| `REQ-DR-001` Uafhængig backup, PITR og katastrofegendannelse | ja / nonExcepted | unit, contract, authorization, recovery, integration | `dr-check`<br>`dr-test`<br>`integration-dr-live` | 30 | ja (live-measurement) |
| `REQ-DEDUP-001` Sikker deduplikering og kontrolleret oprydning | ja / nonExcepted | unit, contract, authorization, recovery, integration | `dedup-check`<br>`dedup-test`<br>`dedup-drill`<br>`integration-dedup-live` | 30 | ja (live-measurement) |
| `REQ-ASSURANCE-001` Evidens- og risikoregister med menneskelige beslutninger | ja / nonExcepted | unit, contract, authorization, integration | `assurance-check`<br>`assurance-test`<br>`assurance-export`<br>`assurance-drill`<br>`integration-assurance-independent` | 30 | ja (external-audit) |
| `REQ-PORTAL-001` Kundeportal, kundelivscyklus og versionsstyrede servicepakker | ja / nonExcepted | unit, contract, authorization, integration | `portal-check`<br>`portal-test`<br>`portal-preview`<br>`portal-demo`<br>`integration-portal-sso`<br>`integration-portal-browser` | 30 | ja (external-audit) |
| `REQ-WORKSPACE-001` Arbejdspladsmodul med filer, deling, kalender og valideret kontoredaktør | ja / nonExcepted | unit, contract, authorization, integration | `nextcloud-adapter-test`<br>`nextcloud-adapter-demo`<br>`integration-nextcloud` | 30 | ja (external-audit) |
| `REQ-ITSM-001` Sammenhængende ITSM med menneskelige ejere | ja / nonExcepted | unit, contract, authorization, integration | `itsm-adapter-test`<br>`itsm-adapter-demo`<br>`integration-glpi` | 30 | ja (external-audit) |
| `REQ-CHANGE-001` Menneskestyret change og runbookgodkendelse | ja / nonExcepted | unit, contract, authorization | `runbook-test`<br>`runbook-check` | 30 | nej |
| `REQ-REMEDIATION-001` Begrænset selvreparation med sikker fallback | ja / nonExcepted | unit, contract, authorization | `remediation-test`<br>`remediation-check` | 30 | nej |
| `REQ-PROJECT-001` Projektstyring med OpenProject og rettighedsbevidst søgning | ja / nonExcepted | unit, contract, authorization, integration | `openproject-adapter-test`<br>`openproject-adapter-demo`<br>`integration-openproject` | 30 | ja (external-audit) |
| `REQ-CAPACITY-001` Bevis for vandret skalering og kapacitet under fejl | ja / nonExcepted | unit, contract, authorization, integration | `performance-check`<br>`performance-test`<br>`performance-drill`<br>`integration-live-load-test` | 30 | ja (external-audit) |
| `REQ-CHAOS-001` Fejl- og katastrofetest af samtidige fejl og kompromitterede agenter | ja / nonExcepted | unit, contract, authorization, integration | `chaos-check`<br>`chaos-test`<br>`chaos-run`<br>`integration-chaos-staging` | 30 | ja (external-audit) |
| `REQ-SHADOW-001` AI i skyggetilstand og begrænset autonomi med gentaget evaluering | ja / nonExcepted | unit, contract, authorization, integration | `shadow-check`<br>`shadow-test`<br>`shadow-run`<br>`integration-ai-shadow` | 30 | ja (external-audit) |
| `REQ-TAKEOVER-001` Menneskelig overtagelse og beredskabsøvelser med målt dataintegritet | ja / nonExcepted | unit, contract, authorization, integration | `takeover-check`<br>`takeover-test`<br>`takeover-run`<br>`integration-takeover-live` | 30 | ja (external-audit) |
| `REQ-METERING-001` Forbrugs- og driftsomkostningsmåling med afstemning, prognose og stopgrænser | ja / nonExcepted | unit, contract, authorization, integration | `metering-check`<br>`metering-test`<br>`metering-run`<br>`integration-metering-live` | 30 | ja (external-audit) |
| `REQ-KNOWLEDGE-001` Rettighedsbevidst vidensbase og søgning med kilde-ACL før retrieval | ja / nonExcepted | unit, contract, authorization, integration | `search-check`<br>`search-test`<br>`search-run`<br>`integration-bookstack-live` | 30 | ja (external-audit) |
| `REQ-SUPPORT-001` Support og sagsbehandling med entydigt adgangs- og godkendelsesejerskab | ja / nonExcepted | unit, contract, authorization, integration | `helpdesk-check`<br>`helpdesk-test`<br>`helpdesk-run`<br>`integration-zammad-live` | 30 | ja (external-audit) |
| `REQ-CRM-001` CRM med entydigt ejerskab af kundedata og stabil tenantafgrænset reference | ja / nonExcepted | unit, contract, authorization, integration | `crm-check`<br>`crm-test`<br>`crm-run`<br>`integration-espocrm-live` | 30 | ja (external-audit) |

---

En check der ikke er kørt, er sprunget over, er forældet eller er bundet til et andet commit/artefakt, tæller ikke som bestået.
