# DKC-035 — Modulregistrering for økonomi, HR og handel

Kumulativ overlay oven på stak-tippet **DKC-033**. Lægges med
`./apply.sh <checkout>/00-core`.

- **Reviewets base:** `5f9fa73457d22583b9948611d5cc3afffec4ae38` (`5f9fa73`)
- **Undersøgt checkout:** `83ad91a963d8055f77c29fb4361455689df95acb` (`83ad91a`)
- **Forudsætningskæde:** `dkc-033/apply.sh` → `dkc-065/apply.sh` →
  `dkc-062/apply.sh` → … → `dkc-001/apply.sh`. DKC-035 afhænger formelt af
  **DKC-022, DKC-023, DKC-030, DKC-033 og DKC-034**; alle er verificeret i den
  anvendte stak (`evidence/prerequisites.txt`).
- **Miljø:** Node v22.22.1. Ingen faktisk adapter, ingen registreret
  revisor/bogholder/lønansvarlig og ingen godkendt betalingstjeneste. Katalog,
  kandidatrapporter, dækningsmatrix, adaptergrænseflader, resolver-integration
  og de fail-closed gates er efterprøvet deterministisk; den faglige afgørelse
  og den målte adapter (`make localization-live`) er **NOT RUN**, og **ingen
  familie er danskklar**.

## Implementeret adfærd

1. **Fem versionerede modulfamilier** (`localization/families.json`,
   `contracts/module-family.schema.json`): økonomi/ERP, fakturering, HR, tid og
   handel. Hver familie har en begrundet rækkefølge, et eksplicit fravalg, en
   komponentreference, lokaliseringskrav, en adaptergrænseflade og sine
   kandidatprodukter. Rækkefølgen er økonomi → fakturering → HR → tid → handel.
2. **Syv danske lokaliseringskrav som særskilte gates**
   (`localization/locale-requirements.json`,
   `contracts/locale-requirement.schema.json`): bogføring, moms, e-faktura,
   løn, betaling/bank, aftaler og autoritative registre. `accounting`, `vat`,
   `e-invoicing`, `payroll` og `payment` blokerer 'Danmarksklar'. Et krav kan
   kun blive `confirmed` med et navngivet menneske, et review-tidspunkt og et
   bevis. I dette miljø er alle krav `unreviewed`.
3. **Seks adaptergrænseflader** (`localization/adapter-interfaces.json`,
   `contracts/adapter-interface.schema.json`): `finance-ledger`, `invoicing`,
   `payroll`, `time-tracking`, `commerce-catalog` og `payment-bank`. Hver
   grænseflade erklærer ops-verber, scopes og dataklasser.
4. **Betaling og bankadgang er begrænset** (`payment-bank`):
   `externalServiceRequired: true`, `approvedExternalServiceRef: null` og
   `deniedScopes` med `bank:full-access`, `accounts:full-access`,
   `payments:admin` og `cards:read`. `evaluatePaymentGate` fejler lukket: uden
   en godkendt tjeneste er gaten `pending`.
5. **Fem nye katalogkomponenter og en opdateret HR-komponent**
   (`catalog/components/{finance,invoicing,time,webshop,payment}.component.json`,
   `hr.component.json`): alle `catalog-only` med en `localization`-blok.
   `component-manifest.schema.json` er udvidet med `category`
   `finance`/`commerce` og den valgfrie `localization`-blok.
6. **Resolver-integration** (`localization/src/integration.mjs`): hver familie
   løses gennem `distribution/src/resolver.mjs` mod en konkret
   installationsprofil, og adaptergrænsefladen kontrolleres mod modulets
   driftsverber og dataklasser. Familierne er tilføjet HA- og
   enterprise-profilernes valgfrie applikationer; `small-vps` holder dem bevidst
   uden for sin kapacitet.
7. **Kandidatrapporter** (`localization/src/candidates.mjs`): hvert
   kandidatprodukt vurderes gennem DKC-023's `assessCandidateGate` og en
   deterministisk rangering. Den erklærede vinder skal være den bedst scorende.
   Alle kandidater er `candidate_not_approved`, så gaten er `blocked`.
8. **Dækningsmatrix** (`localization/src/coverage.mjs`): hver familie ×
   lokaliseringskrav får `full`/`partial`/`unsupported`. Bogføring og løn står
   `unsupported` og blokerer.
9. **Fail-closed familiegate** (`localization/src/gate.mjs`): 'Danmarksklar'
   kræver, at hvert blokerende krav er bekræftet, at betalingstjenesten er
   godkendt, og at kandidaten er godkendt. `deriveFamilyStatus` udleder
   `pending-legal-review`, når et blokerende krav ikke er bekræftet.
10. **Kontrakter og konformans** (`contracts/module-family|locale-requirement|adapter-interface.schema.json`,
    `conformance/src/localization.mjs`, `conformance/test/localization-conformance.test.mjs`):
    skema + beslutningssemantik, wired ind i `validate-schemas.mjs` (afsnit 53).
11. **Releasebinding**: nyt krav `REQ-LOCALIZATION-001` og trussel
    `THREAT-LOCALIZATION-001` (grænsen `external-sources`, matrixversion
    **1.45.0**), registreret i `tools/baseline/registry.mjs` som komponenten
    `localization` med `localization-check/-test/-run/-report` og
    `integration-localization-live` (NOT RUN). ADR **0076**.
12. **Rapport**: `make localization-render` skriver den deterministiske rapport
    til `localization/report/localization-report.json` og
    `docs/localization/module-registration-report.md`; `make localization-check`
    afviser en rapport ude af trit med kilden.

## Ændrede og nye filer

Se `evidence/deliverable-files.txt` (59 filer, beregnet ved at diffe arbejdsklonen
mod en frisk klon med kun `dkc-033/apply.sh` anvendt, ekskl. `node_modules`,
`.conformance-out`, `.git`, `evidence/generated`, `migration/exports`).
Hovedgrupper:

- `localization/` — 3 kanoniske datafiler, 8 kildemoduler, 5 testsuiter og
  rapporten.
- `contracts/` — 3 nye skemaer + 3 eksempler + 6 integration-candidates;
  `component-manifest.schema.json` udvidet.
- `catalog/components/{finance,invoicing,time,webshop,payment}.component.json`
  (nye) og `hr.component.json` (opdateret); to profiler udvidet.
- `conformance/src/localization.mjs`, `conformance/test/localization-conformance.test.mjs`,
  `validate-schemas.mjs`, `schemas.mjs`.
- `docs/spec/localization-modules.md`, `docs/operations/module-registration.md`,
  `docs/runbooks/localization-onboarding.md`,
  `docs/roadmap/module-wave-finance-hr-commerce.md`,
  `docs/compliance/danish-localization-gates.md`,
  `docs/localization/module-registration-report.md`,
  `docs/adr/0076-…`, `docs/adr/README.md`, `docs/spec/README.md`.
- `Makefile`, `tools/baseline/registry.mjs`,
  `release/matrix/{test-matrix,threats}.json`, genererede
  `docs/status/implementation-matrix.md`, `docs/testing/test-matrix.md`,
  `docs/security/threat-model.md`, `pilot/report/pilot-readiness-report.json`
  (matrixantal ændret fra 67 til 68 krav).

## Testkommandoer og resultater

| Kommando | Resultat |
| --- | --- |
| `make install` | OK (conformance-afhængigheder) |
| `make localization-check` | PASS (katalog, komponenter og rapport i trit) |
| `make localization-test` | PASS (26 enhedstests + 9 konformanstests) |
| `make localization-run` | PASS (5 familier, 0 danskklare, betaling `pending`) |
| `make localization-render` | PASS (2 rapportfiler skrevet) |
| `make distribution-check` | PASS (18 komponenter, 3 profiler; alle familier resolver) |
| `make distribution-test` | PASS (9 tests) |
| `make release-test` | PASS (5 tests) |
| `make validate` | PASS (163 skemaer, eksempler, afsnit 53: 13 modulregistreringskontrakter) |
| `make lint` | PASS (832 JSON-filer, 2144 filer) |
| `make release-check` | PASS (68 krav; matrixversion 1.45.0) |
| `make test` | PASS (520 tests, 0 fejl) |
| `make pilot-check` | PASS (readiness `not-ready`) |
| `make baseline` | 274 checks: **214 PASS, 1 FAIL, 59 NOT RUN**. Det ene FAIL er det kendte, forudgående `changelog-check` (manglende DCO sign-off, også i `83ad91a`); det er ikke "rettet". |

E2e: pakkens `apply.sh` blev lagt på en frisk klon, `make install` kørt, og de
fokuserede checks passerer. Træet er byte-identisk med arbejdsklonen (0 diffs,
`evidence/e2e-tree-diff.log`).

## Acceptkriterier

| Kriterium | Status | Bevis |
| --- | --- | --- |
| Hvert valgt modul har kandidatrapport, coverage-matrix og konkrete integrationstests | **PASS** | `localization/src/candidates.mjs` (kandidatrapport pr. familie), `localization/src/coverage.mjs` (familie × krav), `localization/src/integration.mjs` + `localization/test/integration.test.mjs` (resolver og adapterkontrakt). Rapporten indeholder begge dele. |
| Regnskab og løn markeres ikke som Danmarksklare alene på baggrund af upstreamfeatures | **PASS** | `localization/src/gate.mjs`; `make localization-run` viser `PENDING finance` (bogføring) og `PENDING hr` (løn); dækningsmatricen står `unsupported` for begge; `validateModuleRegistrationReport` afviser en danskklar familie med afventende gates. |
| Betaling og bankadgang bruger godkendt ekstern tjeneste med begrænsede scopes | **PASS** (implementeret kontrol) | `payment-bank` i `localization/adapter-interfaces.json`: `externalServiceRequired: true`, `deniedScopes` indeholder `bank:full-access`/`cards:read`, `approvedExternalServiceRef: null`. `localization/test/gate.test.mjs` bekræfter `pending`. En faktisk godkendt tjeneste er **NOT RUN**. |
| Fravalg og rækkefølge er begrundet | **PASS** | `localization/families.json` (rækkefølge + `exclusions` pr. familie) og `docs/roadmap/module-wave-finance-hr-commerce.md`. |

### Øvrige krav fra opgavebeskrivelsen

| Krav | Status | Bevis |
| --- | --- | --- |
| Udvælg økonomi/ERP, HR, tid, fakturering og webshop efter faktiske pilotbehov | **PASS** | De fem familier i `localization/families.json` med `pilotNeed` og begrundelse. |
| Opret ét discovery-issue og derefter separate adapterissues pr. valgt produkt | **DELVIST — plan og skabelon PASS; faktiske GitHub-issues NOT RUN** | Planen er dokumenteret i `docs/roadmap/module-wave-finance-hr-commerce.md`. Oprettelse af issues i GitHub er en menneskelig handling og er ikke udført i dette miljø. |
| Afklar dansk bogføring, moms, e-faktura, løn, betaling, aftaler og autoritative registre med relevante fagpersoner | **NOT RUN** | `localization/locale-requirements.json` står `unreviewed`; der findes ingen registreret revisor/bogholder/lønansvarlig i dette miljø. Kravene er modelleret og fejler lukket. |

## Tilknyttede krav/checks og hvad der er NOT RUN

- `REQ-LOCALIZATION-001` binder `localization-check/test/run/report` og
  `integration-localization-live`; `THREAT-LOCALIZATION-001` (grænsen
  `external-sources`) dækker en katalogpost der erklæres danskklar eller tager
  imod betaling uden en faglig afgørelse.
- `integration-localization-live` er **NOT RUN**: der findes ingen faktisk
  adapter, ingen faglig afgørelse og ingen godkendt betalingstjeneste. Se
  `docs/spec/localization-modules.md`.
- Den valgte kandidat pr. familie er teknisk rangeret, men **ikke** godkendt af
  et menneske i dette miljø (`verification.status: candidate_not_approved`).
- Rapporten erklærer `measured: false` og `danishReady: false` for alle
  familier.

## Gennemgå-identifikatorer

- Base: `5f9fa73457d22583b9948611d5cc3afffec4ae38`
- Checkout: `83ad91a963d8055f77c29fb4361455689df95acb`
- Stak-tip før dette overlay: `dkc-033/apply.sh`
- Denne ændring: denne pakkes `deliverable/` (59 filer) oven på stakken.
