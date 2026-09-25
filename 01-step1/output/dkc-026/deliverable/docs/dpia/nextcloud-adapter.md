# DPIA-note: arbejdspladsmodulet (Nextcloud)

> DKC-026. Foreløbig vurdering; den endelige DPIA er en menneskelig/legal
> beslutning og er ikke gennemført her.

## Behandling

Adapteren behandler kundens filer, delinger, kalendere og kontoredaktørens
dokumenter for en kundes brugere og eksterne gæster. Platformen er
**databehandler**; kunden er dataansvarlig.

## Datakategorier

- almindelige forretningsoplysninger (filer, kalender)
- pseudonymiserede metadata (delinger, sessions-ID'er)
- personoplysninger i filindhold, herunder potentielt særlige kategorier

## Risici og afbødning

| Risiko | Afbødning |
| --- | --- |
| Uautoriseret deling | default-deny `decideFileAccess`; ekstern deling kræver kundepolitik |
| Offentligt link lækker data | adgangskode, udløb, maksimal levetid og forbud mod upload |
| Gæst beholder adgang efter ophør | suspension lukker sessioner; fjernelse tilbagekalder delinger og sletter brugeren |
| Ufuldstændig sletning | `subject.erase` er `partial`; resterende kopier rapporteres og håndteres af DKC-021 |
| Backup genindfører slettede data | slettejournalen anvendes ved restore (DKC-016/DKC-021) |

## Konklusion

Behandlingen kan gennemføres med de beskrevne afbødninger. En formel DPIA og en
overførselsvurdering for eventuelle underdatabehandlere mangler og er en
menneskelig beslutning.
