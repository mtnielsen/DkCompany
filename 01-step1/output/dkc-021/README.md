# DKC-021 — Håndhæv sletning, legal hold og gendannelsesregler

Kumulativ overlay oven på DKC-001..DKC-048. Lægges med `./apply.sh <checkout>/00-core`.

- **Reviewets base:** `5f9fa73`
- **Undersøgt checkout:** `83ad91a`
- **Forudsætninger:** DKC-016, DKC-019, DKC-020 og DKC-048 er verificeret til
  stede i den anvendte stak (`backup/` med suppressionsjournalen,
  `compliance/` + `persistence/src/adapters/data-register.mjs` med
  retention/holds, `privacy/` med DSAR-sagen og `data-protection/` +
  `storage/storage-plan.json` med WORM). Overlayen kæder `dkc-048/apply.sh`
  (→ `dkc-041/apply.sh` → `dkc-039/apply.sh` → … → DKC-001).
- **Node:** v22.22.1

## Implementeret adfærd

Sletning er nu en dokumenteret, autoriseret og efterprøvelig proces på tværs af
alle datalag — og en gendannelse kan ikke genindføre slettede persondata.

1. **Politik og kontrakter** (`retention/deletion-policy.json`,
   `contracts/retention-deletion-policy.schema.json`,
   `contracts/legal-hold.schema.json`, `contracts/deletion-receipt.schema.json`):
   de fem obligatoriske datalag (primærlager, indeks, cache, afledte AI-data og
   backups) med en erklæret dækning pr. lag. En `partial`/`unsupported` flade
   **skal** have en præcis begrundelse og en navngivet ejer; et lag uden
   sletteevne må aldrig stå som fuld.
2. **Sletningstjenesten** (`retention/src/deletion-service.mjs`): default-deny
   autorisation; AI-principaler afvises altid; et aktivt hold i subjektets scope
   giver `blocked-by-hold` **før** nogen mutation. Der skrives et revisionsintent
   (kun subjektets digest og flade-id'er) før mutationen, hvorefter hver flade
   slettes og rapporterer ærligt.
3. **Sletteflader** (`retention/src/surfaces.mjs`): det rigtige objektlager
   (versionssletning via et digest-indeks i lageret, WORM-låste versioner
   respekteres), det genopbyggelige indeks, cachen, det lokale afledte AI-lager,
   backupfladen (suppressionsjournal) og en ekstern leverandør uden slette-API.
   Flader der ikke kan slette fysisk opgiver de resterende kopier med begrundelse
   og forventet udløb.
4. **Legal hold** (`retention/src/holds.mjs`): et hold kræver en dokumenteret
   begrundelse og en **separat** navngivet godkender (to-personers kontrol). Et
   aktivt hold blokerer enhver sletning i sin scope, også ved restore.
5. **Holdbar persistens** (`persistence/migrations/0012_retention_deletion.sql`,
   `persistence/src/adapters/retention.mjs`): `retention_holds`,
   `retention_deletion_receipts` og `retention_restore_gates` pr. tenant.
6. **Gendannelsesregler** (`retention/src/restore-gate.mjs`): et gendannet miljø
   holdes i **karantæne**; `applyDecisions` genanvender slettebeslutninger nyere
   end restorepunktet, og `release` nægter at frigive, hvis beslutninger mangler,
   journalen er vokset siden, eller et aktivt hold dækker et subjekt i
   karantænen. Dermed genanvendes slettebeslutninger **før** systemet frigives.
7. **Revisionsspor** (`retention/src/audit.mjs`): intent + udfald indeholder kun
   subjektets digest, flade-id'er og status — aldrig de slettede data eller rå
   identifikatorer. `assertRedacted` er fail-closed.

Den deterministiske gennemløbstest kører på den rigtige fillager-model
(`storage/`), den rigtige cache/indeks og den rigtige suppressionsjournal
(`backup/`); en målt sletning mod en levende modelleverandør er `NOT RUN`.

## Ændrede og nye filer

Se `evidence/deliverable-files.txt` (54 filer). Hovedgrupper:

- `retention/deletion-policy.json`, `retention/package.json`,
  `retention/src/{policy,holds,derived-ai,surfaces,audit,deletion-service,
  restore-gate,render,registry,check,cli,demo,index}.mjs`,
  `retention/test/{policy,holds,deletion,restore-gate,end-to-end}.test.mjs` +
  `support/fixture.mjs`.
- `contracts/{retention-deletion-policy,legal-hold,deletion-receipt}.schema.json`
  + 3 eksempler, `conformance/src/retention.mjs` +
  `conformance/test/retention-conformance.test.mjs`,
  `conformance/src/{schemas,validate-schemas}.mjs`.
- `persistence/migrations/0012_retention_deletion.sql`,
  `persistence/src/adapters/retention.mjs`, `persistence/src/db.mjs`
  (`TENANT_TABLES`), `persistence/test/{migrations,retention,ha}.test.mjs`.
- `Makefile` (`retention-write/-check/-test/-demo` + `ci`),
  `tools/baseline/registry.mjs` (komponent `retention` + 3 checks).
- `release/matrix/test-matrix.json` (1.18.0, `REQ-RETENTION-001`),
  `release/matrix/threats.json` (2 trusler),
  `release/sbom/platform-sbom.cdx.json`, `release/artifacts.json`,
  `docs/status/supply-chain.md`, `docs/testing/test-matrix.md`,
  `docs/security/threat-model.md`.
- `docs/adr/0049-…md`, `docs/adr/README.md`,
  `docs/spec/retention-deletion.md`, `docs/spec/README.md`,
  `docs/compliance/deletion-coverage.md`, `docs/compliance/README.md`,
  `docs/runbooks/deletion-legal-hold.md`,
  `docs/status/implementation-matrix.md` (regenereret af `make baseline`).

## Testkommandoer og resultat

| Kommando | Resultat |
| --- | --- |
| `make validate` | PASS — 85 skemaer og 88 eksempler, inkl. slettepolitik/hold/kvittering |
| `make lint` | PASS — 501 JSON-filer, 1272 filer |
| `make retention-check` | PASS — politik, dækning, hold-blokering, ærlig partial og restore |
| `make retention-test` | PASS — 28 retention-tests + 8 persistens + 8 konformanstests |
| `make retention-demo` | PASS — fuldt forløb på den rigtige stak |
| `make data-register-check/-test` | PASS — DKC-019-retention og holds intakte |
| `make data-protection-check/-test` | PASS — DKC-047/048-håndhævelse intakt |
| `make immutable-check/-test` | PASS — WORM intakt |
| `make persistence-check/-test` | PASS — 12 migrationer, 36 tenant-views, 78 tests |
| `make release-check` | PASS — 41 krav, matrixversion 1.18.0 |
| `make supply-chain-sbom` + `make supply-chain-check` | PASS (SBOM genregenereret efter nyt pakkemanifest) |
| `make test` | PASS — conformance-suiten (258 tests) |
| `make -k ci` | Kun den forud eksisterende `changelog-check` fejler |
| `make baseline` | 152 checks: 118 PASS, 1 FAIL, 33 NOT RUN |

## Acceptkriterier

| # | Kriterium | Status | Evidens |
| --- | --- | --- | --- |
| 1 | Hold blokerer ulovlig sletning inden for modulets dokumenterede scope | **PASS** | `retention/test/holds.test.mjs`; `deletion-service` tjekker `activeHoldsFor` før mutation og returnerer `blocked-by-hold` med `recordsAffected: 0` |
| 2 | Manglende upstreammulighed giver partial med præcis årsag | **PASS** | `retention/test/deletion.test.mjs`; `createUpstreamSurface`/`createDerivedAiSurface` rapporterer `unsupported`/`partial` med begrundelse og `remainingCopies[].expiresAt` |
| 3 | Restore genanvender slettebeslutninger før systemet frigives | **PASS** | `retention/test/restore-gate.test.mjs`; `release` nægter `decisions_pending`/`ledger_advanced`/`hold_blocks_release` |
| 4 | Sletteforsøg og resultat kan bevises uden at bevare de slettede data i logpayload | **PASS** | `retention/test/deletion.test.mjs` (rækkefølge intent→erase→outcome; rå e-mail findes ikke i revisionssporet) + `assertRedacted` |

## Leverancer

| # | Leverance | Status |
| --- | --- | --- |
| 1 | Retentionjobs, godkendt hold-proces og sletning fra primærlager, indeks, cache og afledte AI-data | **PASS** (ekstern leverandørkopi = ærlig `unsupported`) |
| 2 | Retention og adgangsbegrænsning for backups samt genanvendelse af slettebeslutninger ved restore | **PASS** |
| 3 | Modulsvar med resterende kopier, begrundelse og forventet udløb | **PASS** (`DeletionReceipt.results[].remainingCopies`) |

## Ærligt udestående

- `integration-retention-live` er **NOT RUN**: der findes ingen levende
  modelleverandør med slette-API og intet rigtigt objektlager i dette miljø.
  Sletning, hold-blokering, suppressionsjournal og restoregate er efterprøvet
  deterministisk på den rigtige fillager-model.
- Den eksterne leverandørkopi kan ikke slettes af platformen og står derfor som
  `unsupported` med en henvisning til databehandleraftalen; det er en ærlig
  dækningserklæring, ikke en fuldført sletning.
- Backupfladen kan ikke håndhæve et fysisk hold i den WORM-låste kopi; den
  genanvender i stedet slettebeslutningen ved restore.
- Baseline har fortsat den **forud eksisterende** `changelog-check`-fejl: commits
  (inkl. `83ad91a`) mangler DCO sign-off. Den er ikke indført eller skjult af
  DKC-021.

## Review-identifikatorer

- Review-base: `5f9fa73`
- Undersøgt checkout: `83ad91a`
- Forudsætnings-overlays: DKC-001..DKC-048 (tip `dkc-048/apply.sh`)
- Denne overlay: `dkc-021/`
- E2E: pakkens `apply.sh` på en frisk `83ad91a`-checkout giver et træ der er
  byte-identisk med arbejdsklonen (`evidence/e2e-tree-diff.txt` er tom).
