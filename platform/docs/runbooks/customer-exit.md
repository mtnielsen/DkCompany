# Runbook — kundens exitprocedure

DKC-022. Denne runbook beskriver, hvordan et kundeforhold afvikles sikkert:
dataeksport, sletning, adgangslukning og overgangsperiode. Proceduren har en
navngiven ejer i evidens- og risikoregisteret.

## 1. Aftal exit

- Bekræft opsigelsen skriftligt med kunden.
- Aftal overgangsperioden (standard: 90 dage) og formatet for dataeksport.
- Udpeg en ansvarlig hos både kunden og platformen.

## 2. Dataeksport

- Eksportér kundens data i et dokumenteret, maskinlæsbart format.
- Eksporten er tenant-afgrænset: ingen andre kunders data kan følge med.
- Eksporten nævnes i [`docs/spec/privacy-process.md`](../spec/privacy-process.md)
  og leveres af privacy-processen (DKC-020).

## 3. Sletning

- Anvend [`retention/deletion-policy.json`](../../retention/deletion-policy.json)
  og den dokumenterede sletteproces (DKC-021).
- Sletning dækker primærlager, indeks, cache, afledte AI-data og backups, og
  resterende kopier rapporteres ærligt med udløb.
- En gendannelse forbliver i karantæne og genanvender slettebeslutninger, før
  miljøet frigives.

## 4. Adgangslukning

- Luk kundens identiteter, tokens og servicekonti.
- Gennemfør en adgangsrevision efter
  [`docs/compliance/incident-access-exit.md`](../compliance/incident-access-exit.md#adgangsrevision).

## 5. Afslutning

- Bekræft over for kunden, at eksport er leveret og data slettet.
- Bevar kun det, der er lovpligtigt, med en dokumenteret frist.
- Registrér exit som en menneskelig beslutning i evidens- og risikoregisteret.

## 6. Evidens

- `make assurance-check` — exitprocedure og ejer.
- `make retention-demo` — sletningsdækning på den rigtige stak.
- `make dsar-demo` — eksportprocessen.
