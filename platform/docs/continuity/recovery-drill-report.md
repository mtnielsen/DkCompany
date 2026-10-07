# Beredskabsøvelse og overtagelseskontrol (DKC-052)

> Genereret fra `continuity/takeover-plan.json` med `make takeover-run`. Øvelsen er en **deterministisk model** (`measured: false`). Menneskelige trin forbliver AFVENTER, indtil et navngivet menneske faktisk har udført dem; en målt øvelse på levende hosts er en ekstern integration, se [`recovery-drill-live.md`](recovery-drill-live.md).

**Gate:** AFVENTER MENNESKE
**Plan:** platform-takeover-plan v1.0.0 · **Genereret:** 2026-09-29

Grund til at beredskabet ikke er godkendt:
- single-server: afventer menneskelig handling (trinnet 'declare-incident' afventer incidentLead; trinnet 'notify-test-recipients' afventer incidentLead; trinnet 'retrieve-break-glass' afventer dataProtection; trinnet 'owner-restore-decision' afventer serviceOwner; trinnet 'failback-decision' afventer changeAuthority; trinnet 'human-acceptance' afventer serviceOwner; kritisk incident er ikke accepteret af et menneske)
- ha: afventer menneskelig handling (trinnet 'declare-incident' afventer incidentLead; trinnet 'notify-test-recipients' afventer incidentLead; trinnet 'retrieve-break-glass' afventer dataProtection; trinnet 'owner-restore-decision' afventer serviceOwner; trinnet 'failback-decision' afventer changeAuthority; trinnet 'human-acceptance' afventer serviceOwner; kritisk incident er ikke accepteret af et menneske)
- ai-offline: afventer menneskelig handling (trinnet 'declare-incident' afventer incidentLead; trinnet 'notify-test-recipients' afventer incidentLead; trinnet 'retrieve-break-glass' afventer dataProtection; trinnet 'owner-restore-decision' afventer serviceOwner; trinnet 'failback-decision' afventer changeAuthority; trinnet 'human-acceptance' afventer serviceOwner; kritisk incident er ikke accepteret af et menneske)
- iam-loss: afventer menneskelig handling (trinnet 'declare-incident' afventer incidentLead; trinnet 'notify-test-recipients' afventer incidentLead; trinnet 'retrieve-break-glass' afventer dataProtection; trinnet 'owner-restore-decision' afventer serviceOwner; trinnet 'failback-decision' afventer changeAuthority; trinnet 'human-acceptance' afventer serviceOwner; kritisk incident er ikke accepteret af et menneske)
- site-catastrophe: afventer menneskelig handling (trinnet 'declare-incident' afventer incidentLead; trinnet 'notify-test-recipients' afventer incidentLead; trinnet 'retrieve-break-glass' afventer dataProtection; trinnet 'owner-restore-decision' afventer serviceOwner; trinnet 'failback-decision' afventer changeAuthority; trinnet 'human-acceptance' afventer serviceOwner; kritisk incident er ikke accepteret af et menneske)

## Opsummering

- Scenarier: 5 (0 valideret, 5 afventer menneske, 0 blokeret)
- Trin: 18 maskine, 30 menneske (30 afventer)
- Eskalationer til mennesker: 50
- Agenten kan godkende beredskab: nej

## Scenarier

| Scenarie | Kind | Status | Dataintegritet | Restore | Failback | Målte RTO min |
| --- | --- | --- | --- | --- | --- | --- |
| single-server | single-server | AFVENTER MENNESKE | OK | OK | — | 0 |
| ha | ha | AFVENTER MENNESKE | OK | OK | OK | 0.6 |
| ai-offline | ai-offline | AFVENTER MENNESKE | — | — | — | — |
| iam-loss | iam-loss | AFVENTER MENNESKE | OK | OK | — | 0 |
| site-catastrophe | site-catastrophe | AFVENTER MENNESKE | OK | OK | OK | 0.6 |

### single-server — AFVENTER MENNESKE

Miljø: isolated-recovery · Drill-ID: `drill-single-server-2026-09-29T08:00:00.000Z`

| Trin | Fase | Kind | Status | Operatør | Tid | Resultat |
| --- | --- | --- | --- | --- | --- | --- |
| declare-incident | takeover | human | AFVENTER | Anna Andersen | — | afventer menneskelig handling |
| notify-test-recipients | takeover | human | AFVENTER | Anna Andersen | — | afventer menneskelig handling |
| verify-artifacts | takeover | machine | PASS | — | 2026-09-29T08:00:00.000Z | alle 4 artefakter er bundet og har digest |
| retrieve-break-glass | restore | human | AFVENTER | Cecilia Christensen | — | afventer menneskelig handling |
| restore-integrity | restore | machine | PASS | — | 2026-09-29T08:00:00.000Z | lagerets quorum, scrub/repair og tenantisolering er intakt (7 checks) |
| owner-restore-decision | restore | human | AFVENTER | Maja Mortensen | — | afventer menneskelig handling |
| failback-decision | failback | human | AFVENTER | Anna Andersen | — | afventer menneskelig handling |
| service-validation | validation | machine | PASS | — | 2026-09-29T08:00:00.000Z | 2 vedtagne serviceklasser er produktionsklare og har testet gendannelse |
| human-acceptance | validation | human | AFVENTER | Maja Mortensen | — | afventer menneskelig handling |

Eskalationer: declare-incident → Anna Andersen efter 15 min; declare-incident → Cecilia Christensen efter 30 min; notify-test-recipients → Anna Andersen efter 15 min; notify-test-recipients → Cecilia Christensen efter 30 min; retrieve-break-glass → Cecilia Christensen efter 30 min; owner-restore-decision → Anna Andersen efter 15 min; owner-restore-decision → Cecilia Christensen efter 30 min; failback-decision → Cecilia Christensen efter 30 min; human-acceptance → Anna Andersen efter 15 min; human-acceptance → Cecilia Christensen efter 30 min

### ha — AFVENTER MENNESKE

Miljø: isolated-recovery · Drill-ID: `drill-ha-2026-09-29T08:00:00.000Z`

| Trin | Fase | Kind | Status | Operatør | Tid | Resultat |
| --- | --- | --- | --- | --- | --- | --- |
| declare-incident | takeover | human | AFVENTER | Anna Andersen | — | afventer menneskelig handling |
| notify-test-recipients | takeover | human | AFVENTER | Anna Andersen | — | afventer menneskelig handling |
| verify-artifacts | takeover | machine | PASS | — | 2026-09-29T08:00:00.000Z | alle 5 artefakter er bundet og har digest |
| retrieve-break-glass | restore | human | AFVENTER | Cecilia Christensen | — | afventer menneskelig handling |
| restore-integrity | restore | machine | PASS | — | 2026-09-29T08:00:00.000Z | lagerets quorum, scrub/repair og tenantisolering er intakt (7 checks) |
| owner-restore-decision | restore | human | AFVENTER | Maja Mortensen | — | afventer menneskelig handling |
| failback-decision | failback | human | AFVENTER | Anna Andersen | — | afventer menneskelig handling |
| failback-integrity | failback | machine | PASS | — | 2026-09-29T08:00:00.000Z | failback tilbage til primær er verificeret: quorum=true, database-integrity=true, rejoin=true |
| service-validation | validation | machine | PASS | — | 2026-09-29T08:00:00.000Z | 2 vedtagne serviceklasser er produktionsklare og har testet gendannelse |
| human-acceptance | validation | human | AFVENTER | Maja Mortensen | — | afventer menneskelig handling |

Eskalationer: declare-incident → Anna Andersen efter 15 min; declare-incident → Cecilia Christensen efter 30 min; notify-test-recipients → Anna Andersen efter 15 min; notify-test-recipients → Cecilia Christensen efter 30 min; retrieve-break-glass → Cecilia Christensen efter 30 min; owner-restore-decision → Anna Andersen efter 15 min; owner-restore-decision → Cecilia Christensen efter 30 min; failback-decision → Cecilia Christensen efter 30 min; human-acceptance → Anna Andersen efter 15 min; human-acceptance → Cecilia Christensen efter 30 min

### ai-offline — AFVENTER MENNESKE

Miljø: airgapped-control · Drill-ID: `drill-ai-offline-2026-09-29T08:00:00.000Z`

| Trin | Fase | Kind | Status | Operatør | Tid | Resultat |
| --- | --- | --- | --- | --- | --- | --- |
| declare-incident | takeover | human | AFVENTER | Anna Andersen | — | afventer menneskelig handling |
| notify-test-recipients | takeover | human | AFVENTER | Anna Andersen | — | afventer menneskelig handling |
| verify-artifacts | takeover | machine | PASS | — | 2026-09-29T08:00:00.000Z | alle 4 artefakter er bundet og har digest |
| retrieve-break-glass | restore | human | AFVENTER | Cecilia Christensen | — | afventer menneskelig handling |
| ai-offline | restore | machine | PASS | — | 2026-09-29T08:00:00.000Z | AI-offline er dækket: kontrolplanstab i fejlmatrixen, menneskelig godkendelse og governance-krav i autonomibevillingen |
| owner-restore-decision | restore | human | AFVENTER | Maja Mortensen | — | afventer menneskelig handling |
| failback-decision | failback | human | AFVENTER | Anna Andersen | — | afventer menneskelig handling |
| service-validation | validation | machine | PASS | — | 2026-09-29T08:00:00.000Z | 2 vedtagne serviceklasser er produktionsklare og har testet gendannelse |
| human-acceptance | validation | human | AFVENTER | Maja Mortensen | — | afventer menneskelig handling |

Eskalationer: declare-incident → Anna Andersen efter 15 min; declare-incident → Cecilia Christensen efter 30 min; notify-test-recipients → Anna Andersen efter 15 min; notify-test-recipients → Cecilia Christensen efter 30 min; retrieve-break-glass → Cecilia Christensen efter 30 min; owner-restore-decision → Anna Andersen efter 15 min; owner-restore-decision → Cecilia Christensen efter 30 min; failback-decision → Cecilia Christensen efter 30 min; human-acceptance → Anna Andersen efter 15 min; human-acceptance → Cecilia Christensen efter 30 min

### iam-loss — AFVENTER MENNESKE

Miljø: isolated-recovery · Drill-ID: `drill-iam-loss-2026-09-29T08:00:00.000Z`

| Trin | Fase | Kind | Status | Operatør | Tid | Resultat |
| --- | --- | --- | --- | --- | --- | --- |
| declare-incident | takeover | human | AFVENTER | Anna Andersen | — | afventer menneskelig handling |
| notify-test-recipients | takeover | human | AFVENTER | Anna Andersen | — | afventer menneskelig handling |
| verify-artifacts | takeover | machine | PASS | — | 2026-09-29T08:00:00.000Z | alle 3 artefakter er bundet og har digest |
| retrieve-break-glass | restore | human | AFVENTER | Cecilia Christensen | — | afventer menneskelig handling |
| iam-loss | restore | machine | PASS | — | 2026-09-29T08:00:00.000Z | recovery-identiteten er adskilt fra primærdriften og kan kun aktiveres af et verificeret menneske med to-personers kontrol |
| restore-integrity | restore | machine | PASS | — | 2026-09-29T08:00:00.000Z | lagerets quorum, scrub/repair og tenantisolering er intakt (7 checks) |
| owner-restore-decision | restore | human | AFVENTER | Maja Mortensen | — | afventer menneskelig handling |
| failback-decision | failback | human | AFVENTER | Anna Andersen | — | afventer menneskelig handling |
| service-validation | validation | machine | PASS | — | 2026-09-29T08:00:00.000Z | 2 vedtagne serviceklasser er produktionsklare og har testet gendannelse |
| human-acceptance | validation | human | AFVENTER | Maja Mortensen | — | afventer menneskelig handling |

Eskalationer: declare-incident → Anna Andersen efter 15 min; declare-incident → Cecilia Christensen efter 30 min; notify-test-recipients → Anna Andersen efter 15 min; notify-test-recipients → Cecilia Christensen efter 30 min; retrieve-break-glass → Cecilia Christensen efter 30 min; owner-restore-decision → Anna Andersen efter 15 min; owner-restore-decision → Cecilia Christensen efter 30 min; failback-decision → Cecilia Christensen efter 30 min; human-acceptance → Anna Andersen efter 15 min; human-acceptance → Cecilia Christensen efter 30 min

### site-catastrophe — AFVENTER MENNESKE

Miljø: isolated-recovery-site-b · Drill-ID: `drill-site-catastrophe-2026-09-29T08:00:00.000Z`

| Trin | Fase | Kind | Status | Operatør | Tid | Resultat |
| --- | --- | --- | --- | --- | --- | --- |
| declare-incident | takeover | human | AFVENTER | Anna Andersen | — | afventer menneskelig handling |
| notify-test-recipients | takeover | human | AFVENTER | Anna Andersen | — | afventer menneskelig handling |
| verify-artifacts | takeover | machine | PASS | — | 2026-09-29T08:00:00.000Z | alle 5 artefakter er bundet og har digest |
| retrieve-break-glass | restore | human | AFVENTER | Cecilia Christensen | — | afventer menneskelig handling |
| restore-integrity | restore | machine | PASS | — | 2026-09-29T08:00:00.000Z | lagerets quorum, scrub/repair og tenantisolering er intakt (7 checks) |
| owner-restore-decision | restore | human | AFVENTER | Maja Mortensen | — | afventer menneskelig handling |
| failback-decision | failback | human | AFVENTER | Anna Andersen | — | afventer menneskelig handling |
| failback-integrity | failback | machine | PASS | — | 2026-09-29T08:00:00.000Z | failback tilbage til primær er verificeret: quorum=true, database-integrity=true, rejoin=true |
| service-validation | validation | machine | PASS | — | 2026-09-29T08:00:00.000Z | 2 vedtagne serviceklasser er produktionsklare og har testet gendannelse |
| human-acceptance | validation | human | AFVENTER | Maja Mortensen | — | afventer menneskelig handling |

Eskalationer: declare-incident → Anna Andersen efter 15 min; declare-incident → Cecilia Christensen efter 30 min; notify-test-recipients → Anna Andersen efter 15 min; notify-test-recipients → Cecilia Christensen efter 30 min; retrieve-break-glass → Cecilia Christensen efter 30 min; owner-restore-decision → Anna Andersen efter 15 min; owner-restore-decision → Cecilia Christensen efter 30 min; failback-decision → Cecilia Christensen efter 30 min; human-acceptance → Anna Andersen efter 15 min; human-acceptance → Cecilia Christensen efter 30 min

## Sådan gentages øvelsen

```sh
make takeover-run      # kør alle scenarier deterministisk
make takeover-check    # valider plan, øvelse og artefakter
```
