# Runbook — omkostningskontrol

Denne runbook beskriver den menneskelige drift af forbrugs- og
omkostningsmålingen. Modellen måler ikke selv; den samler prisbog, forbrug og
driftsudgifter og kræver et menneske til at bekræfte priser, afstemning og
forbrugerrettet kommunikation.

## Roller

| Rolle | Ansvar | Kilde |
| --- | --- | --- |
| Platform Owner | Prisbog, afstemning, release af rapporten | `metering/price-book.json` |
| Support Lead | On-call- og supportomkostning (manuel) | `metering/price-book.json` (`manualCosts`) |
| Vendor Manager | Betalte upstreamfeatures og leverandørstatus | `metering/price-book.json` (`vendors`) |
| Den enkelte kunde | Stopgrænse og forbrugsvisning | `metering/usage-ledger.json` (`stopLimit`) |

## Månedlig kontrol

1. **Prisbog.** Bekræft at hver måler har en aktiv pris eller en manuel
   omkostning, og at `missingPricePolicy` stadig er `reject`.
   `make metering-check` afviser en ufuldstændig prisbog.
2. **Valuta.** Bekræft at alle anvendte valutaer har en vekselkurs til
   rapportvalutaen. Uden en kurs afvises hændelsen.
3. **Forbrug.** Kør `make metering-run` og bekræft at kendte dubletter fjernes,
   at ingen pris regnes som nul, og at tenant-isolationen holder.
4. **Afstemning.** Sammenlign `metering/report/cost-report.json` med
   `metering/operating-costs.json`. En afvigelse over tolerancen giver
   `unreconciled` og skal undersøges, ikke skjules.
5. **Uudmålt support.** Indtast on-call- og upstreamomkostninger manuelt. Hvis
   de ikke kan dokumenteres, forbliver de `ikke udmålt` i rapporten.

## Stopgrænser

- `onExceed: block` standser forbruget, når grænsen nås; `warn` advarer.
- `warningPercent` udløser en advarsel før grænsen.
- Prognosen bruger `forecastMethod` (`straight-line` eller `trailing-30d`).
  Kunden kan se både prognose og stopgrænse i forbrugsrapporten.

## Vedligeholdelsesstatus og patchvinduer

Hver leverandør i prisbogen har en `maintenanceStatus`
(`supported`/`maintenance`/`eol`/`unknown`) og et `patchWindow`. En leverandør
med status `eol` afvises, så en udgået komponent ikke stiltiende bliver en del af
en prisbog til drift. Patchvinduet koordineres med support- og on-call-planen.

## Eskalation

- Uafstemt forbrug eskaleres til Platform Owner.
- En manglende pris eller kurs eskaleres straks; rapporten må ikke udgives med et
  manglende input.
- En påstand om gratis drift eller fuld SaaS-erstatning kræver dokumentation og
  en navngiven ejer; ellers afvises den af `claims`-politikken.

## Noter

- Rapporten er en model (`measured: false`). En målt afstemning er
  `make metering-live` og er **NOT RUN**, indtil der findes en levende faktura og
  et faktisk driftsregnskab.
