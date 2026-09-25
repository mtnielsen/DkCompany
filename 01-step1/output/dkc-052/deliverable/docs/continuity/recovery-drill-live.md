# Målt beredskabsøvelse på levende hosts og kanaler (NOT RUN)

`make takeover-live` er den målte øvelse, der endnu **ikke** er udført. Den
deterministiske øvelse i `docs/continuity/recovery-drill-report.md` er en model
med `measured: false`. Den er ikke det samme som en målt overtagelse.

## Hvad der allerede er efterprøvet

- Trin- og tilstandsmodellen i `continuity/src/takeover.mjs` kører
  `takeover → restore → failback → validation` for både single-server- og
  HA-scenarier.
- Maskintrin kalder de rigtige moduler: HA-failover (DKC-038), database-failover
  med rejoin (DKC-039), lager-holdbarhed (DKC-041), recovery-adgangsprofilen
  (DKC-042), fejlmatrixen (DKC-051) og autonomibevillingen (DKC-032).
- Menneskelige out-of-band-trin forbliver `pending`, og deres eskalationskæde
  ender altid hos et navngivet menneske.
- `agentCanApprove` er `false`; en `validated`-øvelse kræver en menneskelig
  incidentaccept og målt dataintegritet.

## Hvad der mangler, og hvorfor

| Manglende ressource | Konsekvens |
| --- | --- |
| Levende hosts/klynge | Failover, gendannelse og failback er ikke målt på rigtige maskiner. |
| Uafhængig kontaktkanal (telefonbro/SMS) | Eskalationerne er ikke faktisk leveret til testmodtagerne. |
| Menneskelige operatører | Ingen har udført de out-of-band-trin; de forbliver `pending`, og ingen ejerbeslutning er afgivet. |
| Eksterne recovery-kopier | Offline-runbooks og credentials er ikke fysisk verificeret i øvelsen. |
| Målt dataintegritet | Integriteten er målt på den deterministiske model, ikke efter en rigtig gendannelse. |

## Procedure når miljøet findes

1. Sæt øvelsen op i et isoleret recovery-miljø med rigtige hosts og de faktiske
   testmodtagere på den uafhængige kanal.
2. Udfør de menneskelige trin med navngivne operatører og registrér evidensen.
3. Kør `make takeover-run` og arkivér rapporten som ekstern evidens.
4. En `validated`-øvelse kræver fortsat en menneskelig incidentaccept; agenten
   må ikke lukke incidenten eller godkende beredskabet.
5. Sammenlign den målte dataintegritet og RTO/RPO med planens prioritet og
   serviceklassernes mål.

Den målte øvelse skal vise separate resultater for single-server og HA, binde
hvert resultat til artefakt-digest, profil, operatør og tidsstempel, og
efterlade en dokumenteret ejerbeslutning for både gendannelse og failback.
