# DPIA-note: projektstyringsmodulet (OpenProject)

> DKC-027. Foreløbig vurdering; den endelige DPIA er en menneskelig/legal
> beslutning og er ikke gennemført her.

## Behandling

Adapteren behandler kundens projekter, arbejdspakker, ansvarlige,
projektmedlemskaber, vedhæftninger og statushændelser for en kundes brugere og
eksterne projektgæster. Platformen er **databehandler**; kunden er dataansvarlig.

## Datakategorier

- almindelige forretningsoplysninger (projektplaner, opgaver, afhængigheder)
- pseudonymiserede metadata (medlemskaber, aktivitets-ID'er)
- personoplysninger om ansvarlige og medlemmer, herunder potentielt særlige
  kategorier i fritekstfelter og vedhæftninger

## Risici og afbødning

| Risiko | Afbødning |
| --- | --- |
| Projektgæst får adgang til et fremmed projekt | default-deny `decideProjectAccess`; medlemskab filtreres pr. projekt; gæst ser kun eget projekt |
| Medlemskab i ét projekt giver adgang til et andet | `projectRole` filtrerer på `projectId`; fremmed tenant afvises |
| Rettigheder ændres, men søgning/AI svarer gammelt | versionsstyret projektion; `isProjectionFresh` afviser forældet indeks fail-closed |
| Gentaget import skaber dubletter | kanonisk importplan matchet på stabil `externalId`; idempotent ved retry |
| Ufuldstændig sletning | `subject.erase` er `partial`; medlemskaber fjernes og opgaver afknyttes, resterende kopier rapporteres og håndteres af DKC-021 |
| Backup genindfører slettede data | slettejournalen anvendes ved restore (DKC-016/DKC-021) |

## Konklusion

Behandlingen kan gennemføres med de beskrevne afbødninger. En formel DPIA og en
overførselsvurdering for eventuelle underdatabehandlere mangler og er en
menneskelig beslutning.
