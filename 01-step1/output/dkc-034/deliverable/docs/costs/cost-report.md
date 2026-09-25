# Forbrugs- og driftsomkostningsrapport

> Genereret af `make metering-render` som en deterministisk aggregering. **Målt:** nej — en faktisk afstemning kræver en levende faktura.

- **Valuta:** EUR
- **Prisbog:** `metering/price-book.json`
- **Forbrugsjournal:** `metering/usage-ledger.json`
- **Genereret:** 2026-03-01T00:00:00Z
- **Samlet afstemning:** within-tolerance (faktisk 2.581,00 EUR vs. driftsudgift 2.600,00 EUR)

## Forbrug pr. tenant

| Tenant | Pakke | Faktisk | Estimeret | I alt | Stopgrænse | Budget | Afstemning |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- |
| acme | scale | 631,30 EUR | 130,00 EUR | 761,30 EUR | 900,00 EUR | warning | within-tolerance |
| globex | starter | 106,10 EUR | 0,00 EUR | 106,10 EUR | 250,00 EUR | within-limit | within-tolerance |
| initech | enterprise | 1.843,60 EUR | 400,00 EUR | 2.243,60 EUR | 2.500,00 EUR | warning | reconciled |

## Opdeling pr. måler

| Måler | acme | globex | initech |
| --- | ---: | ---: | ---: |
| compute | 67,20 EUR | 14,70 EUR | 205,80 EUR |
| storage | 32,40 EUR | 5,40 EUR | 115,20 EUR |
| backup | 9,90 EUR | 0,00 EUR | 35,20 EUR |
| model-calls | 50,00 EUR | 8,00 EUR | 180,00 EUR |
| integrations | 39,00 EUR | 13,00 EUR | 91,00 EUR |
| runtime | 28,80 EUR | 0,00 EUR | 86,40 EUR |
| support | 390,00 EUR | 65,00 EUR | 650,00 EUR |
| upstream-features | 144,00 EUR | 0,00 EUR | 480,00 EUR |
| migration | 0,00 EUR | 0,00 EUR | 400,00 EUR |

## Uudmålte / manuelt indtastede omkostninger

Disse omkostninger er bevidst ikke udmålt i modellen. De skal indtastes manuelt og kan først kaldes målte, når en faktura foreligger.

| Måler | Månedsværdi | Ejer | Begrundelse |
| --- | ---: | --- | --- |
| support | ikke udmålt | Carina Christensen | On-call-vagtbelastning er ikke udmålt i denne model; den skal indtastes manuelt pr. tenant og kan først afstemmes mod en faktisk løn-/vagtudgift. |
| upstream-features | ikke udmålt | David Dahl | Betalte upstreamfeatures (fx SSO/SCIM i en community-udgave) er en manuel leverandøromkostning uden en automatisk måler i denne model. |

## Prognose og stopgrænser

### acme

- Prognose (straight-line): 761,30 EUR = 84.59 % af grænsen
- Stopgrænse: 900,00 EUR (advarsel ved 80 %, handling ved overskridelse: block)
- Status: **warning**; dublerede hændelser fjernet: 1

### globex

- Prognose (trailing-30d): 106,10 EUR = 42.44 % af grænsen
- Stopgrænse: 250,00 EUR (advarsel ved 75 %, handling ved overskridelse: warn)
- Status: **within-limit**; dublerede hændelser fjernet: 0

### initech

- Prognose (straight-line): 2.243,60 EUR = 89.74 % af grænsen
- Stopgrænse: 2.500,00 EUR (advarsel ved 85 %, handling ved overskridelse: block)
- Status: **warning**; dublerede hændelser fjernet: 0

## Afstemning mod driftsudgifter

| Tenant | Faktisk forbrug | Driftsudgift | Afvigelse | Tolerance | Status |
| --- | ---: | ---: | ---: | ---: | --- |
| acme | 631,30 EUR | 640,00 EUR | -1.36 % | 10 % | within-tolerance |
| globex | 106,10 EUR | 110,00 EUR | -3.55 % | 10 % | within-tolerance |
| initech | 1.843,60 EUR | 1.850,00 EUR | -0.35 % | 10 % | reconciled |

