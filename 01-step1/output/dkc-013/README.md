# DKC-013 — Gør eksekvering genoptagelig og idempotent (leverance)

Implementering af **DKC-013** for `mtnielsen/DkCompany`. Bygger på
DKC-001 .. DKC-011 og DKC-055. `00-core/` er fortsat **ikke ændret**; alt ligger
under `01-step1/output/dkc-013/`.

## Forudsætninger og valg

DKC-013 afhænger formelt af **DKC-005** (serververificerede godkendelser),
**DKC-008** (holdbar tilstand og migrationer) og **DKC-009** (holdbar
audit/intent-outcome). Den lægges oven på hele den nuværende stak via
`dkc-011/apply.sh`, som kæder `dkc-010/apply.sh` og dermed DKC-001 .. DKC-010 +
DKC-055. DKC-011 er valgt som forudsætning, fordi den er den aktuelle stak-top
og deler runtime/classification med jobklassifikationen.

## Hvad der er implementeret

1. **Holdbar job-state machine.** `jobs/src/state.mjs` definerer de tilladte
   overgange mellem `queued`, `leased`, `running`, `retry-scheduled`, `unknown`,
   `completed`, `failed`, `dead-letter` og `cancelled`; `assertTransition`
   afviser ulovlige overgange. `persistence/migrations/0005_resumable_jobs.sql`
   tilføjer kolonnerne `classification`, `idempotency_key`, `max_attempts`,
   `next_attempt_at`, `lease_token`, `lease_until`, `dead_letter_*`, `parent_id`
   og `compensation_for` samt `job_attempts` og `job_dead_letters`.

2. **Leases med fencing-token og idempotency-keys.**
   `persistence/src/adapters/job-queue.mjs` implementerer `submit` (dedup på
   `idempotency_key`), `lease` (atomisk `BEGIN IMMEDIATE`, `lease_token`+1),
   `heartbeat`/`markRunning` (kræver aktuelt token), `recoverStaleLeases`,
   `startAttempt`/`finishAttempt` (sporbart forsøgsspor), `scheduleRetry`,
   `deadLetter` og `redrive`. DKC-008's `createSqliteJobStore` bevares uændret.

3. **Handlingsklassifikation.** `runtime/src/classification.mjs` udvides med
   `read`, `reversible-write` og `irreversible-write`, `classifyVerb`,
   `classifyActions` (mest risikable klasse vinder) og `compensationFor`. Ukendte
   muterende verber er irreversible (fail-safe).

4. **Begrænsede retries og dead-letter.** `jobs/src/retry.mjs` afgør efter hvert
   forsøg om jobbet skal gennemføres, forsøges igen (kun forbigående fejl, kun
   ikke-irreversible, kun inden for `maxAttempts`) eller flyttes til
   dead-letter. Backoff er eksponentiel med jitter.

5. **Runner med ny policy/godkendelse pr. forsøg.** `jobs/src/runner.mjs` leaser
   et job, reconcilerer et tidligere `pending`/`unknown` forsøg **før** et nyt,
   bygger en task pr. forsøg med et nyt idempotency-ID (`<job>:a<N>`), og lader
   hvert forsøg gå gennem den fulde runtimegrænse. Dermed får en retry en ny
   PDP-beslutning og en ny, gyldig godkendelse.

6. **Reconciliation og kompensation.** `jobs/src/reconciler.mjs` afgør et
   `unknown` via action-journalens resolver. En reversibel handling kompenseres
   hvor muligt (kompensationsjobbet kører selv gennem grænsen); et irreversibelt
   `unknown` eskaleres til dead-letter med `requiresHumanReview`.

7. **Kontrakter, check og docs.** Nye kontrakter `job` og `job-reconciliation` +
   eksempler; `make jobs-check`/`jobs-test` og komponenten `jobs` er registreret.
   ADR-0024 og `docs/spec/jobs.md` dokumenterer designet; indeks og
   `docs/spec/persistence.md` er opdateret.

## Ændrede/nye filer (overlay, relativt til `00-core/`)

```
jobs/package.json                              (ny)
jobs/src/state.mjs                             (ny: jobtilstandsmaskine)
jobs/src/retry.mjs                             (ny: retry-politik + dead-letter)
jobs/src/classification.mjs                    (ny: jobklassifikation)
jobs/src/queue.mjs                             (ny: holdbar kø-facade)
jobs/src/runner.mjs                            (ny: worker)
jobs/src/reconciler.mjs                        (ny: reconciliation + kompensation)
jobs/src/index.mjs, check.mjs                  (ny)
jobs/test/state-retry.test.mjs, runner.test.mjs, reconciler.test.mjs (ny)
persistence/migrations/0005_resumable_jobs.sql (ny)
persistence/src/adapters/job-queue.mjs         (ny: holdbar jobkø)
persistence/src/db.mjs, index.mjs              (+ 2 tenant-views, eksport)
persistence/test/migrations.test.mjs           (+ v5)
runtime/src/classification.mjs                 (+ handlingsklasser/kompensation)
runtime/src/runtime.mjs                        (+ actionJournal/jobStore eksponeret)
conformance/test/jobs-conformance.test.mjs     (ny: 4 accepttests)
conformance/src/validate-schemas.mjs           (+ job-eksempler)
contracts/job.schema.json, job-reconciliation.schema.json (ny)
contracts/examples/job.example.json, job-reconciliation.example.json (ny)
Makefile                                       (+ jobs-check/-test, + i ci)
tools/baseline/registry.mjs                    (+ 2 checks, komponent jobs)
docs/adr/0024-genoptagelige-og-idempotente-jobs.md (ny ADR)
docs/adr/README.md, docs/spec/README.md, docs/spec/persistence.md (opdateret)
docs/spec/jobs.md                              (ny spec)
docs/status/implementation-matrix.md           (regenereret)
```

## Testkommandoer og resultater (checkout `83ad91a` + DKC-001..011 + DKC-055, Node v22.22.1)

| Kommando | Resultat |
| --- | --- |
| `make jobs-check` | **OK** (klasser, tilstandsmaskine, leases, retry, dead-letter, redrive, tenant-isolation) |
| `make jobs-test` | **18 pass / 0 fail** (11 tilstand/retry + 3 runner + 3 reconciliation + 4 konformans) |
| `make persistence-check` | **OK** (5 migrationer, 4 databaseidentiteter, 11 tenant-views) |
| `make persistence-test` | **42 pass / 0 fail** |
| `make runtime-test` | **84 pass / 0 fail** |
| `make boundary-test` | **21 pass / 0 fail** |
| `make test` (conformance) | **89 pass / 0 fail** (inkl. 4 nye DKC-013-accepttests) |
| `make tool-boundary-test` | **33 pass / 0 fail** (ingen regression) |
| `make agent-registry-test` | **33 pass / 0 fail** |
| `make credentials-test` | alle blokke **pass / 0 fail** |
| `make validate` | **33 skemaer / 32 eksempler** valideret (inkl. `job`) |
| `make lint` | **OK** (195 JSON-filer, 500 filer) |
| `make baseline` | **56 pass, 1 fail (DCO), 0 error, 9 not run af 66**; både `jobs-test` og `jobs-check` **PASS** |

## Acceptkriterier

| Krav | Status | Bevis |
| --- | --- | --- |
| Genstart midt i backup, upgrade eller eksport giver sporbart slutresultat | **PASS** | `conformance/test/jobs-conformance.test.mjs` (1), `jobs/test/runner.test.mjs` (genstart + forsøgsspor) |
| Samme job leveret flere gange udfører ikke irreversible ændringer flere gange | **PASS** | `jobs-conformance.test.mjs` (2), `jobs/test/runner.test.mjs` (idempotency-key + replay) |
| Retry bruger ny policykontrol og gyldig godkendelse | **PASS** | `jobs-conformance.test.mjs` (3), `jobs/test/runner.test.mjs` (PDP pr. forsøg + nyt executionId) |
| Et irreversibelt unknown outcome eskaleres frem for blind retry | **PASS** | `jobs-conformance.test.mjs` (4), `jobs/test/reconciler.test.mjs` (unknown → dead-letter, pending intent reconcileres) |

## Resterende begrænsninger

- **Ingen rigtig klynge/proces-failover.** Genstart er bevist ved at lukke og
  genåbne SQLite-forbindelsen og genåbne leases in-process; tværnodepropagering
  og en rigtig worker-pod er **NOT RUN**.
- **Backoff-planlægning kræver en scheduler.** Runneren kører på kommando
  (`runOnce`/`runUntilIdle`); en kørende scheduler/cron er en driftsopsætning og
  er **NOT RUN**.
- **Kompensation er kun defineret hvor der findes en kendt invers.** Handlinger
  uden kompensation eskalerede til dead-letter.
- **Kompensationsjobbet kører gennem grænsen, men er ikke afprøvet mod en
  ekstern ændring** her; testen beviser at det indsættes med korrekt
  klassifikation og payload.
- **DKC-001's `changelog-check`-fejl består** (4 commits mangler DCO sign-off).
- Overlay, ikke committed kode: `00-core/` er urørt.

## Til uafhængig gennemgang

- **Reviewets base:** `5f9fa73457d22583b9948611d5cc3afffec4ae38` (5f9fa73).
- **Undersøgt checkout:** `83ad91a`.
- **Forudsætnings-overlays:** DKC-001 .. DKC-011 samt DKC-055 (lægges via
  `apply.sh`, som kæder `dkc-011/apply.sh`).
- **Denne leverance:** `01-step1/output/dkc-013/` (33 filer i `deliverable/`,
  SHA256 i `OVERLAY-MANIFEST.txt`).
- Uafhængig verifikation, live-failover og menneskelig release-godkendelse er
  separate handlinger og er **ikke** udført her.
