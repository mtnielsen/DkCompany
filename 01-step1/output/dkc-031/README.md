# DKC-031 — Byg migrations- og exitværktøjer

Kumulativ overlay oven på stak-tippet **DKC-030**. Lægges med
`./apply.sh <checkout>/00-core`.

- **Reviewets base:** `5f9fa73457d22583b9948611d5cc3afffec4ae38` (`5f9fa73`)
- **Undersøgt checkout:** `83ad91a963d8055f77c29fb4361455689df95acb` (`83ad91a`)
- **Forudsætningskæde:** `dkc-030/apply.sh` → `dkc-029/apply.sh` →
  `dkc-028/apply.sh` → `dkc-034/apply.sh` → … → `dkc-001/apply.sh`. DKC-031
  afhænger formelt af **DKC-020** (DSAR og eksport), **DKC-025** (portal og
  kundens livscyklus), **DKC-026** (filer/Nextcloud), **DKC-027**
  (projekt/OpenProject), **DKC-028** (videnssøgning/BookStack), **DKC-029**
  (support/Zammad) og **DKC-030** (CRM/EspoCRM). Alle er verificeret i den
  anvendte stak (se `evidence/prerequisites.txt`). Den genbruger desuden
  **DKC-043** (dedup og kontrolleret oprydning) og **DKC-007** (deterministisk
  digest).
- **Miljø:** Node v22.22.1. Ingen levende pilotkilde, ingen aftalt cutover og
  ingen menneskelig pilotgodkendelse. Kildeformatet, dækningen, dry-run,
  mappingen, dublethåndteringen, den resumable og idempotente import,
  exit-eksporten, godkendelsen og cutover/rollback er efterprøvet deterministisk
  mod et syntetisk korpus; den målte migration (`make migration-live`) er
  NOT RUN (`docs/runbooks/migration-exit.md`).

## Implementeret adfærd

1. **Ét valgt kildeformat pr. pilotapp** (`migration/sources.json`,
   `contracts/migration-source.schema.json`): Nextcloud
   (`nextcloud-export-bundle@1`), OpenProject (`openproject-api-v3-json@1`),
   BookStack (`bookstack-content-export@1`), Zammad (`zammad-ticket-archive@1`)
   og EspoCRM (`espocrm-rest-json@1`). Hvert format er maskinlæsbart,
   dokumenteret (`docs/migration/exit-export.md`) og kan læses uden en aktiv
   DkCompany-installation.
2. **Dækningsmatrix** (`migration/src/coverage.mjs`,
   `contracts/migration-coverage.schema.json`): for hver app/entitet/facet
   (ejerskab, timestamps, kommentarer, bilag, ACL og links) beregnes `full`,
   `partial` eller `unsupported`. Enhver ikke-fuld facet **skal** have en
   forklaring og optræder i `lostFunctionality`, så tabt funktionalitet vises
   før cutover.
3. **Dry-run, mapping og afstemning** (`migration/src/import.mjs`,
   `migration/src/mapping.mjs`, `contracts/migration-reconciliation.schema.json`):
   dry-run mapper hvert objekt, klassificerer det (create/update/conflict/fejl)
   og afstemmer antal og sha256-checksums. Den skriver intet.
4. **Dublethåndtering uden automatisk fletning** (`migration/src/dedup.mjs`):
   dedup-nøglen beregnes tenantafgrænset. To kildeobjekter med samme
   forretningsidentitet bliver en konflikt i fejllisten og flettes aldrig
   automatisk (DKC-043's `assertStorageDedupAllowed`).
5. **Resumabel og idempotent import** (`migration/src/import.mjs`,
   `migration/src/store.mjs`): en filbaseret, holdbar butik med epoch, checkpoint
   og idempotensnøgler. En afbrudt import genoptages uden at gentage allerede
   importerede objekter, og et retry skaber ingen dubletter.
6. **Stabil, tenantafgrænset reference** (`migration/src/references.mjs`):
   `mig:<tenant>:<app>:<entityType>:<sourceObjectId>`; en tværtenant-reference
   afvises fail-closed.
7. **Selvbeskrivende exit-eksport** (`migration/src/export.mjs`,
   `contracts/migration-export.schema.json`): JSON Lines, CSV og en manifest-JSON
   med checksum og filsha256, sammen med `README.md` og et **standalone**
   læse-script (`read-export.mjs`, kun Nodes indbyggede moduler). Eksporten kan
   læses og verificeres uden platformen.
8. **Pilotgodkendelse og cutover/rollback** (`migration/src/approval.mjs`,
   `migration/src/cutover.mjs`, `contracts/migration-approval.schema.json`): en
   cutover kræver en afstemt import, en dokumenteret rollback og en
   pilotgodkendelse fra et navngivet menneske af **både indhold og
   adgangsrettigheder** — og ikke fra den der udførte migrationen. Snapshot
   tages før cutover, og en rollback gendanner poster, ACL og rettigheder.
9. **Adgang er default-deny og tenantadskilt** (`migration/src/permissions.mjs`):
   en læserolle må læse/eksportere, men ikke importere eller cutover.
10. **Releasebinding**: nyt krav `REQ-MIGRATION-001` og trussel
    `THREAT-MIGRATION-001` (matrixversion **1.39.0**), registreret i
    `tools/baseline/registry.mjs` som komponenten `migration` med
    `migration-check`, `migration-test`, `migration-run`, `migration-report` og
    `integration-migration-source-live` (sidstnævnte NOT RUN).

## Ændrede og nye filer

Se `deliverable/`. Filerne er beregnet ved at diffe arbejdsklonen mod en frisk
klon med kun `dkc-030/apply.sh` anvendt (59 filer, ekskl. `node_modules`,
`.conformance-out`, `.git`, `evidence/generated`, `migration/exports`). De
vigtigste:

- Nye: `migration/` (kilder, politik, korpus, `package.json`, 13 src-filer, 8
  testfiler, genereret rapport), `conformance/src/migration.mjs`,
  `conformance/test/migration-conformance.test.mjs`,
  `contracts/migration-{source,coverage,reconciliation,export,approval}.schema.json`
  + 5 eksempler, `docs/spec/migration.md`, `docs/migration/exit-export.md`,
  `docs/operations/migration.md`, `docs/runbooks/migration-exit.md`,
  `docs/adr/0070-migrations-og-exitvaerktoejer.md`.
- Ændrede: `Makefile` (8 targets + `ci`), `conformance/src/schemas.mjs`,
  `conformance/src/validate-schemas.mjs`, `tools/baseline/registry.mjs`,
  `release/matrix/{test-matrix,threats}.json`, genererede
  `docs/status/implementation-matrix.md`, `docs/status/supply-chain.md`,
  `docs/testing/test-matrix.md`, `docs/security/threat-model.md`,
  `docs/adr/README.md`,
  `release/{artifacts.json,sbom/platform-sbom.cdx.json}` (nyt
  `migration/package.json`).

## Testkommandoer og resultater

| Kommando | Resultat |
| --- | --- |
| `make validate` | PASS (5 nye kontrakter + 5 eksempler valideret; 139 skemaer, 152 eksempler) |
| `make lint` | PASS (742 JSON-filer, 1945 filer) |
| `make migration-check` | PASS (kilder, politik, dækningsmatrix og 9 scenarier) |
| `make migration-run` | PASS (9 scenarier; 6 kilder, 9 tabte facetter) |
| `make migration-test` | PASS (39 enhedstests + 14 konformanstests) |
| `make migration-render` / `make migration-report` | PASS (deterministisk rapport) |
| `make release-check` | PASS (62 krav; matrixversion 1.39.0) |
| `make release-test` | PASS |
| `make supply-chain-check` | PASS (SBOM opdateret for nyt `package.json`) |
| `make test` | PASS (441 tests) |
| `make conform-all` | PASS |
| `make baseline-test` | PASS |
| `make baseline` | 244 checks: **190 PASS, 1 FAIL, 53 NOT RUN**. Det ene FAIL er det kendte, forudgående `changelog-check` (manglende DCO sign-off, også i `83ad91a`); det er ikke "rettet". |

E2e: pakkens `apply.sh` blev lagt på en frisk klon, `make install` kørt, og de
fokuserede checks passerer. Træet er byte-identisk med arbejdsklonen
(`evidence/e2e-tree-diff.txt`).

## Acceptkriterier

| Kriterium | Status | Bevis |
| --- | --- | --- |
| Antal objekter og checksums afstemmes, og tabt funktionalitet vises før cutover | **PASS** | `migration/src/import.mjs` (`dryRun`/`reconcile` afstemmer antal og sha256) og `migration/src/coverage.mjs`; scenarierne `dry-run-reconciles` og `coverage-matrix-shows-lost-functionality` samt `migration/test/import.test.mjs` og `migration/test/coverage.test.mjs` bekræfter, at hver kilde afstemmer, og at 9 tabte facetter vises med forklaring. |
| Gentaget import skaber ikke dubletter | **PASS** | `migration/src/dedup.mjs` + `migration/src/store.mjs`; scenarierne `resumable-idempotent-import` og `dedup-conflict-not-merged` samt `migration/test/import.test.mjs` bekræfter, at en genoptaget og gentaget import ikke ændrer antallet, og at en dubleret forretningsidentitet bliver en konflikt — aldrig en fletning. |
| Exiteksport kan læses uden aktiv DkCompany-installation | **PASS** | `migration/src/export.mjs`; scenariet `exit-export-readable-without-platform` kører det genererede `read-export.mjs` i en separat Node-process, som kun bruger Nodes indbyggede moduler, og verificerer antal og checksum. |
| Pilotbrugere godkender indhold og adgangsrettigheder efter migration | **PASS** (implementeret kontrol) | `migration/src/approval.mjs` + `migration/src/cutover.mjs`; scenariet `pilot-approves-content-and-acl` og `cutover-requires-approval-and-rollback` samt `migration/test/approval.test.mjs` og `migration/test/cutover.test.mjs` bekræfter, at begge godkendelser kræves, at operatøren ikke kan godkende selv, og at cutover blokeres uden. Den **faktiske** menneskelige godkendelse i en levende migration er **NOT RUN**. |

## Tilknyttede krav/checks og hvad der er NOT RUN

- `REQ-MIGRATION-001` binder `migration-check`, `migration-test`,
  `migration-run` og `migration-report`; `THREAT-MIGRATION-001` (grænsen
  `tenant-boundary`) dækker tværtenant-lækage, dubletter, automatisk fletning,
  skjult tabt funktionalitet, ulæsbar eksport og cutover uden godkendelse og
  rollback.
- `integration-migration-source-live` er **NOT RUN**: der findes ingen levende
  pilotkilde, ingen aftalt cutover og ingen menneskelig pilotgodkendelse. Se
  `docs/runbooks/migration-exit.md`.
- Rapporten erklærer `measured: false`.

## Gennemgå-identifikatorer

- Base: `5f9fa73457d22583b9948611d5cc3afffec4ae38`
- Checkout: `83ad91a963d8055f77c29fb4361455689df95acb`
- Stak-tip før dette overlay: `dkc-030/apply.sh`
- Denne ændring: denne pakkes `deliverable/` (59 filer) oven på stakken.
