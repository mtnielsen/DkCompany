# TCO-sammenligning for tre virksomhedsprofiler

> Genereret af `make metering-render`. Tallene er en **model**, ikke en målt besparelse.

- **Valuta:** EUR
- **Kundens udgangspunkt:** synthetic-vendor-invoices-2025
- **Målt:** nej

## Solo Håndværk ApS (18 medarbejdere)

- Nuværende månedsomkostning: 355,00 EUR (vendor-invoices-2025)
- Modelleret platformpris: 106,10 EUR
- Migrering (engang): 3.200,00 EUR
- 12-måneders TCO: 4.473,20 EUR
- Modeldifference pr. måned: 248,90 EUR (70.11 %) — ikke en målt besparelse

| Måler | Nu | Platform | Note |
| --- | ---: | ---: | --- |
| backup | 10,00 EUR | 0,00 EUR | Cloudbackup pr. måned |
| compute | 0,00 EUR | 14,70 EUR | Platformsmålt forbrug fra forbrugsjournalen |
| integrations | 30,00 EUR | 13,00 EUR | To SaaS-integrationer |
| migration | 0,00 EUR | 0,00 EUR | Ingen registreret omkostning |
| model-calls | 0,00 EUR | 8,00 EUR | Platformsmålt forbrug fra forbrugsjournalen |
| runtime | 0,00 EUR | 0,00 EUR | Ingen registreret omkostning |
| storage | 15,00 EUR | 5,40 EUR | Fildeling pr. måned |
| support | 120,00 EUR | 65,00 EUR | Ekstern IT-support |
| upstream-features | 180,00 EUR | 0,00 EUR | Seats i CRM og helpdesk |

_Kundens udgangspunkt er syntetiske listepriser fra 2025 og er ikke en faktura; platformprisen er en model, ikke en målt besparelse._

## Team Viden A/S (120 medarbejdere)

- Nuværende månedsomkostning: 1.450,00 EUR (vendor-invoices-2025)
- Modelleret platformpris: 761,30 EUR
- Migrering (engang): 6.400,00 EUR
- 12-måneders TCO: 15.535,60 EUR
- Modeldifference pr. måned: 688,70 EUR (47.5 %) — ikke en målt besparelse

| Måler | Nu | Platform | Note |
| --- | ---: | ---: | --- |
| backup | 90,00 EUR | 9,90 EUR | Cloudbackup pr. måned |
| compute | 0,00 EUR | 67,20 EUR | Platformsmålt forbrug fra forbrugsjournalen |
| integrations | 240,00 EUR | 39,00 EUR | Fem SaaS-integrationer |
| migration | 0,00 EUR | 0,00 EUR | Ingen registreret omkostning |
| model-calls | 0,00 EUR | 50,00 EUR | Platformsmålt forbrug fra forbrugsjournalen |
| runtime | 0,00 EUR | 28,80 EUR | Platformsmålt forbrug fra forbrugsjournalen |
| storage | 120,00 EUR | 32,40 EUR | Fildeling pr. måned |
| support | 480,00 EUR | 390,00 EUR | Support og on-call |
| upstream-features | 520,00 EUR | 144,00 EUR | Seats i CRM, helpdesk og vidensbase |

_Kundens udgangspunkt er syntetiske listepriser fra 2025 og er ikke en faktura; platformprisen er en model, ikke en målt besparelse._

## Enterprise Nord A/S (900 medarbejdere)

- Nuværende månedsomkostning: 12.500,00 EUR (vendor-invoices-2025)
- Modelleret platformpris: 2.243,60 EUR
- Migrering (engang): 32.000,00 EUR
- 12-måneders TCO: 58.923,20 EUR
- Modeldifference pr. måned: 10.256,40 EUR (82.05 %) — ikke en målt besparelse

| Måler | Nu | Platform | Note |
| --- | ---: | ---: | --- |
| backup | 700,00 EUR | 35,20 EUR | Cloudbackup pr. måned |
| compute | 2.500,00 EUR | 205,80 EUR | Compute- og driftskapacitet pr. måned |
| integrations | 1.800,00 EUR | 91,00 EUR | Fjorten SaaS-integrationer |
| migration | 900,00 EUR | 400,00 EUR | Løbende migrerings- og integrationsarbejde |
| model-calls | 0,00 EUR | 180,00 EUR | Platformsmålt forbrug fra forbrugsjournalen |
| runtime | 0,00 EUR | 86,40 EUR | Platformsmålt forbrug fra forbrugsjournalen |
| storage | 900,00 EUR | 115,20 EUR | Fildeling og arkiv pr. måned |
| support | 3.600,00 EUR | 650,00 EUR | Support, on-call og patchvinduer |
| upstream-features | 2.100,00 EUR | 480,00 EUR | Seats og betalte upstreamfeatures |

_Kundens udgangspunkt er syntetiske listepriser fra 2025 og er ikke en faktura; platformprisen er en model, ikke en målt besparelse._

## Claim-politik

- Besparelsespåstand: **nej**
- Sammenlignelige data: ikke dokumenteret
- Ingen påstand om gratis drift: **bekræftet**
- Ingen påstand om fuld SaaS-erstatning: **bekræftet**
- Dokumentation: `metering/price-book.json`, `metering/usage-ledger.json`, `metering/operating-costs.json`, `docs/costs/cost-report.md`

Drift er ikke gratis: platformen har compute-, storage-, backup-, model-, integrations-, runtime- og supportomkostninger. Platformen er ikke en fuld SaaS-erstatning uden dokumenteret dækning, og der fremsættes ingen målt besparelsespåstand uden rigtige sammenlignelige data.

