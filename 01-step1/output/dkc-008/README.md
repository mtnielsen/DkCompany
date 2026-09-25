# DKC-008 — Indfør holdbar tilstand og migrationer (leverance)

Implementering af **DKC-008** for `mtnielsen/DkCompany`. Bygger på DKC-001,
DKC-002, DKC-003, DKC-004, DKC-005, DKC-006 og DKC-007. `00-core/` er fortsat
**ikke ændret**; alt ligger under `01-step1/output/dkc-008/`.

## Hvad der er implementeret

1. **Persistenslag på en rigtig, filbaseret database.**
   `persistence/src/db.mjs` åbner SQLite via `node:sqlite` med WAL,
   `busy_timeout`, foreign keys og eksplicitte `BEGIN IMMEDIATE`-transaktioner
   (indlejrede kald bruger savepoints). Det er en rigtig, holdbar database — ikke
   en in-memory-erstatning.

2. **Versionsstyrede databasemigrationer.**
   `persistence/migrations/0001_initial.sql` og `0002_upgrade_and_hardening.sql`
   anvendes i rækkefølge, én ad gangen, i en transaktion, og registreres med
   SHA-256 i `schema_migrations` (`persistence/src/migrations.mjs`). En ændret
   anvendt migration afvises (fail-closed), og `apply({ toVersion })` bruges til
   at afprøve opgraderingsforløb (v1 → v2).

3. **Holdbare adaptere for godkendelser, jobs, budgetter og audit.**
   - `createSqliteApprovalStore` — godkendelseslager med atomisk reservation
     (`INSERT OR IGNORE` i `BEGIN IMMEDIATE`).
   - `createSqliteApprovalLedger` — append-only beslutningslog med valgfri HMAC
     og fail-closed verifikation ved indlæsning.
   - `createSqliteJobStore` — jobkø med leases, heartbeat, `saveState` og
     `recoverStaleLeases` til genoptagelse efter et nedbrud.
   - `createSqliteBudgetStore` — atomiske tællere med et hårdt loft, der ikke kan
     overskrides samtidigt.
   - `createSqliteAuditLog` — append-only audit med én hash-kæde pr. tenant.

4. **Adskilte databaseidentiteter.** `persistence/src/identities.mjs` åbner
   `approvals.db`, `runtime.db` og `audit.db` som separate identiteter og
   eksponerer kun deres domænerepos. En skrivebeskyttet rapporteringsidentitet
   åbner forbindelsen med `readOnly`, hvilket SQLite selv håndhæver.

5. **Tenantgrænser i databasen.** Alle tabeller har `tenant_id` som del af den
   primære nøgle, repositories tager tenanten som første argument, og
   `openDatabase` opretter per-forbindelses tenant-views
   (`v_approval_requests`, `v_jobs`, `v_budgets`, `v_audit_events`), der filtrerer
   på en `session_context`. En forkert tenant får hverken en række gennem
   repository-laget eller gennem viewet.

6. **Backup og gendannelse.** `persistence/src/backup.mjs` bruger SQLite's
   online-backup (konsistent snapshot under WAL), integrritetstjekker og
   rækkeantal-verificerer før gendannelsen tages i brug. `exerciseBackupRestore`
   kører øvelsen mod flere databaser.

7. **Integration i den rigtige runtime.** `runtime/src/runtime.mjs` tager nu en
   valgfri `jobStore`. Er den sat, gemmes taskens tilstand ved start, efter hver
   committet handling og ved afslutning — så et genstart kan genoptage.
   `createApprovalService` kan bruge SQLite-lageret og -loggen uden
   kontraktændringer.

8. **Kontrol, kontrakter og docs.** `make persistence-test` og
   `make persistence-check` er nye og registreret i `tools/baseline/registry.mjs`
   (komponent `persistence`). En conformance-test
   (`conformance/test/persistence-conformance.test.mjs`) spejler de fire
   acceptkriterier i `make test`. ADR-0019 og `docs/spec/persistence.md`
   dokumenterer opgraderings- og gendannelsesstrategien.

## Ændrede/nye filer (overlay, relativt til `00-core/`)

```
persistence/src/db.mjs                    (ny: SQLite-wrapper, transaktioner, tenant-views)
persistence/src/migrations.mjs            (ny: migrations-runner med checksums)
persistence/src/identities.mjs            (ny: adskilte databaseidentiteter)
persistence/src/backup.mjs                (ny: backup + verificeret gendannelse)
persistence/src/check.mjs                 (ny: fokuseret kontrol)
persistence/src/index.mjs                 (ny: samlet indgang)
persistence/src/adapters/approvals.mjs    (ny: holdbart godkendelseslager)
persistence/src/adapters/approval-ledger.mjs (ny: holdbar beslutningslog)
persistence/src/adapters/jobs.mjs         (ny: holdbar jobkø med leases)
persistence/src/adapters/budgets.mjs      (ny: holdbare budgetter med loft)
persistence/src/adapters/audit.mjs        (ny: holdbar audit med hash-kæde)
persistence/migrations/0001_initial.sql   (ny: baseline-skema)
persistence/migrations/0002_upgrade_and_hardening.sql (ny: opgradering v1 → v2)
persistence/package.json                  (ny)
persistence/test/*.test.mjs               (ny: 8 testfiler, 25 tests)
persistence/fixtures/persistence-worker.mjs (ny: child-process worker)
runtime/src/runtime.mjs                   (+ valgfri jobStore, holdbar jobtilstand)
conformance/test/persistence-conformance.test.mjs (ny: 4 accept-tests)
tools/baseline/registry.mjs               (+ persistence-test, persistence-check, komponent)
Makefile                                  (+ persistence-test, persistence-check, + i ci)
docs/adr/0019-holdbar-tilstand-og-migrationer.md (ny ADR)
docs/spec/persistence.md                  (ny spec)
docs/adr/README.md, docs/spec/README.md   (indeks)
docs/status/implementation-matrix.md      (regenereret)
```

## Testkommandoer og resultater (checkout `83ad91a` + DKC-001..007, Node v22.22.1)

| Kommando | Resultat |
| --- | --- |
| `make persistence-test` | **25 pass / 0 fail** (adaptere, migrationer, genstart, samtidighed, backup, runtime) |
| `make persistence-check` | **OK** (2 migrationer, 3 databaseidentiteter, 5 tenant-views) |
| `make runtime-test` | **46 pass / 0 fail** |
| `make approval-test` | **11 pass / 0 fail** + **20 pass / 0 fail** |
| `make test` (conformance) | **62 pass / 0 fail** (inkl. 4 nye persistence-tests) |
| `make validate` | 23 skemaer, 22 eksempler, 5 arkitektur/identitet, 1 godkendelse, 1 tenant |
| `make boundary-test` | **21 pass / 0 fail** |
| `make agent-conformance-test` | **10 pass / 0 fail** |
| `make architecture-test` | **10 pass / 0 fail** |
| `make tenant-test` | 20/0 + 8/0 + 13/0 + 26/0 + 8/0 + 8/0 + 11/0 |
| `make baseline-test` | **8 pass / 0 fail** |
| `make lint` | OK |
| `make baseline` | 56 checks: **46 pass, 1 fail, 0 error, 9 NOT RUN**; `persistence-test` og `persistence-check` **PASS** |

Evidens: `evidence/logs/*.log` og `evidence/baseline/` (JSON + log). Den ene
baseline-fejl er fortsat `changelog-check` (manglende DCO sign-off, DKC-001-fundet).
Baselinekørslen ændrede de sporede `modules/*/conformance`-fixtures
(ikke-idempotente `*-evidence`-generatorer); de er nulstillet efter kørslen.

## Acceptkriterier

| Kriterium | Status | Bevis |
| --- | --- | --- |
| Genstart mister ingen committed godkendelser eller jobtilstand | **PASS** | `persistence/test/restart.test.mjs` (godkendelse, claim, job-state, budget, audit efter luk/genåbn), `approval-service-restart.test.mjs` (rigtig service mod SQLite), `runtime-jobs.test.mjs` (agent-task gemt før/efter handling) |
| Samtidige writes bevarer konsistens | **PASS** | `persistence/test/concurrency.test.mjs`: 4 processer × 25 audit-poster giver én kæde; 6 processer mod ét budgetloft overskrider ikke; 8 processer → præcis én claim-vinder; 5 workers udfører 30 jobs præcis én gang |
| En forkert tenant kan ikke hente data via databaseadgangen | **PASS** | `adapters.test.mjs` (`getForTenant("globex", acme-række) === null`, tenant-viewet returnerer 0, claim afvises), `conformance/test/persistence-conformance.test.mjs` |
| Opgradering fra forrige schema og gendannelse fra backup er afprøvet | **PASS** | `migrations.test.mjs` (v1 → v2 bevarer rækker og tilføjer kolonner), `backup.test.mjs` (backup, ødelæggelse, verificeret restore; afvisning ved mismatch), `exerciseBackupRestore` |

## Resterende begrænsninger

- **SQLite er en enkelt-node-løsning.** Samtidigheden er bevist med flere
  OS-processer mod samme fil, men replikaer på tværs af noder kræver en
  netværksdatabase. Skema, migrationer og adapterkontrakter er portable, men den
  tilsvarende **PostgreSQL-driver og RLS-politik er ikke afprøvet** her
  (NOT RUN). Produktionens `GRANT`-opsætning pr. databaseidentitet er heller
  ikke afprøvet mod en levende PostgreSQL.
- **`node:sqlite` er eksperimentelt** i Node (≥ 22.5) og kan ændre API.
- **Godkendelsesservicens in-memory-map indeholder alle tenants** efter
  indlæsning; adgangskontrollen sker ved API-laget og i database-repositoryet.
  Selve `service.get(id)` er ikke tenant-scoped (uændret fra DKC-006); DB-vejen
  er.
- **Jobpersistens i runtimen er best-effort:** en fejl i `jobStore` ignoreres, så
  den ikke ændrer selve eksekveringen. Testene dækker den normale vej.
- **Kryptering af backups** påhviler lagerlaget uden for dette modul.
- **Audit-service og gateway er ikke omlagt** til de holdbare adaptere her;
  `runtime` og `approvals` er de to integrationer der er bevist. Adapterne er
  tilgængelige og testede.
- **DKC-055** ("én rolle pr. agent") er fortsat **ikke** implementeret og er
  stadig en udestående blokering for DKC-005's rolle-separationsscope.
- **DKC-001's `changelog-check`-fejl består** (4 commits mangler DCO sign-off).
- Overlay, ikke committed kode: `00-core/` er urørt.

## Til uafhængig gennemgang

- **Reviewets base:** `5f9fa73457d22583b9948611d5cc3afffec4ae38` (5f9fa73).
- **Undersøgt checkout:** `83ad91a`.
- **Forudsætnings-overlays:** DKC-001, DKC-002, DKC-003, DKC-004, DKC-005,
  DKC-006, DKC-007 (lægges via `apply.sh`, som kæder `dkc-007/apply.sh`).
- **Denne leverance:** `01-step1/output/dkc-008/` (31 filer i `deliverable/`,
  SHA256 i `OVERLAY-MANIFEST.txt`).
- Uafhængig verifikation, live-integrationer (rigtig PostgreSQL/klynge) og
  menneskelig release-godkendelse er separate handlinger og er **ikke** udført
  her.
