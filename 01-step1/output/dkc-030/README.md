# DKC-030 — Integrér CRM med entydigt ejerskab af kundedata

Kumulativ overlay oven på stak-tippet **DKC-029**. Lægges med
`./apply.sh <checkout>/00-core`.

- **Reviewets base:** `5f9fa73457d22583b9948611d5cc3afffec4ae38` (`5f9fa73`)
- **Undersøgt checkout:** `83ad91a963d8055f77c29fb4361455689df95acb` (`83ad91a`)
- **Forudsætningskæde:** `dkc-029/apply.sh` → `dkc-028/apply.sh` →
  `dkc-034/apply.sh` → … → `dkc-001/apply.sh`. DKC-030 afhænger formelt af
  **DKC-021** (sletning, legal hold og gendannelsesregler), **DKC-023** (fælles
  adapter-SDK og kandidatvurdering) og **DKC-025** (portal og kundens
  livscyklus). Alle er verificeret i den anvendte stak (se
  `evidence/prerequisites.txt`). Den genbruger desuden **DKC-043** (dedup og
  kontrolleret oprydning), **DKC-007** (deterministisk digest) og **DKC-006**
  (tenant-kontekst).
- **Miljø:** Node v22.22.1. Ingen levende EspoCRM-installation, intet rigtigt
  API-token og ingen menneskelig kandidatgodkendelse. Adapteren, referencen,
  import/opdatering/eksport, retry, dublethåndteringen, rollebeskyttelsen,
  sletningen og backup/gendannelsen er efterprøvet deterministisk mod en
  mock-upstream; den målte integration (`make crm-live`) er NOT RUN
  (`docs/crm/espocrm-live.md`).

## Implementeret adfærd

1. **Kandidatcheck og system-of-record** (`crm/src/candidate-check.mjs`,
   `contracts/examples/integration-candidate.{espocrm,erpnext}.example.json`):
   EspoCRM og ERPNext vurderes på OIDC-SSO, dokumenteret REST-API,
   tenantisolation, API-eksport og licens gennem DKC-023's `assessCandidateGate`.
   EspoCRM vælges på en dedikeret database pr. tenant. EspoCRM er
   `systemOfRecord: upstream` og `writeMode: adapter-mediated`
   (`crm/sources.json`, `contracts/crm-source.schema.json`).
2. **Stabil, tenantafgrænset reference** (`crm/src/references.mjs`,
   `contracts/crm-record.schema.json`): hvert upstream-id mappes til
   `crm:<tenant>:<entityType>:<upstreamId>`. Referencen er stabil gennem
   opdateringer, og en reference fra en anden tenant afvises (fail-closed).
3. **Entydigt ejerskab** (`crm/src/espocrm.mjs`): hver post bærer
   `owner.subject`; en import uden ejer bruger kildens standardejer, og en post
   uden ejerskab afvises af konformansen.
4. **Import, opdatering og eksport** (`crm/src/sync.mjs`,
   `crm/src/store.mjs`): en filbaseret, holdbar butik med epoch. Import er
   idempotent på en idempotency-nøgle; findes posten på sin forretningsidentitet,
   opdateres den i stedet for at oprette en ny. Eksport bevarer den stabile
   reference og inkluderer aktiviteter.
5. **Dublethåndtering uden automatisk fletning** (`crm/src/dedup.mjs`): en
   dedup-nøgle beregnes tenantafgrænset ud fra de erklærede identitetsfelter. To
   forskellige upstream-poster med samme forretningsidentitet flettes **aldrig**
   automatisk — det er en konflikt der kræver et menneske (DKC-043's
   `assertStorageDedupAllowed`).
6. **Rollebeskyttelse og tenantisolation** (`crm/src/permissions.mjs`): adgang
   er default-deny. Tenant skal matche (et salgsteam kan ikke læse en anden
   kundes CRM), principalen skal have en rolle der må læse entitetstypen, og en
   fortrolig post kræver en tilsvarende klarering.
7. **Kontaktaktiviteter** (`crm/src/activities.mjs`): hver tilstandsovergang
   (oprettet, opdateret, konflikt, slettet) registreres append-only og
   uforanderligt.
8. **Tværgående sletning med retention og kopier** (`crm/src/retention.mjs`,
   `contracts/crm-deletion-receipt.schema.json`): en sletning kræver ejerskab
   eller skriveadgang i samme tenant, blokeres af et legal hold og rammer
   primær (tombstone), aktiviteter, indeks, platformens kopier og backup. En
   WORM-låst backupkopi opgives ærligt med udløb, og butikken kan snappes og
   gendannes.
9. **Konformans og negativ kontrol** (`conformance/src/crm.mjs`,
   `conformance/test/crm-conformance.test.mjs`): skema + beslutningssemantik,
   med afvisning af en ikke-EspoCRM kilde, en rå hemmelighed, en politik der
   tillader tværtenant-dedup, en post med en tværtenant-reference og en fuld
   sletterapport med resterende kopier.
10. **Releasebinding**: nyt krav `REQ-CRM-001` og trussel `THREAT-CRM-001`
    (matrixversion **1.38.0**), registreret i `tools/baseline/registry.mjs` som
    komponenten `crm` med `crm-check`, `crm-test`, `crm-run`, `crm-report` og
    `integration-espocrm-live` (sidstnævnte NOT RUN).

## Ændrede og nye filer

Se `deliverable/`. Filerne er beregnet ved at diffe arbejdsklonen mod en frisk
klon med kun `dkc-029/apply.sh` anvendt (53 filer, ekskl. `node_modules`,
`.conformance-out`, `.git`, `evidence/generated`). De vigtigste:

- Nye: `crm/` (kilder, politik, korpus, kilde, tests, `package.json`, rapport),
  `conformance/src/crm.mjs`, `conformance/test/crm-conformance.test.mjs`,
  `contracts/{crm-source,crm-record,crm-deletion-receipt}.schema.json` +
  eksempler, to `integration-candidate.{espocrm,erpnext}.example.json`,
  `docs/spec/crm.md`, `docs/crm/{crm-report,espocrm-live}.md`,
  `docs/operations/crm.md`,
  `docs/adr/0069-crm-med-entydigt-ejerskab-af-kundedata.md`.
- Ændrede: `Makefile` (7 targets + `ci`), `conformance/src/schemas.mjs`,
  `conformance/src/validate-schemas.mjs`, `tools/baseline/registry.mjs`,
  `release/matrix/{test-matrix,threats}.json`, genererede
  `docs/status/implementation-matrix.md`, `docs/status/supply-chain.md`,
  `docs/testing/test-matrix.md`, `docs/security/threat-model.md`,
  `release/{artifacts.json,sbom/platform-sbom.cdx.json}` (nyt
  `crm/package.json`).

## Testkommandoer og resultater

| Kommando | Resultat |
| --- | --- |
| `make validate` | PASS (3 nye kontrakter + 3 eksempler + 2 kandidater valideret; 134 skemaer, 147 eksempler) |
| `make lint` | PASS (727 JSON-filer, 1899 filer) |
| `make crm-candidates` | PASS (EspoCRM valgt foran ERPNext) |
| `make crm-check` | PASS (kilder, politik, poster og 7 scenarier) |
| `make crm-run` | PASS (7 scenarier) |
| `make crm-test` | PASS (26 enhedstests + 9 konformanstests) |
| `make crm-render` / `make crm-report` | PASS (deterministisk rapport) |
| `make release-check` | PASS (61 krav; matrixversion 1.38.0) |
| `make release-test` | PASS |
| `make supply-chain-check` | PASS (SBOM opdateret for nyt `package.json`) |
| `make test` | PASS (427 tests) |
| `make conform-all` | PASS |
| `make baseline-test` | PASS |
| `make baseline` | 239 checks: **186 PASS, 1 FAIL, 52 NOT RUN**. Det ene FAIL er det kendte, forudgående `changelog-check` (manglende DCO sign-off, også i `83ad91a`); det er ikke "rettet". |

E2e: pakkens `apply.sh` blev lagt på en frisk klon, `make install` kørt, og de
fokuserede checks passerer. Træet er byte-identisk med arbejdsklonen
(`evidence/e2e-tree-diff.txt`).

## Acceptkriterier

| Kriterium | Status | Bevis |
| --- | --- | --- |
| Kunde og kontakt kan importeres, opdateres og eksporteres med stabil reference | **PASS** | `crm/src/sync.mjs` + `crm/src/references.mjs`; scenariet `import-update-export` og `crm/test/sync.test.mjs` bekræfter, at referencen `crm:<tenant>:<entityType>:<upstreamId>` er uændret gennem en opdatering, og at eksporten bevarer den. |
| Retry laver ingen dubletter | **PASS** | `crm/src/dedup.mjs`; scenariet `retry-no-duplicates` og `crm/test/sync.test.mjs` bekræfter, at et retry med samme idempotency-nøgle returnerer den samme post uden at øge antallet. Scenariet `dedup-conflict-not-merged` bekræfter, at en dubleret forretningsidentitet giver en konflikt — aldrig en automatisk fletning. |
| Salgsteam kan ikke læse en anden kundes CRM | **PASS** | `crm/src/permissions.mjs`; scenariet `role-protection-and-isolation` og `crm/test/permissions.test.mjs` bekræfter tenantisolation i begge retninger, at support-rollen ikke må læse et salgsforløb, og at en fortrolig post kræver den rette klarering. |
| Tværgående sletning følger ejerskab og retention, også i kopier | **PASS** (implementeret kontrol) | `crm/src/retention.mjs`; scenariet `cross-cutting-deletion` og `crm/test/retention.test.mjs` bekræfter, at sletning kræver ejerskab/skriveadgang, at en tværtenant-reference afvises, at et legal hold blokerer, at primær/aktiviteter/indeks/kopier fjernes, og at en WORM-låst backupkopi opgives ærligt med udløb. En målt sletning mod en levende EspoCRM er **NOT RUN**. |

## Tilknyttede krav/checks og hvad der er NOT RUN

- `REQ-CRM-001` binder `crm-check`, `crm-test`, `crm-run` og `crm-report`;
  `THREAT-CRM-001` (grænsen `tenant-boundary`) dækker lækage, dubletter,
  automatisk fletning og ufuldstændig sletning.
- `integration-espocrm-live` er **NOT RUN**: der findes ingen levende EspoCRM,
  intet rigtigt API-token og ingen menneskelig kandidatgodkendelse. Se
  `docs/crm/espocrm-live.md`.
- Den valgte kandidat er teknisk rangeret, men **ikke** godkendt af et menneske i
  dette miljø (`verification.status: candidate_not_approved`).
- Rapporten erklærer `measured: false`.

## Gennemgå-identifikatorer

- Base: `5f9fa73457d22583b9948611d5cc3afffec4ae38`
- Checkout: `83ad91a963d8055f77c29fb4361455689df95acb`
- Stak-tip før dette overlay: `dkc-029/apply.sh`
- Denne ændring: denne pakkes `deliverable/` (53 filer) oven på stakken.
