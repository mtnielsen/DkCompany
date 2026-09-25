# Holdbar tilstand, migrationer og databaseidentiteter (DKC-008)

Godkendelser, jobs, budgetter og audit skal overleve et procesnedbrud og kunne
deles af flere replikaer. `persistence/` er platformens ene kilde til holdbar
tilstand. Den bygger på `node:sqlite` (SQLite med WAL og rigtige
transaktioner), men er skrevet som et tyndt, portabelt SQL-lag, så en
PostgreSQL-driver kan afløse SQLite uden at ændre adapterkontrakterne.

Arkitekturvalget er dokumenteret i [ADR-0019](../adr/0019-holdbar-tilstand-og-migrationer.md).

## Lag

```
openDatabase ──► migrations (versionerede .sql) ──► tabeller + tenant-views
      │
      ├── openIdentity("<navn>")          adskilt database + least-privilege repos
      └── adapters/
            approvals.mjs                   godkendelseslager + atomisk claim
            approval-ledger.mjs             append-only beslutningslog
            jobs.mjs                        jobkø med leases og recovery
            budgets.mjs                     atomiske budgettællere med loft
            audit.mjs                       append-only audit med hash-kæde
```

Alle adapters tager en åben database og er uafhængige af, om forbindelsen er
skrivebeskyttet, delt mellem processer eller en anden driver.

## Skema (version 1)

| Tabel | Nøgle | Formål |
| --- | --- | --- |
| `approval_requests` | `(tenant_id, id)` | hele den serverstyrede godkendelsesanmodning som JSON + `state`/`revision` |
| `approval_claims` | `(tenant_id, approval_id)` | atomisk reservation, så en godkendelse kun forbruges én gang |
| `jobs` | `(tenant_id, id)` | jobkø med `status`, `attempts`, `leased_by`, `leased_at`, `heartbeat_at` |
| `budgets` | `(tenant_id, budget_key)` | tokens, EUR og kald, valgfrit `ceiling_tokens` |
| `audit_events` | `seq` (auto), unik `(tenant_id, id)` | append-only audit med `prev_hash`/`hash` pr. tenant |
| `approval_ledger` | `seq` (auto) | append-only beslutningslog med hash-kæde |
| `schema_migrations` | `version` | anvendte migrationer med `checksum` og `applied_at` |

Alle tenant-tabeller har `tenant_id` som del af den primære nøgle. Identiske
lokale id'er hos to kunder er derfor forskellige rækker og kan hverken kollidere
eller læses på tværs.

## Migrationer og opgradering

- Filer hedder `NNNN_navn.sql` og anvendes i nummerorden.
- Hver migration kører i én transaktion og registreres med sin SHA-256.
- `apply({ toVersion })` gør det muligt at opgradere trinvist (fx v1 → v2).
- `apply({ dryRun: true })` rapporterer planen uden at ændre noget.
- `verifyChecksums()` (og `createMigrator`) afviser, hvis en anvendt migration
  er ændret efterfølgende.

**Opgraderingsstrategi (rækkefølge):**

1. Tag en verificeret backup (`make persistence-test` viser øvelsen).
2. Kør `apply({ dryRun: true })` mod et snapshot og læs planen.
3. Anvend migrationerne. Additive ændringer (nye kolonner med default) er
   bagudkompatible; destruktive ændringer skal varsles og have en plan for
   tilbagerulning.
4. Verificér `status().problems.length === 0` og at rækkeantallet er uændret.
5. Ved fejl: gendan fra backup trin 1 før tjenesten startes igen.

## Backup og gendannelse

- `backupDatabase(db, path)` bruger SQLite's online-backup og læser en
  konsistent snapshot under WAL uden at blokere skrivere.
- `restoreDatabase({ backupPath, targetPath, expectedCounts })`:
  1. åbner backupen skrivebeskyttet og kører `PRAGMA integrity_check`,
  2. sammenligner rækkeantal pr. tabel med forventningen,
  3. kopierer først derefter filen på plads og verificerer igen.
- `exerciseBackupRestore({ databases, backupDir, targetDir })` kører hele
  øvelsen mod flere databaser på én gang.

**Gendannelsesstrategi:** fuld backup før hver schemaændring, daglig backup i
drift, og en gendannelse der altid verificeres før tjenesten genåbner
forbindelsen. En backup uden bestået integritets- og rækkeantalstjek tages ikke
i brug.

## Tenantgrænser

1. **Repository-laget.** Hver adapter tager tenanten som første argument
   (`getForTenant`, `list`, `lease`, `consume`, `append`, …) og lægger
   `tenant_id = ?` i alle forespørgsler. Der findes ingen ubetinget læsevej i
   tjenestekoden.
2. **Database-viewet.** `openDatabase` opretter per-forbindelses (TEMP) views
   `v_approval_requests`, `v_jobs`, `v_budgets`, `v_audit_events`, der filtrerer
   på `session_context`. `db.setTenant("acme")` gør en ubetinget forespørgsel
   gennem viewet tenant-scoped; skifter man tenant, ændrer resultatet sig.
3. **Primærnøglen.** `tenant_id` indgår i PK, så en skrivning for tenant B aldrig
   kan overskrive tenant A's række.

## Adskilte databaseidentiteter

| Identitet | Fil | Domæner | Skriveret |
| --- | --- | --- | --- |
| `approvals` | `approvals.db` | godkendelser, beslutningslog | ja |
| `runtime` | `runtime.db` | jobs, budgetter | ja |
| `audit` | `audit.db` | audit | append-only |
| `credentials` | `credentials.db` | tilbagekaldelser, nødstop, udstedelser | ja (DKC-010) |
| rapportering | vilkårlig | alle (læs) | nej (`readOnly`) |

`openIdentity(name, { dataDir, readOnly })` åbner identitetens database og
eksponerer kun dens domænerepos. En skrivebeskyttet identitet afvises af både
identitetskontrollen og af SQLite. I en klynge oversættes tabellen til separate
PostgreSQL-roller med `GRANT` pr. tabel.

## Samtidighed

- `openDatabase` sætter `journal_mode = WAL` og en `busy_timeout`, så læsere
  ikke blokeres af skriveren, og en skriver venter i stedet for at fejle.
- Alle mutationer kører i `BEGIN IMMEDIATE`: skrivelåsen tages ved
  transaktionens start, så læs-ændre-skriv-forløb serialiseres.
- Jobkøen leaser i en transaktion; kun én worker får et givet job.
- Audit og beslutningslog læser den sidste hash og indsætter den nye post i
  samme transaktion, så kæden aldrig forgrenes.
- `recoverStaleLeases` genåbner leases hvis heartbeat er for gammelt, så et
  nedbrudt job ikke efterlades permanent låst.

## Integration i tjenester

- **Godkendelser:** `createApprovalService({ store: createSqliteApprovalStore({ db }), ledger: createSqliteApprovalLedger({ db, secret }) })`. Servicen kalder `load`/`save`/`claim`, og reservationen er atomisk på tværs af processer.
- **Agent-runtime:** `createAgentRuntime({ manifest, pdp, auditLog, jobStore })`. Er `jobStore` sat, gemmes taskens tilstand ved start, efter hver committet handling og ved afslutning, så en genstart kan genoptage. DKC-010 tilføjer `credentialBroker`/`killSwitch`, og `credentials/src/check.mjs` bruger `credentials`-identitetens `revocations`/`stops`/`issuances`-repos.
- **Audit-service og gateway:** adapterne `createSqliteAuditLog` og `createSqliteBudgetStore` er tilgængelige for begge tjenester. Selve omlægningen af deres nuværende in-memory-lag er **ikke** udført her; den kræver et valg mellem én global audit-kæde (audit-servicens nuværende model) og kæder pr. tenant (DKC-008-modellen).

## Kontrol

- `make persistence-test` kører adapter-, migrations-, genstart-, samtidigheds-
  og backup-testene (flere rigtige OS-processer mod samme fil).
- `make persistence-check` validerer migrationsrækkefølge, tenant-views og
  databaseidentiteter mod en ren database.

## Begrænsninger

- SQLite er en **enkelt-node**-løsning. Flere replikaer på tværs af noder
  kræver en netværksdatabase; den tilsvarende PostgreSQL-driver og RLS-politik
  er **ikke** afprøvet i dette miljø (NOT RUN). Skema og migrationer er skrevet
  som portabel SQL for at gøre den vej kort.
- `node:sqlite` er eksperimentelt i Node (≥ 22.5) og kan ændre API.
- Der er ingen ekstern KMS/HSM bag backup-kryptering; kryptering påhviler
  lagerlaget uden for dette modul.
- **Audit-service og gateway er ikke omlagt** til de holdbare adaptere i denne leverance. Adapterne findes og er testet, men tjenesternes in-memory-lag er uændret; `runtime` og `approvals` er de to integrationer der er bevist her.
