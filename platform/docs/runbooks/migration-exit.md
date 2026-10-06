# Runbook — migration ind og exit ud

DKC-031. Denne runbook beskriver, hvordan en virksomhed flytter ind i og ud af
platformen uden at miste indhold og rettigheder. Proceduren har en navngiven
ejer i evidens- og risikoregisteret.

## Forudsætninger

- Ét valgt, dokumenteret kildeformat pr. pilotapp er aftalt og beskrevet i
  [`docs/migration/exit-export.md`](../migration/exit-export.md).
- En operatør med en dækkende rolle og tenantbinding.
- En pilotbruger i kundens tenant der kan godkende indhold og
  adgangsrettigheder.

## Indflytning

1. **Dry-run.** Kør `make migration-dry-run`. Afstem antal og checksums, og
   gennemgå fejllisten og den tabte funktionalitet.
2. **Beslut.** En menneskelig beslutningstagere afgør, om den tabte
   funktionalitet er acceptabel. Uden en beslutning fortsætter forløbet ikke.
3. **Import.** Kør importen. Den er resumabel og idempotent; et afbrudt forløb
   genoptages uden dubletter.
4. **Konflikter.** En dubleret forretningsidentitet bliver en konflikt i
   fejllisten. Den løses af et menneske — der flettes aldrig automatisk.
5. **Godkendelse.** Pilotbrugeren godkender indhold **og**
   adgangsrettigheder.
6. **Cutover.** Tag et snapshot, og gennemfør cutover. Bekræft over for kunden.

## Exit

1. **Aftal exit** skriftligt, og aftal formatet for eksporten.
2. **Eksportér.** Kør `make migration-export`. Eksporten er tenantafgrænset og
   kan læses uden platformen (`read-export.mjs`).
3. **Verificér.** Kør `node read-export.mjs <mappe>`, og afstem antal og
   checksum.
4. **Slet** efter retention og legal hold (DKC-021).
5. **Luk adgang** for kundens identiteter, tokens og servicekonti.
6. **Registrér** exit som en menneskelig beslutning i evidens- og
   risikoregisteret.

## Rollback

Hvis en cutover skal rulles tilbage, gendannes snapshot'et fra før cutover.
Både poster og rettigheder gendannes, og den gamle kilde genåbnes som
system-of-record.

## Evidens

- `make migration-run` — den deterministiske migration.
- `make migration-render` — rapporten med dækning og scenarier.
- `make migration-check` — skema og semantik.
- Den målte migration (`make migration-live`) er **NOT RUN** uden en levende
  kilde og en menneskelig pilotgodkendelse.
