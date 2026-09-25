# CRM med entydigt ejerskab af kundedata

DKC-030 leverer kontakter, virksomheder og salgsforløb med **EspoCRM** valgt
efter en kandidatcheck og som system-of-record. Hver post spejles med en
**tenantafgrænset, stabil reference** og et entydigt ejerskab. Import er
idempotent, dublerede forretningsposter flettes aldrig automatisk, adgang er
default-deny og rollebeskyttet, og tværgående sletning følger ejerskab, legal
hold og retention også i kopier.

## Dataflyt

```
crm/sources.json        (EspoCRM-kilder, ejerskab, roller, dedup-nøgler)
        │  crm/src/espocrm.mjs  (mapper EspoCRM-poster)
        ▼
crm/src/sync.mjs  →  crm/src/store.mjs  (filbutik, epoch, kopier, idempotens)
        │  crm/src/dedup.mjs   (idempotency-nøgle + forretningsidentitet)
        │  crm/src/permissions.mjs (tenant + rolle + klarering, default-deny)
        ▼
crm/src/retention.mjs  (sletning på tværs af primær/aktiviteter/indeks/kopier/backup)
        ▼
crm/report/crm-report.json  +  docs/crm/crm-report.md
```

## Beslutningssemantik

- **Kandidatcheck.** EspoCRM og ERPNext vurderes på OIDC-SSO, dokumenteret
  REST-API, tenantisolation, API-eksport og licens. EspoCRM vælges på en
  dedikeret database pr. tenant. `crm/src/candidate-check.mjs` er
  deterministisk, og en kandidat er ikke godkendt af et menneske i dette miljø.
- **System-of-record og stabil reference.** EspoCRM er `systemOfRecord:
  upstream` og `writeMode: adapter-mediated`. Upstream-id'et mappes til
  `crm:<tenant>:<entityType>:<upstreamId>`, som er stabilt gennem opdateringer
  og afvises på tværs af tenants.
- **Entydigt ejerskab.** Hver post bærer `owner.subject`; en import uden ejer
  bruger kildens standardejer, og en post uden ejerskab afvises.
- **Idempotent import og dublethåndtering.** Et retry med samme
  idempotency-nøgle returnerer den samme post. Findes posten på sin
  forretningsidentitet (fx e-mail eller CVR), opdateres den; er den en anden
  upstream-post, er det en konflikt der kræver et menneske — aldrig en
  automatisk fletning.
- **Rollebeskyttelse.** Adgang er default-deny: tenant skal matche, principalen
  skal have en rolle der må læse entitetstypen, og en fortrolig post kræver en
  tilsvarende klarering. Et salgsteam kan ikke læse en anden kundes CRM.
- **Tværgående sletning.** Sletningen kræver ejerskab eller skriveadgang i
  samme tenant, blokeres af et legal hold og er fladvis: primær (tombstone),
  aktiviteter, indeks, platformens kopier og backup. En WORM-låst backupkopi
  opgives ærligt med udløb.

## Grænser og ærlighed

Kandidatchecken, referencen, import/opdatering/eksport, retry, dublethåndtering,
rollebeskyttelsen, sletningen og backup/gendannelsen er efterprøvet
deterministisk mod en mock-upstream (`measured: false`). En faktisk målt
integration mod en levende EspoCRM og en menneskelig kandidatgodkendelse kræver
ekstern infrastruktur og er **NOT RUN** (`make crm-live`).

Se [`docs/crm/espocrm-live.md`](../crm/espocrm-live.md) for hvad der udestår, og
[`docs/operations/crm.md`](../operations/crm.md) for drift.
