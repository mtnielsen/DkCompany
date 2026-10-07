# ADR-0031: Indbyggede og eksterne datatjenester med entydigt ejerskab

- **Status:** accepteret
- **Beslutningstagere:** Anna Andersen (Platform Owner), med Bo Bertelsen som stedfortræder
- **Dato:** 2026-09-23
- **Beslutningsdrev:** DKC-056. «Applikationens database», «et eksternt analyseinput» og «et backupmål» behandles let som én ting. Det giver forkerte beslutninger: en connector får generel læseadgang, en migration rammer et fremmed schema, en ekstern kilde sikkerhedskopieres automatisk, og ingen kan svare på, hvem der ejer patching, backup, restore, nøgler og omkostninger.

## Kontekst og problemstilling

- **Tre datatyper, tre ejerskaber.** En administreret database, en BYO-database og en ekstern connector har forskellige ejere og forskellige grænser.
- **Ingen egen engine.** Platformen skal ikke bygge eller drive sin egen databaseengine; den skal beskrive og håndhæve en kontrakt mod en understøttet motor.
- **Read-only er standard.** En connector til HR eller et analyseinput må ikke give generel læseadgang og må ikke skrive.
- **Scope.** Adgang skal være eksplicitte `schema.tabel`-par, ikke jokertegn eller «alle tabeller».
- **Migration.** En migration må ikke ændre fremmede skemaer eller slette eksisterende data.
- **Backup.** En ekstern kilde er ikke platformens egen database og må ikke sikkerhedskopieres automatisk uden en aftalt scope.
- **Fejl.** Netværksudfald, certifikatrotation og versionsmismatch skal give kontrollerede, typede fejl — ikke ukontrollerede nedbrud.

## Beslutningskriterier

- Versionerede kontrakter for databaseprofiler (managed/BYO), datakilder og bindinger.
- En ansvarsmatrix pr. profil med navngivne mennesker for patching, backup, restore, nøgler, omkostninger, overvågning og migration.
- Read-only connectorer med tenantbinding, secretreferencer, scope, skemadiscovery og revisionsspor.
- En migrationsguard der afviser fremmede skemaer og destruktive ændringer uden godkendelse.
- Backup/restore med verificerbar digest og scope-håndhævelse for eksterne kilder.
- En UI/operatørvisning der viser ejerskabet.
- Ærlig erklæring af at den rigtige PostgreSQL-instans ikke er kørt i dette miljø.

## Overvejede muligheder

- **Én «database»-abstraktion.** Simpelt, men sammenblander ejerskab, scope og backup og giver forkert ansvar.
- **Kun dokumentation og ansvarsmatrix.** Gør ejerskabet tydeligt, men håndhæver hverken read-only, scope eller migrationsgrænser.
- **Kontrakter + connector-guard + migrationsguard + drivers + operator-UI, med ærlig PostgreSQL-grænse.** Kræver vedligeholdelse, men gør hver grænse efterprøvelig.

## Beslutning

Vi indfører indbyggede og eksterne datatjenester, håndhævet i
`contracts/database-profile.schema.json`, `contracts/data-source.schema.json`,
`contracts/data-service-binding.schema.json`,
`conformance/src/data-services.mjs`, `data-services/` og
`persistence/migrations/0008_data_services.sql`:

1. **Profiler.** `managed` og `byo`; begge med `noOwnEngine`, testede versioner, TLS og adskilt tenantidentitet. BYO kan ikke lægge motordriften på platformen alene.
2. **Ansvarsmatrix.** Hver profil besvarer patching, backup, restore, nøgler, omkostninger, overvågning og migration med et navngivet menneske.
3. **Connectorer.** Read-only, tenantbundne, secretreferencer, eksplicit scope, skemadiscovery og revisionsspor. HR giver ikke adgang til alle tabeller.
4. **Migrationsguard.** Kun ejede skemaer; ingen `DROP SCHEMA`, ingen sletning uden `WHERE`, destruktive ændringer kræver godkendelse, eksterne kilder afvises.
5. **Backup/restore.** Logisk snapshot med digest; eksterne kilder kun med `autoBackup` og en eksplicit scope-aftale.
6. **Drivere.** `node:sqlite` indbygget og en rigtig PostgreSQL wire-driver (SSL, SCRAM/MD5/cleartext, udvidede forespørgsler). Samme applikationskode kører mod begge.
7. **Persistens.** Tenant-bundne tabeller for profiler, kilder, bindinger, snapshots, migrationslog og revisionsspor.
8. **UI.** `docs/compliance/data-services.md` og `.html` genereres fra registry-data og kontrolleres for sync.
9. **Ærlighed.** Den rigtige PostgreSQL-driver efterprøves mod en protokolfast test-dobbelt. En installeret PostgreSQL er `integration-postgresql` (NOT RUN).

Resultatet valideres i `make validate`, `make data-services-check`,
`make data-services-test` og i CI.

## Konsekvenser

- **Positive:** Ejerskab, scope, read-only, migrationsgrænser og backup er efterprøvelige og kan ikke smelte sammen. Samme applikationskode kører mod indbygget og ekstern database.
- **Negative:** Registry og ansvarsmatrix skal vedligeholdes, og den fulde effekt mod en rigtig PostgreSQL-instans kræver en ekstern installation.
- **Neutrale:** Den eksterne politik er en delt, versioneret kontrakt uden for den signerede platform-bundle.

## Fordele og ulemper ved mulighederne

| Mulighed | Fordele | Ulemper |
| --- | --- | --- |
| Én database-abstraktion | Simpel | Sammenblander ejerskab, scope og backup |
| Kun dokumentation | Tydeligt ejerskab | Håndhæver ingen grænser |
| Kontrakter + guards + drivere | Efterprøveligt | Kræver ekstern PostgreSQL for fuld effekt |

## Mere information

- [`docs/spec/data-services.md`](../spec/data-services.md)
- [`docs/compliance/data-services.md`](../compliance/data-services.md)
- [`contracts/database-profile.schema.json`](../../contracts/database-profile.schema.json),
  [`contracts/data-source.schema.json`](../../contracts/data-source.schema.json),
  [`contracts/data-service-binding.schema.json`](../../contracts/data-service-binding.schema.json)
- [`data-services/src/connector.mjs`](../../data-services/src/connector.mjs),
  [`data-services/src/migration-scope.mjs`](../../data-services/src/migration-scope.mjs)
- [ADR-0006](0006-alle-modelkald-gennem-gateway.md), [ADR-0013](0013-deployment-og-tenantmodel.md), [ADR-0017](0017-tenant-kontekst-og-ressource-id.md), [ADR-0019](0019-holdbar-tilstand-og-migrationer.md), [ADR-0029](0029-dataregister-og-retention.md)
