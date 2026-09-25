<!-- GENERERET af compliance/src/assurance-cli.mjs fra compliance/assurance-register.json. Redigér registeret, ikke denne fil. -->

# Evidens- og risikoregister

Evidens- og risikoregister for platformen. Knytter krav til kontroller, ansvarlige personer og verificeret evidens; beskriver DPIA-screening, databehandleraftaler, underdatabehandlere og overførselsvurdering, AI Act-/NIS2-anvendelighed, incidentproces, adgangsrevision, informationspligt og kundens exitprocedure. Registeret er en påstand om mekanismer og beslutninger — ikke en certificering.

Version 1.0.0 · sidst gennemgået 2026-09-24 · **certificering:** nej (registeret er en påstand om mekanismer og beslutninger).

## Rollefordeling

- **Udgiver:** Platformen stiller kontrakter, konformanstests og evidensmaskineri til rådighed og beviser dem i CI. Det gør ikke organisationen compliant.
- **Deployer:** Den ansvarlige organisation konfigurerer, driver og overvåger mekanismen, fører tilsyn og indberetter hændelser. Den bærer det juridiske ansvar.
- **Delt:** Ansvaret er delt: platformen leverer mekanismen, men den virker kun, hvis deployeren aktiverer den og reagerer på signalerne.

## Anvendelighed efter brug, rolle og sektor

| Framework | Brug | Sektor | Rolle | Anvendelig | Vurderet af |
| --- | --- | --- | --- | --- | --- |
| nis2 | Drift af en multi-tenant AI- og automatiseringsplatform for kunder | digital-infrastructure | deployer | ja | Cecilia Christensen |
| ai-act | AI-assisteret sagsbehandling og beslutningsstøtte med menneskeligt tilsyn | horizontal | shared | ja | Anna Andersen |
| gdpr | Behandling af persondata på vegne af kunder som databehandler | cross-sector | deployer | ja | Anna Andersen |

## DPIA-screening

| Screening | Behandling | Resultat | DPIA | Vurderet af | Blokerer |
| --- | --- | --- | --- | --- | --- |
| `dpia-audit-service` | audit-service | pending | — | — | ja |
| `dpia-dummy-ok` | dummy-ok | not-required | — | Anna Andersen | nej |
| `dpia-privacy-operator` | privacy-operator | not-required | — | Anna Andersen | nej |

## Databehandleraftaler

| Aftale | Part | Aftale-reference | Godkendt af | Underdatabehandlere |
| --- | --- | --- | --- | --- |
| `platform-processor` | Platformen | contracts/dpa/platform-processor.md | Anna Andersen | anthropic-eu, openai-eu |

## Overførselsvurdering

| Vurdering | Underdatabehandler | Status | Grundlag | Vurderet af |
| --- | --- | --- | --- | --- |
| `anthropic-eu-transfer` | anthropic-eu | present | scc | Anna Andersen |
| `openai-eu-transfer` | openai-eu | pending | — | — |

## Incident, adgangsrevision, informationspligt og exit

- Incidentproces: `docs/runbooks/incident-response.md`
- Indberetning `gdpr-breach-72h` (gdpr-art33): inden 72 timer til tilsynsmyndigheden, ejer Anna Andersen
- Indberetning `nis2-early-warning-24h` (nis2-art23): inden 24 timer til CSIRT, ejer Cecilia Christensen
- Adgangsrevision hvert 90. døgn, ejer Cecilia Christensen; senest 2026-07-01
- Informationspligt: `docs/compliance/incident-access-exit.md#informationspligt`, ejer Anna Andersen
- Kundens exit: `docs/runbooks/customer-exit.md` (eksport: ja, sletning: ja, 90 dage)

## Kravregister

| Krav | Kilde | Dato | Ansvarlig | Status | Kontrol | Evidens | Beslutning |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `REQ-NIS2-001` | nis2-art21-2b | 2026-09-24 | Cecilia Christensen | verified | si-4 | assurance-incident-drill | — |
| `REQ-GDPR-001` | gdpr-art30 | 2026-09-24 | Anna Andersen | implemented | si-12 | assurance-data-register | DEC-001 |
| `REQ-GDPR-002` | gdpr-art44 | 2026-09-24 | Anna Andersen | implemented | si-12 | assurance-transfer-vurdering | DEC-002 |
| `REQ-AIACT-001` | ai-act-art14 | 2026-09-24 | Bo Bertelsen | open | au-2 | assurance-ai-oversight | — |
| `REQ-NIS2-002` | nis2-art21-2i | 2026-09-24 | Cecilia Christensen | verified | ac-2 | assurance-access-review | DEC-003 |

## Risici

| Risiko | Kategori | Ejer | Restrisiko | Status | Blokerer pilot |
| --- | --- | --- | --- | --- | --- |
| `RISK-ASSURANCE-001` Uafklaret DPIA og overførselsvurdering blokerer persondatapilot | privacy | Anna Andersen | high | open | ja |
| `RISK-ASSURANCE-002` Manglende produktionsevidence kan forveksles med certificering | assurance | Cecilia Christensen | medium | mitigated | nej |

## Juridiske og organisatoriske beslutninger

| Beslutning | Type | Status | Ansvarlig | Truffet af | Dato |
| --- | --- | --- | --- | --- | --- |
| `DEC-001` DPIA for AI-assisteret behandling af persondata | legal | open | Anna Andersen | — | — |
| `DEC-002` Overførselsmekanisme for modelunderleverandører | legal | decided | Anna Andersen | Anna Andersen | 2026-09-24 |
| `DEC-003` Kadence og ejerskab for adgangsrevision | organisational | accepted | Cecilia Christensen | Cecilia Christensen | 2026-07-01 |

## Blokere for en pilot med persondata

- **dpia** `dpia-audit-service`: DPO-vurdering udestår. Behandlingen omfatter persondata og AI-genereret logning, så en fuld DPIA kan være påkrævet.
- **transfer** `openai-eu-transfer`: Den endelige overførselsvurdering for supportadgang udestår og er en blokerende uafklaret beslutning.
- **decision** `DEC-001`: DPO og Platform Owner skal vurdere behandlingen, før en pilot med persondata kan frigives. Beslutningen er ikke truffet.
- **risk** `RISK-ASSURANCE-001`: Pilot med persondata er spærret, indtil DPIA og overførselsvurdering er gennemført og godkendt af et navngivet menneske.

