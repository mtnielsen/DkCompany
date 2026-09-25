# Testmatrix (DKC-063)

> Genereret fra `release/matrix/test-matrix.json` (matrixversion 1.13.0). Hvert obligatoriske krav mapper til navngivne checks eller til en eksplicit udestående uafhængig vurdering.

**Ejer:** Anna Andersen · **Tærskler accepteret af:** Anna Andersen (2026-09-23T08:00:00Z)
**Freshness:** standard 30 dage, maks 90 dage
**Tærskler:** alle obligatoriske skal bestå = ja · maks åbne undtagelser = 0 · implementørevidens til release = nej

## Understøttede miljøer

`linux-amd64-node22`, `linux-arm64-node22`, `windows-wsl2-amd64-node22`

## CI-trin

| Trin | Blokerer | Kommandoer |
| --- | --- | --- |
| Kontrakt og lint (`contract`) | ja | `make validate`<br>`make lint`<br>`make release-check` |
| Enheds- og konformanstests (`unit`) | ja | `make test`<br>`make boundary-test`<br>`make persistence-test` |
| Autorisation og identitet (`authorization`) | ja | `make tenant-test`<br>`make identity-test`<br>`make approval-test`<br>`make credentials-test`<br>`make tool-boundary-test` |
| Integration mod testdobbelt (`integration`) | ja | `make gateway-test`<br>`make model-gateway-test`<br>`make adapter-test`<br>`make iam-adapter-test` |
| Installation og migration (`installation`) | ja | `make distribution-check`<br>`make distribution-test`<br>`make persistence-check` |
| Recovery og holdbarhed (`recovery`) | ja | `make audit-durability-test`<br>`make jobs-test`<br>`make continuity-test` |
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

---

En check der ikke er kørt, er sprunget over, er forældet eller er bundet til et andet commit/artefakt, tæller ikke som bestået.
