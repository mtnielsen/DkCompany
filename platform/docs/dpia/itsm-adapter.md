# DPIA-note: ITSM-modulet (GLPI)

> DKC-044. Foreløbig vurdering; den endelige DPIA er en menneskelig/legal
> beslutning og er ikke gennemført her.

## Behandling

Adapteren behandler sagsrecords i GLPI (incidents, requests, problemer, kendte
fejl og changes) for en kundes brugere og den vagthavende organisation.
Platformen er **databehandler**; kunden er dataansvarlig.

## Datakategorier

- almindelige forretningsoplysninger (sagsbeskrivelser, tjenester, CI-relationer)
- pseudonymiserede metadata (principal, tenant-id, trace-id)
- personoplysninger om den registrerede og den vagthavende (navn, kontaktkanal)

## Risici og afbødning

| Risiko | Afbødning |
| --- | --- |
| Kunden ser andre kunders sager | `customerCases` er default-deny og filtrerer på tenant |
| En AI lukker en major incident alene | `majorIncidentCloseProblems` nægter AI-lukning og kræver menneskelig kvittering og godkendelse |
| En agent kombinerer roller | `serviceProcessProblems` afviser en agent med flere roller og forbudte AI-roller |
| Ufuldstændig sletning | `subject.erase` er `partial`; resterende kopier rapporteres og håndteres af DKC-021 |
| Backup genindfører slettede data | slettejournalen anvendes ved restore (DKC-016/DKC-021) |

## Konklusion

Behandlingen kan gennemføres med de beskrevne afbødninger. En formel DPIA og en
overførselsvurdering for eventuelle underdatabehandlere mangler og er en
menneskelig beslutning.
