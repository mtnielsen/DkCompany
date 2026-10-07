# Indbyggede og eksterne datatjenester

DKC-056 skelner mellem tre ting, der let smelter sammen:

1. **Applikationens database** — den administrerede profil eller kundens BYO-database, som platformen migrerer og tager backup af efter aftale.
2. **Et eksternt analyseinput** — en connector til et system platformen ikke ejer, read-only og scope-begrænset.
3. **Et backupmål** — en offsite destination, ikke en læsbar datakilde.

Platformen driver ikke sin egen databaseengine. Den beskriver og håndhæver en kontrakt mod en understøttet motor.

## Databaseprofiler

En databaseprofil (`contracts/database-profile.schema.json`, `kind: DatabaseProfile`) er enten `managed` eller `byo`.

- **Managed.** Platformen leverer profilen med sikre defaults, kryptering ved hvile og undervejs, mindst-privilegium-roller, audit, overvågning, backup og verificeret gendannelse. Ansvarsmatricen lægger patching, backup, restore, nøgler, omkostninger, overvågning og migration hos platformen eller hos en delt ejer — altid med et navngivet menneske.
- **BYO.** Kunden ejer sin egen motor. Profilen kræver en understøttet motorversion, TLS, eksplicit accepteret ansvar og en distribueret ansvarsmatrix. Platformen må ikke lægge motordriften på sig selv alene; `patching`, `backup`, `restore`, `nøgler` og `omkostninger` skal være `customer` eller `shared`.

Fælles for begge:

- `engine.noOwnEngine` er `true`: platformen erklærer aldrig sin egen engine.
- Mindst én understøttet version skal være `tested: true`.
- `migrations.foreignSchemaPolicy` er `never`: en migration må kun ramme `ownedSchemas`.
- `tenantIsolation.separateIdentity` er `true`: hver tenant/app har en adskilt databaseidentitet (database-per-tenant, schema-per-tenant eller tilsvarende).

## Datakilder og connectorer

En datakilde (`contracts/data-source.schema.json`, `kind: DataSource`) beskriver en connector til et eksternt system:

- **Read-only som standard.** `access.readOnly`, `denyWrites` og `denyDdl` er kontraktuelt låst. `data-services/src/connector.mjs` afviser enhver forespørgsel, der ikke er `SELECT`/`WITH`/`SHOW`/`EXPLAIN`/`VALUES`, og afviser skrive- eller DDL-operationer også inde i en CTE.
- **Scope, ikke generel adgang.** `access.allowedTables` er eksplicitte `schema.tabel`-par. Jokertegn og tomme lister afvises. En HR-connector til `hr.employees` giver ikke adgang til `hr.payroll`. Connector-guarden udtrækker hver `FROM`/`JOIN`-reference og afviser tabeller uden for scopet, før forespørgslen sendes.
- **Tenantbinding.** `tenantBinding.source` er `principal`. Connectoren udleder tenanten af den verificerede principal og afviser en principal uden tenant.
- **Secretreferencer.** `connection.secretRef` er en reference (`vault:`, `k8s:`, `env:`, `file:`, `kms:`), aldrig en hemmelighed. `data-services/src/secrets.mjs` opløser den gennem en injiceret resolver; værdien logges aldrig.
- **Skemadiscovery.** Discovery filtreres til scopet, så en connector ikke lærer hele databasen at kende.
- **Revisionsspor.** Connect, discovery, query, denied og disconnect registreres med tenant, principal, operation, tabelreferencer og en SQL-digest — ikke SQL-teksten eller data.
- **Ekstern politik.** `treatAsOwnDatabase`, `autoMigrate` og `autoBackup` er kontraktuelt låst til `false`, og `scopeAgreementRef` er påkrævet.

En applikation bindes til en profil og et sæt kilder gennem `contracts/data-service-binding.schema.json` (`kind: DataServiceBinding`). Bindingens scope må ikke udvide kildens scope, og `externalDataHandling` kan ikke slås til.

## Drivere

Samme applikationskode (`data-services/src/app-repository.mjs`) kører mod begge drivere, fordi den kun bruger dialectsymmetrisk SQL og `?`-pladsholdere.

- **Indbygget SQLite** (`data-services/src/drivers/sqlite.mjs`) på `node:sqlite`.
- **PostgreSQL** (`data-services/src/drivers/postgres.mjs`) taler den rigtige PostgreSQL v3-wire-protokol over `node:net`/`node:tls`: SSL-forhandling, cleartext/MD5/SCRAM-SHA-256, simpel og udvidet forespørgsel og skemadiscovery. Fejl er typede: `NetworkError`, `CertificateError` (inkl. pinnet leaf-certifikat og rotation), `VersionMismatchError`, `AuthenticationError` og `QueryError`.

## Migrationer

`data-services/src/migration-scope.mjs` analyserer hver migration før den kører:

- hvert mål skal ligge i et ejet schema; fremmede skemaer afvises,
- `DROP SCHEMA` afvises altid,
- `DELETE`/`UPDATE`/`TRUNCATE` uden `WHERE` afvises,
- destruktive ændringer kræver en navngivet godkender, når profilen kræver det,
- en ekstern datakilde afvises altid.

Dermed ændrer en migration ikke fremmede skemaer og sletter ikke eksisterende data.

## Backup og gendannelse

`data-services/src/recovery.mjs` tager en logisk, verificerbar snapshot af de tabeller platformen ejer og gendanner den til en ren database. Snapshot-digesten kontrolleres, så en muteret snapshot afvises. En ekstern kilde må kun sikkerhedskopieres, hvis `autoBackup` er sand og en eksplicit scope-aftale foreligger; ellers afvises det.

## Persistens

`persistence/migrations/0008_data_services.sql` giver tenant-bundet holdbar tilstand for profiler, kilder, bindinger, discovery-snapshots, migrationslog og revisionsspor. `persistence/src/adapters/data-services.mjs` normaliserer tenant-id og filtrerer eksplicit, så en fremmed tenant ikke kan læse en andens datatjenester.

## Operatør-UI

`data-services/src/render.mjs` genererer `docs/compliance/data-services.md` og `docs/compliance/data-services.html` fra registry-data. Visningen svarer på, hvem der ejer patching, backup, restore, nøgler og omkostninger pr. profil, og hvilket scope og hvilke eksterne politikker hver kilde har. `make data-services-check` fejler, hvis dokumenterne er ude af trit.

## Test og afgrænsning

`make data-services-check` er kontraktkontrollen. `make data-services-test` kører driver-, connector-, migrations-, recovery-, registry- og persistens­testene. Den rigtige PostgreSQL-driver efterprøves mod en protokolfast test-dobbelt (`data-services/test/support/fake-postgres.mjs`); en installeret PostgreSQL-instans er ikke tilgængelig i dette miljø og er registreret som `integration-postgresql` (NOT RUN). TLS-fixtures genereres på testtidspunktet med `openssl` i en midlertidig mappe, så private nøgler ikke committes.

Se [ADR-0031](../adr/0031-indbyggede-og-eksterne-datatjenester.md).
