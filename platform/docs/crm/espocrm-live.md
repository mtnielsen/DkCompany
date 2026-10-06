# Målt integration mod en levende EspoCRM (NOT RUN)

`make crm-live` er **NOT RUN** i dette miljø. Der findes ingen levende
EspoCRM-installation, intet rigtigt API-token og ingen menneskelig
kandidatgodkendelse at måle imod.

## Hvad der er efterprøvet i stedet

Kandidatchecken, den tenantafgrænsede reference, import/opdatering/eksport, den
idempotente retry, dublethåndteringen uden automatisk fletning,
rollebeskyttelsen, den tværgående sletning og backup/gendannelsen køres
deterministisk mod en mock-upstream med en rigtig filbutik:

```bash
make crm-run
make crm-check
make crm-test
```

Det dækker:

- en kandidatcheck der vælger EspoCRM på en dokumenteret rangering,
- en kunde/kontakt der importeres, opdateres og eksporteres med en stabil
  tenantafgrænset reference,
- et retry med samme idempotency-nøgle der ikke skaber en dublet,
- en dubleret forretningsidentitet der giver en konflikt i stedet for en
  automatisk fletning,
- et salgsteam der ikke kan læse en anden kundes CRM, og en rolle der ikke må
  læse et salgsforløb,
- en tværgående sletning der følger ejerskab, legal hold og retention på alle
  flader og kopier, med en WORM-låst backupkopi opgivet ærligt, og
- en backup/gendannelse der bevarer poster og aktiviteter.

## Hvad der udestår

- En faktisk EspoCRM-installation med et scoped API-token.
- En menneskelig kandidatgodkendelse af EspoCRM og en testet gendannelse
  (DKC-016).
- En rigtig import/opdatering/eksport og en rigtig sletning i upstream gennem
  adapteren.
- En målt tid fra sletning til sidste kopi (indeks, kopier, backup) er væk.

Indtil da forbliver `integration-espocrm-live` NOT RUN, og rapporten erklærer
`measured: false`.
