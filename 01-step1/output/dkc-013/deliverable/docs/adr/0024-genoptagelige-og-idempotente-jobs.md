# ADR-0024: Genoptagelige job med leases, idempotency-keys og dead-letter

- **Status:** accepteret
- **Beslutningstagere:** Platformsejerskab
- **Dato:** 2026-09-23
- **Beslutningsdrev:** DKC-013. DKC-009 indførte intent/outcome og `unknown`+reconciliation for enkelthandlinger, og DKC-008 en simpel jobrække. Men der fandtes ingen egentlig jobtilstandsmaskine, ingen leases med fencing, ingen begrænsede forsøg og ingen dead-letter-kø — og ingen klassifikation af om en handling kan gentages. En netværksfejl eller en genstart midt i et backup, upgrade eller en eksport kunne derfor i praksis føre til en ukritisk gentagelse af en irreversibel ændring.

## Kontekst og problemstilling

- **Ingen genoptagelse.** Et job der var leaset af en worker der døde, kunne blive liggende `leased` eller blive genudført uden at tage hensyn til hvad der allerede var sket.
- **Ingen idempotency-key på jobniveau.** Samme logiske job leveret to gange kunne oprette to rækker.
- **Ingen forsøgsgrænse.** En fejl kunne føre til uendelige forsøg eller til at jobbet bare forsvandt.
- **Ingen klassifikation.** Et `restore` og et `observe.read` blev behandlet ens; en irreversibel skrivning kunne blive gentaget blindt.
- **Ingen dead-letter.** Et job der ikke kunne afsluttes, havde ingen eksplicit menneskelig kø.

## Beslutningskriterier

- Et job har en eksplicit tilstandsmaskine og kan genoptages efter et nedbrud.
- Leases har et fencing-token, så en gammel worker ikke kan afslutte et job den har mistet.
- Samme idempotency-key opretter kun ét job.
- Forsøg er begrænsede; backoff er eksponentiel.
- Irreversible skrivninger gentages aldrig blindt — de reconcileres og eskaleres ellers.
- En retry får en ny policykontrol og en ny, gyldig godkendelse.
- Jobs der ikke kan afsluttes, ender i en dead-letter-kø med fuld sporbarhed.

## Overvejede muligheder

- **Genbrug DKC-008's jobstore uændret.** Den har leases, men ingen tilstandsmaskine, idempotency-key, retries eller dead-letter.
- **In-memory kø.** Taber tilstand ved genstart — præcis det problem opgaven handler om.
- **Holdbar jobkø med tilstandsmaskine, fencing-leases, idempotency-keys, klassifikation, begrænsede retries og dead-letter.** Kræver en migration og et nyt modul, men lukker alle huller.

## Beslutning

1. **Tilstandsmaskine.** `jobs/src/state.mjs` definerer de tilladte overgange mellem `queued`, `leased`, `running`, `retry-scheduled`, `unknown`, `completed`, `failed`, `dead-letter` og `cancelled`. En ulovlig overgang afvises.
2. **Holdbar kø.** Migration `0005_resumable_jobs.sql` tilføjer kolonnerne `classification`, `idempotency_key`, `max_attempts`, `next_attempt_at`, `lease_token`, `lease_until`, `dead_letter_at`, `dead_letter_reason`, `parent_id` og `compensation_for` samt tabellerne `job_attempts` og `job_dead_letters`. `persistence/src/adapters/job-queue.mjs` implementerer `submit` (idempotent på `idempotency_key`), `lease`, `heartbeat`, `startAttempt`/`finishAttempt`, `scheduleRetry`, `deadLetter`, `redrive` og `recoverStaleLeases`.
3. **Fencing-leases.** Hver lease hæver `lease_token`; `heartbeat` og `markRunning` kræver det aktuelle token. `recoverStaleLeases` genåbner en udløbet lease, så en død worker ikke låser jobbet.
4. **Handlingsklassifikation.** `runtime/src/classification.mjs` udvides med `read`, `reversible-write` og `irreversible-write`. Ukendte muterende verber er irreversible (fail-safe), og en blandet opgave arver den mest risikable klasse.
5. **Begrænsede forsøg og dead-letter.** `jobs/src/retry.mjs` afgør efter hvert forsøg om jobbet skal gennemføres, forsøges igen (kun forbigående fejl, kun ikke-irreversible, kun inden for grænsen) eller flyttes til dead-letter. Backoff er eksponentiel med jitter.
6. **Runner med ny policy pr. forsøg.** `jobs/src/runner.mjs` leaser et job, gennemgår **før** et nyt forsøg om et tidligere forsøg står `pending`/`unknown` (og reconcilerer i stedet for at genudføre), bygger en task pr. forsøg med et nyt idempotency-ID (`<job>:a<N>`), og lader hvert forsøg gå gennem den fulde runtimegrænse. En retry får dermed en ny PDP-beslutning og en ny godkendelse.
7. **Reconciliation og kompensation.** `jobs/src/reconciler.mjs` afgør et `unknown` via action-journalens resolver. En reversibel handling kan kompenseres (`compensationFor`), og kompensationen indsættes som et nyt job der selv kører gennem grænsen. Et irreversibelt `unknown` eskaleres til dead-letter.
8. **Kontrakter.** `contracts/job.schema.json` og `contracts/job-reconciliation.schema.json` beskriver jobbet og reconciliation-resultatet.

## Konsekvenser

- **Positive:** Genstart mister ikke jobtilstand; et sporbart forsøgsspor viser hvad der skete. Samme job leveret to gange udfører ikke en irreversibel ændring to gange. Retries er sikre og bruger ny policy/godkendelse. Irreversible unknowns eskaleres frem for at blive gentaget.
- **Negative:** Endnu en migration (v5) og et nyt modul. Jobs-tabellen deles med DKC-008's simple jobstore, så begge adaptere skal respektere kolonnedefaults.
- **Neutrale:** `runtime/src/runtime.mjs` eksponerer nu `actionJournal` og `jobStore`, så runneren kan bruge det samme intent-spor. `jobs/` er et selvstændigt modul uden ændringer i `00-core/`.

## Fordele og ulemper ved mulighederne

| Mulighed | Fordele | Ulemper |
| --- | --- | --- |
| Genbrug DKC-008-jobstore | Lille ændring | Ingen tilstandsmaskine, idempotency, retries eller dead-letter |
| In-memory kø | Simpel | Taber tilstand ved genstart |
| Holdbar kø med klassifikation, leases, retries og dead-letter | Lukker alle acceptkrav | Ny migration og nyt modul |

## Mere information

- [`docs/spec/jobs.md`](../spec/jobs.md)
- [`jobs/`](../../jobs), [`persistence/src/adapters/job-queue.mjs`](../../persistence/src/adapters/job-queue.mjs), [`persistence/migrations/0005_resumable_jobs.sql`](../../persistence/migrations/0005_resumable_jobs.sql)
- [`contracts/job.schema.json`](../../contracts/job.schema.json), [`contracts/job-reconciliation.schema.json`](../../contracts/job-reconciliation.schema.json)
- [ADR-0005](0005-git-er-eneste-aendringskanal.md), [ADR-0018](0018-stram-policy-scope-og-evidenkontrol.md), [ADR-0019](0019-holdbar-tilstand-og-migrationer.md), [ADR-0021](0021-holdbar-audit-og-fail-closed.md)
