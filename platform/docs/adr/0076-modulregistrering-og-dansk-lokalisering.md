# Modulregistrering for økonomi, HR og handel med dansk lokalisering som særskilt gate

- **Status:** accepteret
- **Beslutningstagere:** Cecilia Christensen (Service Owner), Hans Hansen (Solution Architect), Anna Andersen (Platform Owner)
- **Dato:** 2026-10-20
- **Beslutningsdrev:** DKC-035 kræver, at de næste forretningsmoduler (økonomi/ERP, HR, tid, fakturering og handel) registreres i kataloget med kandidatrapport og dækningsmatrix, og at dansk lokalisering er en særskilt gate, så regnskab og løn ikke erklæres danskklare alene på baggrund af upstream-features.

## Kontekst og problemstilling

Backloggens bølge 4.2 forudser flere moduladaptere, og DKC-030 viste et
mønster: en kandidat vurderes teknisk gennem DKC-023's hårde gate, en
tenantafgrænset adapter bygges, og manifestet erklærer ærligt, hvad der ikke kan
lade sig gøre. For økonomi, HR og handel er der en ekstra dimension: dansk
bogføring, moms, e-faktura, løn, betaling, aftaler og autoritative registre er
**juridiske** forhold, som et upstream-produkt ikke bliver danskklart af at
være komplet.

Uden en særskilt registrering ville en katalogpost kunne forveksles med en
fungerende, dansk forretningsapplikation. En adapter, der bygges uden en faglig
afgørelse, ville kunne bogføre forkert eller køre løn ulovligt.

## Beslutningskriterier

- Hver valgt familie har en kandidatrapport, en dækningsmatrix og konkrete
  integrationstests mod den faktiske resolver.
- Dansk lokalisering er en særskilt gate med et navngivet menneske; et
  `unreviewed`/`pending` krav blokerer 'Danmarksklar'.
- Regnskab og løn kan ikke blive danskklare alene på baggrund af
  upstream-features.
- Betaling og bankadgang bruger en godkendt ekstern tjeneste med begrænsede
  scopes; fuld bankadgang og kortdata er forbudt.
- Fravalg og rækkefølge er begrundet, og et katalogprodukt bliver ikke
  automatisk til en bestilt byggeopgave.
- En registrering er ikke en fungerende applikation.

## Beslutning

Vi indfører et `localization/`-modul og tre kontrakter:

1. **Familiekatalog** (`localization/families.json`,
   `contracts/module-family.schema.json`): fem familier i rækkefølgen økonomi →
   fakturering → HR → tid → handel, hver med begrundelse, fravalg, komponenter,
   lokaliseringskrav, adaptergrænseflade og kandidatprodukter.
2. **Lokaliseringskrav** (`localization/locale-requirements.json`,
   `contracts/locale-requirement.schema.json`): syv krav. `accounting`, `vat`,
   `e-invoicing`, `payroll` og `payment` blokerer 'Danmarksklar'; `agreements`
   og `authoritative-registers` er nødvendige forberedelser. Et `confirmed` krav
   kræver et navngivet menneske, et tidspunkt og et bevis.
3. **Adaptergrænseflader** (`localization/adapter-interfaces.json`,
   `contracts/adapter-interface.schema.json`): seks grænseflader med
   driftsverber, scopes og dataklasser. `payment-bank` kræver en godkendt
   ekstern tjeneste og forbyder fuld bankadgang.
4. **Katalogkomponenter**: `finance`, `invoicing`, `time`, `webshop` og
   `payment` tilføjes som `catalog-only` med en `localization`-blok; `hr`
   opdateres. `component-manifest.schema.json` udvides med `category`
   `finance`/`commerce` og den valgfrie `localization`-blok.
5. **Resolver- og CI-integration**: `localization/src/integration.mjs` løser
   hver familie gennem `distribution/src/resolver.mjs` og kontrollerer
   adaptergrænsefladen mod modulets driftsverber. `conformance/src/localization.mjs`
   genbruger `localization/src/model.mjs`, og `make localization-check/test/run/render`
   indgår i `make ci`.
6. **Releasebinding**: `REQ-LOCALIZATION-001` og `THREAT-LOCALIZATION-001`
   (matrixversion 1.45.0), registreret som komponenten `localization`.
7. **Rapport**: `localization/report/localization-report.json` og
   `docs/localization/module-registration-report.md` er deterministiske og
   erklærer `measured: false`, nul danskklare familier og betalingsgaten
   `pending`.

## Konsekvenser

- `make localization-check` afviser en rapport uden for trit med kilden, en
  komponent der peger på et ukendt krav, eller en familie med en forkert udledt
  status.
- `make distribution-check` kræver, at hver familie kan resolveres. `small-vps`
  holder bevidst familierne uden for sin kapacitet.
- `make release-check` kræver, at hver check findes i registeret, at
  kontrolreferencerne findes, og at trusselmodellen er i sync.
- Rapporten er ærligt `pending-legal-review`/`registered` og `danishReady: false`
  for alle familier. Det er den korrekte tilstand — ikke en fejl.
- `integration-localization-live` er NOT RUN med begrundelse, fordi der ikke
  findes en faktisk adapter, en faglig afgørelse eller en godkendt
  betalingstjeneste i dette miljø.

## Alternativer overvejet

- **Byg adaptere direkte og markér dem danskklare:** afvist, fordi dansk
  bogføring, moms, e-faktura og løn kræver en faglig afgørelse, som kode alene
  ikke giver.
- **Erklær upstream-komplethed som danskklar:** afvist, fordi det er præcis den
  fejl, opgaven advarer imod.
- **Egen betalingsformidling:** afvist; PCI-DSS er eksplicit udskudt i
  `BACKLOG.md`, og betaling skal gå gennem en godkendt ekstern tjeneste.
- **Én samlet kontrakt i stedet for tre:** afvist, fordi familier,
  lokaliseringskrav og adaptergrænseflader ændrer sig i forskellige tempi og
  med forskellige ejere.
