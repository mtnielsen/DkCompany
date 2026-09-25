# Forbrugs- og driftsomkostningsmåling

DKC-034 gør det muligt at **måle** forbrug og driftsomkostninger pr. tenant og
sammenligne totalomkostningen for tre virksomhedsprofiler mod deres faktiske
udgangspunkt — uden at påstå en målt besparelse, når der ikke findes
sammenlignelige data.

## Dataflyt

```
metering/price-book.json      (configurerbare priser, valuta, tidspunkt, leverandører)
metering/usage-ledger.json    (forbrug pr. tenant: actual/estimated, idempotency-nøgle, stopgrænse)
metering/operating-costs.json (manuelt indtastede driftsudgifter til afstemning)
metering/company-profiles.json(3 profiler + claim-politik)
        │  metering/src/{pricing,aggregate,report,tco}.mjs
        ▼
metering/report/cost-report.json      docs/costs/cost-report.md
metering/report/tco-comparison.json   docs/business/tco-comparison.md
```

## Målere

| Måler | Betydning |
| --- | --- |
| `compute` | CPU-/hostforbrug |
| `storage` | Primærlager pr. GB-måned |
| `backup` | Backup-/objektlager pr. GB-måned |
| `model-calls` | AI-modelkald (tokens/1k) |
| `integrations` | Adaptere/integrationer pr. instans-måned |
| `runtime` | Plattformens egen drift (control plane) |
| `support` | Menneskelig support og on-call |
| `upstream-features` | Betalte upstreamfeatures (seats) |
| `migration` | Migrering/onboarding (engang) |

Hver måler skal have **enten** en pris i prisbogen **eller** en eksplicit manuel
omkostning. En manglende pris afvises (`missingPricePolicy: reject`) og regnes
aldrig som nul.

## Beslutningssemantik

- **Pris efter tidspunkt.** En pris vælges efter `effectiveFrom`/`effectiveTo` og
  det tidspunkt hændelsen indtraf, så en prisændring ikke efterregner historik.
- **Valuta.** Hændelsens valuta, prisens valuta og rapportens valuta skal kunne
  forbindes med en vekselkurs; ellers afvises hændelsen.
- **Idempotens.** Hændelser deduplices på `eventKey`; en gentaget levering efter
  et retry dobbelttælles ikke.
- **Tenant-isolation.** Aggregering og eksport er strengt tenant-scopet. En
  kunde skal have en eksplicit læserrolle (`billing-reader`/`tenant-admin`);
  kun en scopet platformrolle (`platform-admin:<tenant>`) kan eksportere på
  tværs.
- **Faktisk vs. estimeret.** Hver hændelse har `provenance: actual|estimated`,
  og rapporten holder de to beløb adskilt.
- **Uudmålt support.** On-call og betalte upstreamfeatures er eksplicit
  `manualCosts` med en ejer og en begrundelse; de indgår ikke i det faktiske
  forbrug, men vises i rapporten.
- **Afstemning.** Det faktiske forbrug afstemmes mod driftsudgifterne pr. tenant
  med en tolerance. Manglende driftsudgiftsdata giver
  `no-operating-expense-data`, ikke en falsk grøn afstemning.
- **Claim-politik.** Der må ikke påstås en målt besparelse uden
  `comparableDataRef`, ikke gratis drift og ikke fuld SaaS-erstatning uden
  dokumentation. Modellen erklærer derfor `measured: false`.

## Kontrakter

- `contracts/price-book.schema.json` (`PriceBook`)
- `contracts/usage-ledger.schema.json` (`UsageLedger`)
- `contracts/cost-report.schema.json` (`CostReport`)
- `contracts/tco-comparison.schema.json` (`TcoComparison`)

## Kommandoer

```bash
make metering-render   # skriv rapport og TCO-sammenligning
make metering-check    # validér skema, semantik og artefakter
make metering-test     # enheds- og konformanstests
make metering-run      # deterministisk kontrol (manglende pris, dublet, valuta, tenant)
make metering-report   # skriv forbrugsrapporten til stdout
make metering-live     # NOT RUN: kræver en levende faktura og et driftsregnskab
```
