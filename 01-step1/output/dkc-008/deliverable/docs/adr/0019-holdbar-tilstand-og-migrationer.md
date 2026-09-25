# ADR-0019: Holdbar tilstand med versionerede migrationer og adskilte databaseidentiteter

- **Status:** accepteret
- **Beslutningstagere:** Platformsejerskab
- **Dato:** 2026-09-23
- **Beslutningsdrev:** DKC-008. Godkendelser, jobs, budgetter og audit lå i proceshukommelse eller i løse filer uden transaktioner. Et genstart eller en samtidig worker kunne tabe eller fordoble tilstand, og der fandtes ingen versionsstyret opgraderings- eller gendannelsesstrategi.

## Kontekst og problemstilling

Platformens kontrolplan skal kunne køre med flere replikaer og overleve et procesnedbrud. Før DKC-008 var tilstanden spredt:

- den tenant-afgrænsede jobkø og modelhistorik i `identity/src/tenant-store.mjs` levede kun i hukommelsen,
- budgetter blev ført i `runtime`-processen,
- audit-loggen i `modules/audit-service` var en in-memory kæde,
- godkendelser havde et filbaseret lager, men ingen transaktioner eller fælles skema.

Dermed kunne et genstart glemme committede godkendelser og job, to samtidige workers kunne læse-ændre-skrive hen over hinanden, og der fandtes hverken et schema at opgradere fra eller en afprøvet gendannelse.

## Beslutningskriterier

- Et genstart må ikke tabe committede godkendelser eller jobtilstand.
- Samtidige writes fra flere processer/replikaer skal bevare konsistens.
- En forkert tenant må ikke kunne hente data gennem databaseadgangen.
- Opgradering fra forrige schema og gendannelse fra backup skal være afprøvet.

## Overvejede muligheder

- **Behold filer og lås manuelt.** Skrøbeligt, ingen transaktioner, ingen schema-versionering, ingen fælles tenant-grænse.
- **Kræv en ekstern PostgreSQL med RLS med det samme.** Den rigtige fler-node-løsning, men der findes ingen database i dette miljø, så intet ville kunne afprøves.
- **Indfør et portabelt persistenslag på `node:sqlite` med versionerede SQL-migrationer, transaktioner og tenant-scopede repositories, og skriv kontrakten så en PostgreSQL-driver kan afløse SQLite.** Kan afprøves rigtigt her og er den samme arkitektur i produktion.

## Beslutning

1. **`persistence/` er den ene kilde til holdbar tilstand.** `openDatabase` åbner en filbaseret SQLite-database med WAL, `busy_timeout`, foreign keys og eksplicitte `BEGIN IMMEDIATE`-transaktioner. Indlejrede transaktioner bruger savepoints.
2. **Migrationer er versionerede SQL-filer** i `persistence/migrations/NNNN_navn.sql`. `createMigrator` anvender dem i rækkefølge, én ad gangen, i en transaktion, og registrerer version, navn og SHA-256 i `schema_migrations`. En efterfølgende ændring af en anvendt migration afvises (fail-closed), og `apply({ toVersion })` bruges til at afprøve opgraderingsforløb.
3. **Adskilte databaseidentiteter.** `openIdentity` åbner en identitets database (fx `approvals.db`, `runtime.db`, `audit.db`) og eksponerer kun dens domænerepos. En skrivebeskyttet rapporteringsidentitet åbner forbindelsen med `readOnly`, som SQLite selv håndhæver. I en klynge er den tilsvarende revidering separate PostgreSQL-roller med GRANTs; kontrakten er den samme.
4. **Tenantgrænser i databasen.** Hver tabel har `tenant_id` som del af den primære nøgle, så identiske lokale id'er hos to kunder er forskellige rækker. Repositories tager tenanten som første argument og læser aldrig uden for den. Derudover opretter `openDatabase` per-forbindelses tenant-views (`v_approval_requests`, …) filtreret på en `session_context`, så en ubetinget forespørgsel gennem viewet heller ikke kan se en anden kunde.
5. **Backup og gendannelse.** `backupDatabase` bruger SQLite's online-backup (konsistent snapshot under WAL), og `restoreDatabase` integrritetstjekker og verificerer rækkeantal før den tages i brug. `exerciseBackupRestore` kører øvelsen mod flere databaser.

## Konsekvenser

- **Positive:** Godkendelser, jobs, budgetter og audit overlever genstart; samtidige writes serialiseres; en forkert tenant afvises både i repository-laget og af tenant-viewet; opgradering og gendannelse er afprøvet. Skemaet er portabelt SQL.
- **Negative:** `node:sqlite` er markeret eksperimentelt i Node og kræver Node ≥ 22.5. Fler-node-replikaer kræver fortsat en netværksdatabase (PostgreSQL); SQLite er test- og enkelt-node-løsningen. Den nøjagtige PostgreSQL-oversættelse er ikke afprøvet her (NOT RUN).
- **Neutrale:** Den eksisterende filbaserede approval-ledger og in-memory-stores bevares for korte processer og enhedstests, men tjenester kan skifte til SQLite-lageret uden at ændre deres kontrakt.

## Fordele og ulemper ved mulighederne

| Mulighed | Fordele | Ulemper |
| --- | --- | --- |
| Filer + manuel låsning | Små ændringer | Ingen transaktioner/schema/tenant-grænse |
| Kræv PostgreSQL/RLS | Fler-node fra dag ét | Ikke afprøvbart uden en database i miljøet |
| Portabelt SQLite-lag + migrationer + identiteter | Afprøvet rigtigt, samme arkitektur i klynge | SQLite er enkelt-node; kræver Node ≥ 22.5 |

## Mere information

- [`docs/spec/persistence.md`](../spec/persistence.md)
- [`persistence/src/db.mjs`](../../persistence/src/db.mjs), [`persistence/src/migrations.mjs`](../../persistence/src/migrations.mjs), [`persistence/src/identities.mjs`](../../persistence/src/identities.mjs), [`persistence/src/backup.mjs`](../../persistence/src/backup.mjs)
- [ADR-0013](0013-deployment-og-tenantmodel.md), [ADR-0017](0017-tenant-kontekst-og-ressource-id.md), [ADR-0018](0018-stram-policy-scope-og-evidenkontrol.md)
