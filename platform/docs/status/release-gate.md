# Release-gate (DKC-063)

> Genereret af `release/src/cli.mjs`. Kun `PASS` tæller som bestået. `SKIPPED`, `NOT RUN`, `UNSUPPORTED`, `STALE`, `WRONG-ARTIFACT` og `MISSING` er distinkte og tæller ikke som bestået.

**Beslutning:** BLOKERET
**Genereret:** 2026-09-23T13:39:00.470Z · **Matrix:** 1.0.0 · **Profil:** default
**Mål-commit:** `83ad91a963d8055f77c29fb4361455689df95acb` · **Artefakt:** sha256:ad0c240648771ce8e42475b15c94dec829f7220f9121083c8d2220b9cb068005
**Producent:** implementer (`local-baseline`, process|baseline)
**Tærskler accepteret af:** Anna Andersen (2026-09-23T08:00:00Z)

**Status:** 23 krav · 19 pass · 4 blokerende · 1 fail · 0 stale · 0 wrong-artifact · 0 missing · 3 pending independent · 0 excepted

## Krav

| Krav | Status | Blokerer | Testtyper | Mangler | Grunde |
| --- | --- | --- | --- | --- | --- |
| `REQ-TENANT-001` Tenant isolation gennem kontrolplanet | PASS | nej | authorization, unit, contract | — | — |
| `REQ-IDENTITY-001` Verificerbar identitet | PASS | nej | authorization, unit, contract | — | — |
| `REQ-APPROVAL-001` Autentiske, ændringsbundne godkendelser | PASS | nej | authorization, unit, contract | — | — |
| `REQ-AGENT-ROLE-001` Præcis én uforanderlig rolle pr. agent | PASS | nej | authorization, unit, contract | — | — |
| `REQ-AGENT-HANDOFF-001` Verificeret agent-handoff | PASS | nej | end-to-end | — | — |
| `REQ-POLICY-001` Default-deny policygrænse | PASS | nej | authorization, unit, contract | — | — |
| `REQ-AUDIT-001` Holdbar audit og fail-closed handlinger | PASS | nej | recovery, unit, contract | — | — |
| `REQ-CREDENTIALS-001` Kortlivede, scope-bundne rettigheder og nødstop | PASS | nej | authorization, unit, contract | — | — |
| `REQ-TOOL-001` Servervalideret værktøjsgrænse og injection-forsvar | PASS | nej | authorization, unit, contract | — | — |
| `REQ-JOBS-001` Genoptagelig og idempotent eksekvering | PASS | nej | recovery, unit, contract | — | — |
| `REQ-GATEWAY-001` Modelgateway med routing, egress og budget | PASS | nej | integration, unit, contract | — | — |
| `REQ-PERSIST-001` Holdbar tilstand og versionerede migrationer | PASS | nej | migration, unit, contract | — | — |
| `REQ-INSTALL-001` Installationsprofiler og dependency-resolver | PASS | nej | installation, unit, contract | — | — |
| `REQ-CONTINUITY-001` Recoverymål og serviceklasser | PENDING INDEPENDENT | ja | recovery, contract | — | kræver en gyldig uafhængig vurdering (live-measurement); en implementørkørsel tæller ikke |
| `REQ-PRIVACY-001` Privacy-verber og DSAR-fan-out | PASS | nej | end-to-end, authorization | — | — |
| `REQ-COMPLIANCE-001` Kontrolmapping og OSCAL-evidens | PASS | nej | contract, end-to-end | — | — |
| `REQ-OBSERVABILITY-001` Dashboards og SLO fra modulmanifestet | PASS | nej | contract, unit | — | — |
| `REQ-SECURITY-001` Sårbarheds- og runtime-håndtering | PENDING INDEPENDENT | ja | contract, unit, integration | — | testtyper dækket af den uafhængige vurdering: integration<br>kræver en gyldig uafhængig vurdering (independent-assessment); en implementørkørsel tæller ikke |
| `REQ-GITOPS-001` Git som eneste ændringskanal | FAIL | ja | contract, unit | — | check 'changelog-check' er 'failed' |
| `REQ-CURRICULUM-001` Ejer-curriculum og menneskeligt tilsyn | PASS | nej | unit, contract | — | — |
| `REQ-REVIEW-001` Adversarielt reviewer-lag | PASS | nej | unit, contract | — | — |
| `REQ-PERFORMANCE-001` Ydeevne og belastning | PENDING INDEPENDENT | ja | performance | — | testtyper dækket af den uafhængige vurdering: performance<br>kræver en gyldig uafhængig vurdering (independent-assessment); en implementørkørsel tæller ikke |
| `REQ-GOVERNANCE-001` Release-gate, tærskler og producent-adskillelse | PASS | nej | contract | — | — |

## Checks og binding

| Krav | Check | Status | Niveau | Kommando | Evidens | Alder (dage) |
| --- | --- | --- | --- | --- | --- | --- |
| REQ-TENANT-001 | `tenant-test` | PASS | real | `make tenant-test` | `/tmp/dkc-063/00-core/.conformance-out/baseline/logs/tenant-test.log` | 0 |
| REQ-TENANT-001 | `tenant-check` | PASS | contract | `make tenant-check` | `/tmp/dkc-063/00-core/.conformance-out/baseline/logs/tenant-check.log` | 0 |
| REQ-IDENTITY-001 | `identity-test` | PASS | real | `make identity-test` | `/tmp/dkc-063/00-core/.conformance-out/baseline/logs/identity-test.log` | 0 |
| REQ-IDENTITY-001 | `architecture-test` | PASS | real | `make architecture-test` | `/tmp/dkc-063/00-core/.conformance-out/baseline/logs/architecture-test.log` | 0 |
| REQ-APPROVAL-001 | `approval-test` | PASS | real | `make approval-test` | `/tmp/dkc-063/00-core/.conformance-out/baseline/logs/approval-test.log` | 0 |
| REQ-APPROVAL-001 | `approval-check` | PASS | contract | `make approval-check` | `/tmp/dkc-063/00-core/.conformance-out/baseline/logs/approval-check.log` | 0 |
| REQ-AGENT-ROLE-001 | `agent-registry-test` | PASS | real | `make agent-registry-test` | `/tmp/dkc-063/00-core/.conformance-out/baseline/logs/agent-registry-test.log` | 0 |
| REQ-AGENT-ROLE-001 | `agent-registry-check` | PASS | contract | `make agent-registry-check` | `/tmp/dkc-063/00-core/.conformance-out/baseline/logs/agent-registry-check.log` | 0 |
| REQ-AGENT-HANDOFF-001 | `agent-conformance-test` | PASS | real | `make agent-conformance-test` | `/tmp/dkc-063/00-core/.conformance-out/baseline/logs/agent-conformance-test.log` | 0 |
| REQ-POLICY-001 | `policy-test` | PASS | real | `make policy-test` | `/tmp/dkc-063/00-core/.conformance-out/baseline/logs/policy-test.log` | 0 |
| REQ-POLICY-001 | `boundary-test` | PASS | real | `make boundary-test` | `/tmp/dkc-063/00-core/.conformance-out/baseline/logs/boundary-test.log` | 0 |
| REQ-POLICY-001 | `policy-verify` | PASS | real | `make policy-verify` | `/tmp/dkc-063/00-core/.conformance-out/baseline/logs/policy-verify.log` | 0 |
| REQ-AUDIT-001 | `audit-durability-test` | PASS | real | `make audit-durability-test` | `/tmp/dkc-063/00-core/.conformance-out/baseline/logs/audit-durability-test.log` | 0 |
| REQ-AUDIT-001 | `audit-durability-check` | PASS | contract | `make audit-durability-check` | `/tmp/dkc-063/00-core/.conformance-out/baseline/logs/audit-durability-check.log` | 0 |
| REQ-AUDIT-001 | `audit-service-test` | PASS | real | `make audit-service-test` | `/tmp/dkc-063/00-core/.conformance-out/baseline/logs/audit-service-test.log` | 0 |
| REQ-CREDENTIALS-001 | `credentials-test` | PASS | real | `make credentials-test` | `/tmp/dkc-063/00-core/.conformance-out/baseline/logs/credentials-test.log` | 0 |
| REQ-CREDENTIALS-001 | `credentials-check` | PASS | contract | `make credentials-check` | `/tmp/dkc-063/00-core/.conformance-out/baseline/logs/credentials-check.log` | 0 |
| REQ-TOOL-001 | `tool-boundary-test` | PASS | real | `make tool-boundary-test` | `/tmp/dkc-063/00-core/.conformance-out/baseline/logs/tool-boundary-test.log` | 0 |
| REQ-TOOL-001 | `tool-boundary-check` | PASS | contract | `make tool-boundary-check` | `/tmp/dkc-063/00-core/.conformance-out/baseline/logs/tool-boundary-check.log` | 0 |
| REQ-JOBS-001 | `jobs-test` | PASS | real | `make jobs-test` | `/tmp/dkc-063/00-core/.conformance-out/baseline/logs/jobs-test.log` | 0 |
| REQ-JOBS-001 | `jobs-check` | PASS | contract | `make jobs-check` | `/tmp/dkc-063/00-core/.conformance-out/baseline/logs/jobs-check.log` | 0 |
| REQ-GATEWAY-001 | `gateway-check` | PASS | contract | `make gateway-check` | `/tmp/dkc-063/00-core/.conformance-out/baseline/logs/gateway-check.log` | 0 |
| REQ-GATEWAY-001 | `gateway-test` | PASS | mock | `make gateway-test` | `/tmp/dkc-063/00-core/.conformance-out/baseline/logs/gateway-test.log` | 0 |
| REQ-GATEWAY-001 | `model-gateway-test` | PASS | real | `make model-gateway-test` | `/tmp/dkc-063/00-core/.conformance-out/baseline/logs/model-gateway-test.log` | 0 |
| REQ-GATEWAY-001 | `budget-test` | PASS | real | `make budget-test` | `/tmp/dkc-063/00-core/.conformance-out/baseline/logs/budget-test.log` | 0 |
| REQ-GATEWAY-001 | `model-egress-check` | PASS | real | `make model-egress-check` | `/tmp/dkc-063/00-core/.conformance-out/baseline/logs/model-egress-check.log` | 0 |
| REQ-PERSIST-001 | `persistence-test` | PASS | real | `make persistence-test` | `/tmp/dkc-063/00-core/.conformance-out/baseline/logs/persistence-test.log` | 0 |
| REQ-PERSIST-001 | `persistence-check` | PASS | contract | `make persistence-check` | `/tmp/dkc-063/00-core/.conformance-out/baseline/logs/persistence-check.log` | 0 |
| REQ-INSTALL-001 | `distribution-check` | PASS | contract | `make distribution-check` | `/tmp/dkc-063/00-core/.conformance-out/baseline/logs/distribution-check.log` | 0 |
| REQ-INSTALL-001 | `distribution-test` | PASS | real | `make distribution-test` | `/tmp/dkc-063/00-core/.conformance-out/baseline/logs/distribution-test.log` | 0 |
| REQ-INSTALL-001 | `distribution-preview` | PASS | real | `make distribution-preview PROFILE=ha-cluster APPS=bi,hr` | `/tmp/dkc-063/00-core/.conformance-out/baseline/logs/distribution-preview.log` | 0 |
| REQ-CONTINUITY-001 | `continuity-check` | PASS | contract | `make continuity-check` | `/tmp/dkc-063/00-core/.conformance-out/baseline/logs/continuity-check.log` | 0 |
| REQ-CONTINUITY-001 | `continuity-test` | PASS | real | `make continuity-test` | `/tmp/dkc-063/00-core/.conformance-out/baseline/logs/continuity-test.log` | 0 |
| REQ-PRIVACY-001 | `conform-all` | PASS | real | `make conform-all` | `/tmp/dkc-063/00-core/.conformance-out/baseline/logs/conform-all.log` | 0 |
| REQ-PRIVACY-001 | `dsar-demo` | PASS | fixture | `make dsar-demo` | `/tmp/dkc-063/00-core/.conformance-out/baseline/logs/dsar-demo.log` | 0 |
| REQ-COMPLIANCE-001 | `compliance-test` | PASS | real | `make compliance-test` | `/tmp/dkc-063/00-core/.conformance-out/baseline/logs/compliance-test.log` | 0 |
| REQ-COMPLIANCE-001 | `compliance-check` | PASS | real | `make compliance-check` | `/tmp/dkc-063/00-core/.conformance-out/baseline/logs/compliance-check.log` | 0 |
| REQ-COMPLIANCE-001 | `oscal-evidence` | PASS | real | `make oscal-evidence` | `/tmp/dkc-063/00-core/.conformance-out/baseline/logs/oscal-evidence.log` | 0 |
| REQ-COMPLIANCE-001 | `evidence-test` | PASS | real | `make evidence-test` | `/tmp/dkc-063/00-core/.conformance-out/baseline/logs/evidence-test.log` | 0 |
| REQ-OBSERVABILITY-001 | `observability-test` | PASS | real | `make observability-test` | `/tmp/dkc-063/00-core/.conformance-out/baseline/logs/observability-test.log` | 0 |
| REQ-OBSERVABILITY-001 | `observability-check` | PASS | real | `make observability-check` | `/tmp/dkc-063/00-core/.conformance-out/baseline/logs/observability-check.log` | 0 |
| REQ-OBSERVABILITY-001 | `telemetry-test` | PASS | real | `make telemetry-test` | `/tmp/dkc-063/00-core/.conformance-out/baseline/logs/telemetry-test.log` | 0 |
| REQ-SECURITY-001 | `security-test` | PASS | real | `make security-test` | `/tmp/dkc-063/00-core/.conformance-out/baseline/logs/security-test.log` | 0 |
| REQ-SECURITY-001 | `security-check` | PASS | fixture | `make security-check` | `/tmp/dkc-063/00-core/.conformance-out/baseline/logs/security-check.log` | 0 |
| REQ-GITOPS-001 | `gitops-test` | PASS | real | `make gitops-test` | `/tmp/dkc-063/00-core/.conformance-out/baseline/logs/gitops-test.log` | 0 |
| REQ-GITOPS-001 | `gitops-verify` | PASS | real | `make gitops-verify` | `/tmp/dkc-063/00-core/.conformance-out/baseline/logs/gitops-verify.log` | 0 |
| REQ-GITOPS-001 | `changelog-check` | FAIL | real | `make changelog-check` | `/tmp/dkc-063/00-core/.conformance-out/baseline/logs/changelog-check.log` | 0 |
| REQ-CURRICULUM-001 | `curriculum-test` | PASS | real | `make curriculum-test` | `/tmp/dkc-063/00-core/.conformance-out/baseline/logs/curriculum-test.log` | 0 |
| REQ-CURRICULUM-001 | `curriculum-check` | PASS | real | `make curriculum-check` | `/tmp/dkc-063/00-core/.conformance-out/baseline/logs/curriculum-check.log` | 0 |
| REQ-REVIEW-001 | `reviewer-test` | PASS | real | `make reviewer-test` | `/tmp/dkc-063/00-core/.conformance-out/baseline/logs/reviewer-test.log` | 0 |
| REQ-REVIEW-001 | `compliance-test` | PASS | real | `make compliance-test` | `/tmp/dkc-063/00-core/.conformance-out/baseline/logs/compliance-test.log` | 0 |
| REQ-GOVERNANCE-001 | `release-check` | PASS | contract | `make release-check` | `/tmp/dkc-063/00-core/.conformance-out/baseline/logs/release-check.log` | 0 |
| REQ-GOVERNANCE-001 | `release-test` | PASS | real | `make release-test` | `/tmp/dkc-063/00-core/.conformance-out/baseline/logs/release-test.log` | 0 |

## Trusselgrænser

| Trussel | Grænse | Status | Restrisiko |
| --- | --- | --- | --- |
| `THREAT-TENANT-001` Tenant-hop gennem manglende kontekst | tenant-boundary | PASS | low |
| `THREAT-IDENTITY-001` Forfalsket workload-identitet | identity | PASS | low |
| `THREAT-HANDOFF-001` Rolleeskalering gennem handoff | agent-handoff | PASS | low |
| `THREAT-HOST-001` Uautoriseret host-styring | privileged-host-operations | PASS | medium |
| `THREAT-AUDIT-001` Audit deaktiveres for at skjule handling | immutable-storage | PASS | low |
| `THREAT-TELEMETRY-001` Persondata lækker gennem telemetri | telemetry | PASS | medium |
| `THREAT-EXTERNAL-001` Prompt-injection fra ekstern kilde | external-sources | PASS | low |
| `THREAT-GATE-001` Grøn gate på svagt grundlag | external-sources | PENDING INDEPENDENT | medium |

---

En grøn enhedstest er ikke produktions-, HA- eller compliance-status. Uafhængig verifikation er en separat menneskelig handling.
