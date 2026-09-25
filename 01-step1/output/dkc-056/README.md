# DKC-056 — Indbyggede og eksterne datatjenester med entydigt ejerskab (leverance)

Implementering af **DKC-056** for `mtnielsen/DkCompany`. Bygger på
DKC-001 .. DKC-013, DKC-055, DKC-037, DKC-053 og DKC-063 + DKC-019 + DKC-047.
`00-core/` i det faktiske repo er fortsat **ikke ændret**; alt ligger under
`01-step1/output/dkc-056/`.

## Forudsætninger og valg

DKC-056 afhænger formelt af **DKC-008, DKC-019 og DKC-053**. Overlayen lægges
oven på hele den nuværende stak via `dkc-047/apply.sh`, som kæder
`dkc-019/apply.sh` → `dkc-063/apply.sh` → `dkc-053/apply.sh` og dermed
DKC-001 .. DKC-013 + DKC-055 + DKC-012 + DKC-037. **DKC-047 er valgt som
forudsætning, fordi den er den aktuelle stak-top.**

DKC-056 blev valgt frem for DKC-014 (den anden P0-kandidat), fordi DKC-056's
afhængigheder (DKC-008/019/053) findes som kørende, rigtig kode i stakken
(`node:sqlite`-persistens, dataregister, katalog/profiler), og opgaven kan
implementeres og efterprøves fuldt i dette miljø. DKC-014 (containerbuilds,
SBOM, signering, provenance, branch protection) er miljømæssigt blokeret:
Docker er ikke tilgængelig i WSL-distroen, og `cosign`/`syft`/`trivy` er ikke
installeret, mens GitHub Actions er slået fra. En påstand om «bygget og
signeret» ville derfor være en mock. Det er dokumenteret i
`docs/status/implementation-matrix.md`.

## Hvad der er implementeret

1. **Tre nye versionerede kontrakter.**
   - `contracts/database-profile.schema.json` — `kind: DatabaseProfile` for
     `managed` og `byo`: motor/versioner, sikre defaults, kryptering, TLS,
     migrationer, backup, overvågning, tenant-isolation og en ansvarsmatrix.
   - `contracts/data-source.schema.json` — `kind: DataSource`: read-only
     connector med tenantbinding, scope, secretreference, skemadiscovery,
     dataejerskab, revisionsspor og låst ekstern-politik.
   - `contracts/data-service-binding.schema.json` — `kind: DataServiceBinding`:
     binder en applikation til en profil og et sæt kilder med eksplicit scope.
2. **Semantisk validator.** `conformance/src/data-services.mjs` afviser bl.a.
   manglende navngivne ejere, en BYO-profil der lægger motordriften på
   platformen, manglende verificeret restore, rå hemmeligheder i stedet for
   secretreferencer, wildcard-scope, HR-kilder uden eksplicit tabelscope,
   auto-migrate/auto-backup af eksterne kilder og bindings der udvider scopet.
3. **Drivere.** `data-services/src/drivers/` indeholder den indbyggede
   SQLite-driver (`node:sqlite`) og en rigtig PostgreSQL v3-wire-driver
   (`pg-wire.mjs`, `scram.mjs`, `postgres.mjs`) med SSL-forhandling,
   cleartext/MD5/SCRAM-SHA-256, simpel og udvidet forespørgsel og typede fejl
   (`NetworkError`, `CertificateError`, `VersionMismatchError`,
   `AuthenticationError`, `QueryError`).
4. **Connectorer.** `data-services/src/connector.mjs` håndhæver read-only
   (også i CTE'er), eksplicit scope (HR giver ikke adgang til alle tabeller),
   tenantbinding fra den verificerede principal, secretopløsning uden lækage og
   et revisionsspor for connect/discovery/query/denied/disconnect.
5. **Migrationsguard.** `data-services/src/migration-scope.mjs` afviser
   fremmede skemaer, `DROP SCHEMA`, sletning/opdatering uden `WHERE` og
   destruktive ændringer uden navngivet godkender. Eksterne kilder må aldrig
   migreres.
6. **Recovery.** `data-services/src/recovery.mjs` tager en logisk, verificerbar
   snapshot, afviser en muteret digest og nægter at sikkerhedskopiere en ekstern
   kilde uden en eksplicit scope-aftale.
7. **Samme app mod begge motorer.** `data-services/src/app-repository.mjs`
   kører uændret mod SQLite og PostgreSQL (dialektsymmetrisk SQL og
   `?`-pladsholdere), og kontrakt-/recoverytesten kører mod begge.
8. **Persistens.** `persistence/migrations/0008_data_services.sql` +
   `persistence/src/adapters/data-services.mjs` giver tenant-bundet holdbar
   tilstand for profiler, kilder, bindinger, discovery-snapshots, migrationslog
   og revisionsspor.
9. **Operatør-UI.** `data-services/src/render.mjs` genererer
   `docs/compliance/data-services.md` og `docs/compliance/data-services.html`,
   der viser hvem der ejer patching, backup, restore, nøgler og omkostninger.
10. **Registry og CLI.** `data-services/` indeholder kanoniske profiler, kilder
    og bindinger samt `check.mjs`/`cli.mjs` (`render`/`write`/`check`/`explain`/
    `preview`).
11. **CI og baseline.** `Makefile` får `data-services-write/-check/-test` (med i
    `make ci`); `tools/baseline/registry.mjs` registrerer komponenten
    `data-services`, checks og den ærlige eksterne integration
    `integration-postgresql` (NOT RUN).
12. **Dokumenter.** `docs/spec/data-services.md`, ADR-0031 og opdaterede
    indekser (`docs/spec/README.md`, `docs/adr/README.md`).

## Ændrede/nye filer (overlay, relativt til `00-core/`)

```
Makefile                                             (+ data-services-write/-check/-test, + i ci)
conformance/src/data-services.mjs                    (ny: semantisk validator)
conformance/src/schemas.mjs                          (+ 3 skema-id'er)
conformance/src/validate-schemas.mjs                 (+ databaseprofil/datakilde/binding)
conformance/test/data-services-conformance.test.mjs  (ny: 8 accept-/negativtests)
contracts/database-profile.schema.json               (ny)
contracts/data-source.schema.json                    (ny)
contracts/data-service-binding.schema.json           (ny)
contracts/examples/{database-profile.managed,database-profile.byo,data-source.hr,data-service-binding.dummy-ok}.example.json (ny)
data-services/package.json                           (ny)
data-services/profiles/{managed-postgres,byo-postgres}.json (ny)
data-services/sources/{hr-source,analytics-source}.json (ny)
data-services/bindings/dummy-ok-binding.json         (ny)
data-services/src/{errors,secrets,app-repository,migration-scope,recovery,connector,registry,render,check,cli}.mjs (ny)
data-services/src/drivers/{index,sqlite,pg-wire,scram,postgres}.mjs (ny)
data-services/test/{connector,migration-scope,postgres-driver,registry-render,same-app}.test.mjs (ny)
data-services/test/support/{fake-postgres,tls-fixtures}.mjs (ny: protokoldobbelt + openssl-genererede TLS-fixtures)
docs/spec/data-services.md                            (ny: spec)
docs/adr/0031-indbyggede-og-eksterne-datatjenester.md (ny: ADR)
docs/compliance/data-services.{md,html}               (ny: genereret operatør-UI)
docs/{adr,spec}/README.md                             (opdateret indeks)
docs/status/implementation-matrix.md                  (regenereret med DKC-056-checks)
persistence/migrations/0008_data_services.sql         (ny)
persistence/src/adapters/data-services.mjs            (ny)
persistence/src/db.mjs                                (+ 6 tenant-views)
persistence/test/data-services.test.mjs               (ny: 4 tests)
persistence/test/migrations.test.mjs                  (+ version 8 og v8-tabeller)
tools/baseline/registry.mjs                           (+ component + 2 checks + integration-postgresql)
```

## Testkommandoer og resultater

Alle kørsler er fra `00-core/` i den disposable checkout
(`/tmp/dkc-056/00-core`, commit `83ad91a`, Node v22.22.1). Fuld log ligger i
`evidence/`.

| Kommando | Resultat |
| --- | --- |
| `make validate` | ✔ 47 kontraktskemaer, 47 eksempler, 2 databaseprofiler, 1 datakilde, 1 binding (skema + semantik) |
| `make lint` | ✔ 275 JSON-filer, 700 filer |
| `make data-services-check` | ✔ 2 profiler, 2 kilder, 1 binding; dokumenter i sync |
| `make data-services-test` | ✔ 51 tests (39 data-services + 4 persistens + 8 conformance), 0 fail |
| `make persistence-test` | ✔ 56 tests, 0 fail (inkl. migration 8 og tenantgrænser) |
| `make test` (conformance-suiten) | ✔ 131 tests, 0 fail |
| `make data-register-check` / `data-protection-check` | ✔ (ingen regression) |
| `make distribution-check` | ✔ (ingen regression) |
| `make baseline-test` | ✔ 8 tests, 0 fail |
| `make baseline` | 85 checks: 73 pass, 1 fail, 0 error, 11 not run. Det ene fail er `changelog-check` (eksisterende commits uden DCO sign-off) — præeksisterende og uden for DKC-056. `data-services-check`/`-test` = PASS; `integration-postgresql` = NOT RUN. |

## Acceptkriterier

| Kriterium | Status | Evidens |
| --- | --- | --- |
| Den samme app kører mod indbygget og understøttet ekstern database med kontrakt- og recoverytests | **PASS** (ekstern motor efterprøvet mod protokoldobbelt) | `data-services/test/same-app.test.mjs` kører samme `app-repository` mod SQLite og PostgreSQL-wire; backup/restore/verify på begge. `integration-postgresql` er NOT RUN (ingen installeret server). |
| Separat DB-role/database eller dokumenteret tilsvarende isolation pr. tenant/app | **PASS** | `tenantIsolation` (database-/schema-per-tenant + `separateIdentity`), `db.mjs`-tenantviews og adapterens eksplicitte `tenant_id`-filter; krydskunde-test i `persistence/test/data-services.test.mjs`. |
| Tilslutning til HR-kilde giver ikke generelt læseadgang til alle tabeller | **PASS** | `connector.mjs` scope-guard; `hr.payroll` afvises mens `hr.employees` er tilladt (`data-services/test/connector.test.mjs`); `dataSourceProblems` afviser wildcard. |
| Netværksudfald, certifikatrotation og versionsmismatch giver kontrolleret fejl | **PASS** | Typede fejl i `postgres.mjs`; tests for `NetworkError`, `CertificateError` (CA-rotation + pinnet leaf) og `VersionMismatchError`. |
| Migration ændrer ikke fremmede skemaer eller sletter eksisterende data | **PASS** | `migration-scope.mjs` afviser fremmede skemaer og destruktive ændringer; test beviser at eksisterende data bevares og backup kaldes før destruktiv migration. |
| UI viser hvem der ejer patching, backup, restore, nøgler og omkostninger | **PASS** | `render.mjs` → `docs/compliance/data-services.md` og `.html`; `registry-render.test.mjs` kontrollerer alle kolonner og ejernavne. |

Alle seks acceptkriterier er **PASS**. Det ene forbehold er, at den eksterne
PostgreSQL-motor er efterprøvet på protokolniveau mod en test-dobbelt, ikke mod
en installeret server (`integration-postgresql`: NOT RUN).

## Grænser og forbehold

- **Ingen installeret PostgreSQL.** Den rigtige wire-driver er efterprøvet mod
  `data-services/test/support/fake-postgres.mjs`, en protokolfast server der
  udfører på SQLite. Det beviser driverens protokoladfærd, ikke en bestemt
  PostgreSQL-installations drift. Registreret ærligt som `integration-postgresql`
  (NOT RUN).
- **TLS-fixtures genereres på testtidspunktet** med `openssl` i en midlertidig
  mappe; private nøgler committes ikke. Kræver `openssl` i testmiljøet.
- **Managed profil er ikke en egen engine.** Profilen beskriver og håndhæver en
  kontrakt mod en understøttet motor; den faktiske managed drift er en ekstern
  produktionsopgave.
- **`make baseline` fejler på `changelog-check`** (DCO sign-off på eksisterende
  commits, bl.a. `83ad91a`). Det er præeksisterende og uden for DKC-056.
- **Ingen uafhængig verifikation, penetrationstest eller produktionsrelease** er
  udført.

## Review

- Reviewets base: `5f9fa73` · undersøgt checkout: `83ad91a`.
- Forudsætnings-overlays: `dkc-047/apply.sh` (kæder DKC-001 .. DKC-013 +
  DKC-055 + DKC-012 + DKC-037 + DKC-053 + DKC-063 + DKC-019 + DKC-047).
- Pakken er verificeret med `sha256sum -c OVERLAY-MANIFEST.txt` og med
  `./apply.sh` på et rent klon.
