# Forbrugs- og driftsomkostningsmåling

- **Status:** accepteret
- **Beslutningstagere:** Anna Andersen (Platform Owner), Cecilia Christensen (Security Owner)
- **Dato:** 2026-10-01
- **Beslutningsdrev:** DKC-034 kræver, at en faktisk besparelse bevises frem for kun færre licenser, og at forbrug og driftsomkostninger måles pr. tenant med prognose, stopgrænser og afstemning.

## Kontekst og problemstilling

Platformen har allerede servicepakker med pris (DKC-025), telemetri og
overvågning (DKC-017), kapacitets- og enhedsprismodel (DKC-050) og et
deployments- og identitetsgrundlag (DKC-002). Men en liste over sparet
licensomkostning er ikke et bevis for en faktisk besparelse. Uden en måling pr.
tenant — der skelner mellem faktisk og estimeret forbrug, mellem udmålte og
manuelt indtastede supportomkostninger, og mellem en model og en faktisk
afstemning — kan platformen hverken give kunden en troværdig prognose, en
stopgrænse eller et ærligt svar på, om driften er billigere.

## Beslutningskriterier

- Compute, storage, backup, modelkald, integrationer, driftstid, support,
  betalte upstreamfeatures og migration måles pr. tenant og pakke.
- Konfigurerbare prisinput med valuta, gyldighedstidspunkt og leverandørstatus.
- En manglende pris afvises frem for at regnes som nul.
- En gentaget hændelse dobbelttælles ikke; tenant-isolation er håndhævet.
- Kunden kan se prognose og stopgrænse.
- Forbrug kan afstemmes mod driftsudgifter uden at være falsk grøn.
- Tre virksomhedsprofiler sammenlignes mod deres faktiske udgangspunkt.
- Ingen målt besparelsespåstand, ingen påstand om gratis drift og ingen påstand
  om fuld SaaS-erstatning uden dokumentation.

## Overvejede muligheder

- **A:** Et regneark med listepriser og en påstand om besparelse.
- **B:** En metering-model med prisbog, idempotent forbrugsjournal,
  tenant-autoriseret rapport, prognose, stopgrænser, afstemning og en
  TCO-sammenligning, der erklærer `measured: false` og forbyder ugrundede
  besparelsespåstande.
- **C:** Kun færre licenser som bevis.

## Beslutning

Vi vælger **B**. `metering/price-book.json` (`PriceBook`) samler priser pr.
måler med valuta og gyldighedstidspunkt, valutakryds, manuelle omkostninger og
leverandørvedligeholdelse. `metering/usage-ledger.json` (`UsageLedger`) bærer
forbrugshændelser pr. tenant med en idempotency-nøgle, herkomst
(`actual`/`estimated`) og en stopgrænse. `metering/src/pricing.mjs` vælger en pris
efter tidspunkt og afviser en manglende pris eller kurs;
`metering/src/aggregate.mjs` dedupliker og aggregerer strengt tenant-scopet;
`metering/src/authorization.mjs` kræver en verificeret principal med en
læserrolle (eller en scopet platformrolle) for eksport. `metering/src/report.mjs`
bygger rapporten med prognose, stopgrænse, uudmålte omkostninger og afstemning,
og `metering/src/tco.mjs` sammenligner tre virksomhedsprofiler mod deres
faktiske udgangspunkt. Rapporten erklærer `measured: false`; den målte
afstemning er `make metering-live` og er **NOT RUN**.

### Konsekvenser

- **Positive:** Forbrug og omkostninger er målbare pr. tenant; dubletter og
  valuta-inkonsistens afvises; kunden får prognose og stopgrænse; afstemningen
  kan ikke grønnes uden driftsudgiftsdata; besparelsespåstande kræver
  dokumentation.
- **Negative:** Prisbog, manuelle omkostninger og driftsudgifter skal
  vedligeholdes, og en faktisk fakturaafstemning mangler stadig.
- **Neutrale:** Metering er en ny førstepartsevne i `metering/`; den genbruger
  tenant-konteksten og porte-/prismønstret fra DKC-006 og DKC-025.

## Fordele og ulemper ved mulighederne

| Mulighed | Fordele | Ulemper |
| --- | --- | --- |
| A | Hurtigt | Ingen måling; påstanden kan ikke efterprøves |
| B | Målbar, idempotent, tenant-isoleret, ærlig om det uudmålte | Kræver vedligeholdt prisbog og en ekstern faktura |
| C | Simpelt | Beviser kun færre licenser, ikke en besparelse |

## Mere information

- [`docs/spec/metering-and-cost.md`](../spec/metering-and-cost.md), [`docs/business/tco-comparison.md`](../business/tco-comparison.md), [`docs/costs/cost-report.md`](../costs/cost-report.md), [`docs/operations/cost-control.md`](../operations/cost-control.md), [`docs/metering/metering-live.md`](../metering/metering-live.md)
- [`metering/price-book.json`](../../metering/price-book.json), [`contracts/cost-report.schema.json`](../../contracts/cost-report.schema.json), [`contracts/tco-comparison.schema.json`](../../contracts/tco-comparison.schema.json)
- [`docs/adr/0054-portal-og-kundelivscyklus.md`](0054-portal-og-kundelivscyklus.md), [`docs/adr/0062-kapacitetsbevis-og-vandret-skalering.md`](0062-kapacitetsbevis-og-vandret-skalering.md)
