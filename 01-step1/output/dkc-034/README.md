# DKC-034 — Implementér forbrugs- og driftsomkostningsmåling

Kumulativ overlay oven på stak-tippet **DKC-052**. Lægges med
`./apply.sh <checkout>/00-core`.

- **Reviewets base:** `5f9fa73457d22583b9948611d5cc3afffec4ae38` (`5f9fa73`)
- **Undersøgt checkout:** `83ad91a963d8055f77c29fb4361455689df95acb` (`83ad91a`)
- **Forudsætningskæde:** `dkc-052/apply.sh` → `dkc-032/apply.sh` →
  `dkc-051/apply.sh` → `dkc-050/apply.sh` → … → `dkc-001/apply.sh`. DKC-034
  afhænger formelt af **DKC-002** (deployments- og identitetskontrakter),
  **DKC-017** (reel overvågning) og **DKC-025** (portal, servicepakker og pris).
  Alle er verificeret i den anvendte stak (se `evidence/prerequisites.txt`).
  Den genbruger desuden **DKC-006** (tenant-kontekst) og **DKC-050**
  (enhedspris/kapacitetsmodel).
- **Miljø:** Node v22.22.1. Ingen levende faktura, intet faktisk driftsregnskab
  og ingen rigtig leverandørpris. Modellen er deterministisk (`measured: false`);
  den målte afstemning er NOT RUN (`docs/metering/metering-live.md`).

## Implementeret adfærd

1. **Prisbog** (`metering/price-book.json`, `contracts/price-book.schema.json`):
   konfigurerbare priser pr. måler (`compute`, `storage`, `backup`,
   `model-calls`, `integrations`, `runtime`, `support`, `upstream-features`,
   `migration`) med valuta, gyldighedstidspunkt og kilde; valutakryds;
   eksplicitte manuelle omkostninger; og leverandører med
   vedligeholdelsesstatus, patchvindue, betalte features og supportansvarlig.
   `missingPricePolicy: reject` — en manglende pris regnes aldrig som nul.
2. **Idempotent aggregering** (`metering/src/pricing.mjs`,
   `metering/src/aggregate.mjs`): en pris vælges efter det tidspunkt hændelsen
   indtraf, hændelser deduplices på `eventKey`, faktisk og estimeret forbrug
   holdes adskilt, og valutaer blandes ikke (enhver valuta kræver en kurs).
3. **Autoriseret rapport og eksport** (`metering/src/authorization.mjs`):
   tenanten udledes af den **verifikerede** principal
   (`identity/src/tenant.mjs`). En kunde skal have en læserrolle
   (`billing-reader`/`tenant-admin`); en påstand om en fremmed tenant afvises,
   og kun en scopet platformrolle (`platform-admin:<tenant>`) kan eksportere på
   tværs. Et sidste sikkerhedsnet afviser tenant-lækage.
4. **Rapport med prognose, stopgrænser og afstemning**
   (`metering/src/report.mjs`, `contracts/cost-report.schema.json`): pr. tenant
   en opdeling pr. måler, eksplicit uudmålt/manuel supportomkostning,
   prognose (`straight-line`/`trailing-30d`), stopgrænse med advarsel og
   handling (`block`/`warn`), budgetstatus og afstemning mod
   `metering/operating-costs.json` med tolerance. Manglende driftsudgiftsdata
   giver `no-operating-expense-data`, ikke en falsk grøn afstemning.
5. **TCO-sammenligning** (`metering/src/tco.mjs`, `contracts/tco-comparison.schema.json`,
   `metering/company-profiles.json`): tre virksomhedsprofiler bindes til hver sin
   tenant, og platformprisen hentes fra den meterede rapport (ikke et løst tal).
   `claims`-politikken erklærer `savingsClaimed: false` og
   `comparableDataRef: null`, forbyder gratis drift og fuld SaaS-erstatning uden
   dokumentation.
6. **Konformans og negativ kontrol** (`conformance/src/metering.mjs`,
   `conformance/test/metering-conformance.test.mjs`): skema + beslutningssemantik,
   og afvisning af en manglende pris, en dublet der dobbelttælles, en
   ikke-understøttet valuta, en ufuldstændig prisbog og en ugrundet
   besparelsespåstand.
7. **Releasebinding**: nyt krav `REQ-METERING-001` og trussel
   `THREAT-METERING-001` (matrixversion **1.35.0**), registreret i
   `tools/baseline/registry.mjs` som komponenten `metering` med
   `metering-check`, `metering-test`, `metering-run`, `metering-report` og
   `integration-metering-live` (sidstnævnte NOT RUN).

## Ændrede og nye filer

Se `deliverable/`. Filerne er beregnet ved at diffe arbejdsklonen mod en frisk
klon med kun `dkc-052/apply.sh` anvendt (48 filer, ekskl. `node_modules`,
`.conformance-out`, `.git`, `evidence/generated`). De vigtigste:

- Nye: `metering/` (prisbog, forbrugsjournal, driftsudgifter, profiler, kilde,
  tests, package.json og rapport), `conformance/src/metering.mjs`,
  `conformance/test/metering-conformance.test.mjs`,
  `contracts/{price-book,usage-ledger,cost-report,tco-comparison}.schema.json` +
  eksempler, `docs/spec/metering-and-cost.md`,
  `docs/business/tco-comparison.md`, `docs/costs/cost-report.md`,
  `docs/operations/cost-control.md`, `docs/metering/metering-live.md`,
  `docs/adr/0066-forbrugs-og-driftsomkostningsmaaling.md`.
- Ændrede: `Makefile` (6 targets + `ci`), `conformance/src/schemas.mjs`,
  `conformance/src/validate-schemas.mjs`, `tools/baseline/registry.mjs`,
  `release/matrix/{test-matrix,threats}.json`, genererede
  `docs/status/implementation-matrix.md`, `docs/status/supply-chain.md`,
  `docs/testing/test-matrix.md`, `docs/security/threat-model.md`,
  `release/{artifacts.json,sbom/platform-sbom.cdx.json}` (nyt
  `metering/package.json`).

## Testkommandoer og resultater

| Kommando | Resultat |
| --- | --- |
| `make validate` | PASS (4 nye kontrakter + 4 eksempler valideret) |
| `make lint` | PASS (691 JSON-filer, 1785 filer) |
| `make metering-check` | PASS (skema, semantik og artefakter konsistente) |
| `make metering-run` | PASS (9 deterministiske kontroller) |
| `make metering-test` | PASS (20 enhedstests + 8 konformanstests) |
| `make release-check` | PASS (58 krav; matrixversion 1.35.0) |
| `make release-test` | PASS |
| `make supply-chain-check` | PASS (SBOM opdateret for nyt `package.json`) |
| `make test` | PASS |
| `make conform-all` | PASS |
| `make baseline-test` | PASS |
| `make baseline` | 224 checks: **174 PASS, 1 FAIL, 49 NOT RUN**. Det ene FAIL er det kendte, forudgående `changelog-check` (manglende DCO sign-off, også i `83ad91a`); det er ikke "rettet". |
| `make ci` | Stopper ved samme forudgående `changelog-check`. Alle registrerede checks i `make baseline` passerer bortset fra den; `make test`, `make conform-all` og de fokuserede metering-, release- og supply-chain-mål er kørt særskilt. |

E2e: pakkens `apply.sh` blev lagt på en frisk klon, `make install` kørt, og de
fokuserede checks passerer. Træet er byte-identisk med arbejdsklonen
(`evidence/e2e-tree-diff.txt`: 1785 filer, 0 forskelle).

## Acceptkriterier

| Kriterium | Status | Bevis |
| --- | --- | --- |
| Tre virksomhedsprofiler har gennemskuelig TCO-sammenligning med kundens faktiske udgangspunkt | **PASS** | `metering/company-profiles.json` (solo/team/enterprise) → `metering/report/tco-comparison.json` og `docs/business/tco-comparison.md`; hver profil binder til en tenant og viser nutids- og platformsomkostning pr. måler. |
| Forbrugsregistrering kan afstemmes med driftsudgifter | **PASS** (implementeret kontrol) | `metering/src/aggregate.mjs` + `metering/operating-costs.json`; rapporten giver `reconciled`/`within-tolerance`/`unreconciled`/`no-operating-expense-data` pr. tenant. Den faktisk målte afstemning mod en levende faktura er **NOT RUN**. |
| Kunde kan se prognose og stopgrænser | **PASS** | `forecast` + `stopLimit` + `budgetStatus` i `metering/report/cost-report.json` og `docs/costs/cost-report.md`; negativ test af `block`/`warn`. |
| Ingen markedsføring om gratis drift eller fuld SaaS-erstatning uden dokumentation | **PASS** | `claims`-politikken i `metering/company-profiles.json` og `tcoComparisonProblems`; `noFreeOperation`/`notFullSaasReplacement` skal være sande, og en besparelsespåstand kræver `comparableDataRef`. |

## Tilknyttede krav/checks og hvad der er NOT RUN

- `REQ-METERING-001` binder `metering-check`, `metering-test`, `metering-run`
  og `integration-metering-live`; `THREAT-METERING-001` (tenant-lækage, manglende
  pris, valuta og falsk besparelse) er tilføjet.
- **NOT RUN:** `integration-metering-live` (`make metering-live`) — kræver en
  levende faktura, et faktisk driftsregnskab og en rigtig leverandørpris. Se
  `docs/metering/metering-live.md`.

## Resterende begrænsninger

- Afstemningen er en model (`measured: false`). Der findes ingen målt afvigelse
  mod en faktura.
- Valutakurserne er syntetiske testdata, ikke en levende kurskilde.
- On-call- og upstreamkostninger er markeret `ikke udmålt` og skal indtastes
  manuelt med dokumentation.
- Prisbog, satser, driftsudgifter og de tre profiler skal vedligeholdes.
- Intet nyt ejer-curriculum-modul; det er ikke en del af DKC-034's acceptkrav.

## Godkendelse

Implementeringen er ikke produktionsklar, og agenten godkender ikke sin egen
indsats. En målt besparelse kræver rigtige sammenlignelige data og en ekstern
fakturaafstemning; uafhængig verifikation og menneskelig release-godkendelse er
separate skridt.
