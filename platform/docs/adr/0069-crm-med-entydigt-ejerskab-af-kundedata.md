# CRM med entydigt ejerskab af kundedata

- **Status:** accepteret
- **Beslutningstagere:** Anna Andersen (Platform Owner), Cecilia Christensen (Security Owner)
- **Dato:** 2026-10-04
- **Beslutningsdrev:** DKC-030 kræver, at kontakter, virksomheder og salgsforløb leveres uden ukontrollerede kopier på tværs af apps, med EspoCRM eller ERPNext valgt efter en kandidatcheck, en stabil tenantafgrænset reference, system-of-record, dublethåndtering, kontaktaktiviteter og rollebeskyttelse.

## Kontekst og problemstilling

Platformen har en fælles adapter-SDK (DKC-023), sletning/legal hold (DKC-021),
en portal med kundens livscyklus (DKC-025) og domæneafgrænset dedup (DKC-043).
CRM-data er imidlertid identitetsbærende: en kontakt er en person, en
virksomhed er en kunde, og et salgsforløb er fortroligt. Kopieres data
ukontrolleret mellem apps, kan et salgsteam læse en anden kundes CRM, en
gentaget import skabe dubletter, to poster med samme identitet blive slået
sammen ved en fejl, eller en sletning efterlade persondata i aktiviteter,
indeks og kopier. En upstream-id er desuden ikke tenantafgrænset.

## Beslutningskriterier

- Vælg EspoCRM eller ERPNext efter en dokumenteret kandidatcheck.
- Gør upstream til system-of-record og map hvert upstream-id til en **stabil,
  tenantafgrænset reference**.
- Gør import idempotent på en idempotency-nøgle; flet aldrig dublerede
  forretningsposter automatisk.
- Beskyt roller: et salgsteam må ikke læse en anden kundes CRM, og en fortrolig
  post kræver en tilsvarende klarering.
- Lad tværgående sletning følge ejerskab, legal hold og retention, også i
  kopier.
- Bevar og gendan poster og aktiviteter.

## Overvejede muligheder

- **A:** Kopiér CRM-data frit mellem apps og filtrér i UI'et.
- **B:** Vælg EspoCRM efter kandidatcheck, spejl poster i en filbaseret butik
  med en tenantafgrænset stabil reference, idempotent import, dedup uden
  automatisk fletning, rollebeskyttelse og tværgående sletning med retention og
  kopier.
- **C:** Stol på, at den enkelte app og bruger respekterer kundegrænsen.

## Beslutning

Vi vælger **B**. `crm/sources.json` beskriver EspoCRM-kilder med tenant,
secretreference, ejerskabsfelt, entitetstyper, roller, dedup-nøgler og
retention. `crm/src/candidate-check.mjs` vurderer EspoCRM og ERPNext på
OIDC-SSO, REST-API, isolation, eksport og licens og vælger EspoCRM (dedikeret
database pr. tenant). `crm/src/espocrm.mjs` er en tynd adapter, og
`crm/src/mock-espocrm.mjs` er testdobbelen. `crm/src/references.mjs` bygger den
stabile reference `crm:<tenant>:<entityType>:<upstreamId>` og afviser
tværtenant-referencer. `crm/src/dedup.mjs` gør import idempotent på en
idempotency-nøgle, finder dubletter på forretningsidentitet og flettes aldrig
automatisk (DKC-043's `assertStorageDedupAllowed`). `crm/src/sync.mjs`
importerer, opdaterer og eksporterer med stabil reference. `crm/src/permissions.mjs`
håndhæver default-deny, tenantisolation og rollebeskyttelse. `crm/src/retention.mjs`
sletter på tværs af primær, aktiviteter, indeks, kopier og backup, blokerer ved
et legal hold og opgiver en WORM-låst backupkopi med udløb. Rapporten erklærer
`measured: false`; den målte integration er `make crm-live` og er NOT RUN.

### Konsekvenser

- **Positive:** En kunde kan ikke læse en anden kundes CRM; et retry skaber
  ingen dublet; dublerede forretningsposter kræver et menneske; en sletning
  rammer også kopier; historik og gendannelse er intakt.
- **Negative:** Kandidaten er ikke godkendt af et menneske i dette miljø, og en
  målt integration mod en levende EspoCRM mangler.
- **Neutrale:** CRM er en ny førstepartsevne i `crm/`; den genbruger
  tenant-konteksten, adapter-SDK'ens kandidatmodel, DKC-043's dedup og DKC-021's
  holds.

## Fordele og ulemper ved mulighederne

| Mulighed | Fordele | Ulemper |
| --- | --- | --- |
| A | Simpelt | Lækker på tværs af kunder; dubletter; automatisk fletning; sletning rammer ikke kopier |
| B | Stabil reference, idempotent import, rollebeskyttelse, ærlig sletning med kopier | Kræver en kandidatgodkendelse og en ekstern målt integration |
| C | Ingen kode | Uacceptabelt; adgang og ejerskab må ikke hvile på en app eller en prompt |

## Mere information

- [`docs/spec/crm.md`](../spec/crm.md), [`docs/crm/crm-report.md`](../crm/crm-report.md), [`docs/crm/espocrm-live.md`](../crm/espocrm-live.md), [`docs/operations/crm.md`](../operations/crm.md)
- [`crm/sources.json`](../../crm/sources.json), [`contracts/crm-source.schema.json`](../../contracts/crm-source.schema.json), [`contracts/crm-record.schema.json`](../../contracts/crm-record.schema.json), [`contracts/crm-deletion-receipt.schema.json`](../../contracts/crm-deletion-receipt.schema.json)
- [`docs/adr/0036-faelles-adapter-sdk-og-godkendelsestest.md`](0036-faelles-adapter-sdk-og-godkendelsestest.md), [`docs/adr/0049-sletning-legal-hold-og-gendannelsesregler.md`](0049-sletning-legal-hold-og-gendannelsesregler.md), [`docs/adr/0052-sikker-deduplikering-og-kontrolleret-oprydning.md`](0052-sikker-deduplikering-og-kontrolleret-oprydning.md)
