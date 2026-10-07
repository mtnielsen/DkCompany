# Modulregistrering for økonomi, HR og handel (DKC-035)

Registreringen gør de næste forretningsmoduler klar til implementering uden at
fremstille dem som fungerende applikationer. Dansk lokalisering er en **særskilt
gate**: regnskab og løn kan ikke erklæres danskklare alene på baggrund af
upstream-features.

## Formål og afgrænsning

En *modulfamilie* er en versioneret katalogpost med:

- en begrundet **rækkefølge** og et eksplicit **fravalg**,
- én eller flere **katalogkomponenter** (`catalog/components/*.component.json`),
- en **kandidatrapport** pr. produkt (`IntegrationCandidate`, DKC-023),
- en **dækningsmatrix** for dansk lokalisering,
- en **adaptergrænseflade** med driftsverber, scopes og dataklasser,
- en **familie-status** (`registered`, `candidate`, `pending-legal-review`,
  `unavailable`).

En registrering er en katalogpost. Den må ikke fremstilles som en fungerende
forretningsapplikation. Den faktiske adapter er en særskilt, afgrænset opgave.

## Familier og rækkefølge

| # | Familie | Begrundelse |
| --- | --- | --- |
| 1 | Økonomi/ERP | Pilotkunderne fører allerede regnskab og mangler en fælles bogføringsflade; fakturering og løn afhænger af den. |
| 2 | Fakturering | Deler kontoplan, moms og betaling med økonomi, men har sin egen e-faktura-gate. |
| 3 | HR | Personaledata findes allerede i kataloget, men løn er juridisk uafklaret og holdes derfor særskilt. |
| 4 | Tid | Forudsætning for fakturering og løn, men kan bruges selvstændigt og har ingen lovbestemt dansk lokalisering. |
| 5 | Handel/webshop | Bredest angrebs- og betalingsflade og først værdifuld, når økonomi, fakturering og betaling er på plads. |

Fravalgene er dokumenteret pr. familie i `localization/families.json`. Egen
bogføringsmotor, egen e-faktura-afsendelse, lønberegning i platformen og egen
betalingsformidling er alle fravalgt med en begrundelse.

## Dansk lokalisering som gate

`localization/locale-requirements.json` erklærer syv krav:

| Krav | Gælder | Blokerer 'Danmarksklar' |
| --- | --- | --- |
| `accounting` (bogføring) | økonomi, fakturering | ja |
| `vat` (moms) | økonomi, fakturering, handel | ja |
| `e-invoicing` (OIOUBL/NemHandel) | fakturering | ja |
| `payroll` (løn) | HR | ja |
| `payment` (betaling/bank) | økonomi, fakturering, handel | ja |
| `agreements` (aftaler) | alle | nej |
| `authoritative-registers` (CVR m.fl.) | alle | nej |

Et krav er `unreviewed`, `pending`, `confirmed` eller `not-applicable`. Et
`confirmed` krav kræver et **navngivet menneske**, et review-tidspunkt og
mindst ét bevis. Så længe et blokerende krav ikke er `confirmed`, udleder
`deriveFamilyStatus` familien som `pending-legal-review`.

Dækningsmatricen (`localization/src/coverage.mjs`) oversætter kravene til
`full`/`partial`/`unsupported` pr. familie og gør tabt eller uafklaret
funktionalitet synlig, før nogen adapter bygges.

## Adaptergrænseflader og betaling

`localization/adapter-interfaces.json` erklærer grænsefladerne
`finance-ledger`, `invoicing`, `payroll`, `time-tracking`, `commerce-catalog`
og `payment-bank`. Hver grænseflade angiver sine ops-verber, sine scopes og
sine dataklasser.

`payment-bank` er særskilt:

- `externalServiceRequired: true` — betaling og bankadgang må kun gå gennem en
  godkendt ekstern tjeneste.
- `deniedScopes` indeholder `bank:full-access`, `accounts:full-access` og
  `cards:read`. Grænsefladen må aldrig erklære fuld bankadgang eller kortdata
  som et tilladt scope.
- `approvedExternalServiceRef` er `null`, så gaten er `pending` og familien
  ikke kan blive danskklar.

`localization/src/gate.mjs` fejler lukket: en manglende godkendt tjeneste, et
forbudt scope eller et manglende forbud giver `pending` — aldrig en falsk grøn.

## Katalog- og resolverintegration

Hver forretningskomponent bærer en `localization`-blok i sit
`ComponentManifest`. `localization/src/integration.mjs` løser hver families
komponenter gennem den eksisterende dependency-resolver (DKC-053) mod en konkret
installationsprofil og kontrollerer, at adaptergrænsefladen dækker modulets
driftsverber og dataklasser. En registrering, der ikke kan resolveres, afvises.

Familierne er tilføjet til `ha-cluster`- og `enterprise-dedicated`-profilernes
valgfrie applikationer. `small-vps` beholder dem uden for sin kapacitet, så en
lille VPS ikke påstås at kunne køre et fuldt ERP.

## Kontrakter

- `contracts/module-family.schema.json` — familiekataloget.
- `contracts/locale-requirement.schema.json` — de danske lokaliseringskrav.
- `contracts/adapter-interface.schema.json` — adaptergrænsefladerne.
- `component-manifest.schema.json` — udvidet med `category` `finance`/`commerce`
  og den valgfrie `localization`-blok.

Semantikken ligger i `conformance/src/localization.mjs`, som genbruger
`localization/src/model.mjs`, så CI, `make localization-check` og
`make distribution-check` bruger de samme regler.

## Ikke en del af denne opgave

Den faktiske adapter pr. produkt, den faglige afgørelse af dansk bogføring,
moms, e-faktura og løn samt en godkendt betalingstjeneste er **NOT RUN** og
kræver en ekstern kilde. Ingen familie er danskklar.
