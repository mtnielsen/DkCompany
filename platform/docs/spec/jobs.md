# Genoptagelig og idempotent eksekvering (DKC-013)

Reglen: **netværksfejl og genstart må ikke skabe dobbeltændringer.**
Et job har en holdbar tilstand, en handlingsklasse og et sporbart forsøgsspor.
En retry får en ny policykontrol og en ny godkendelse, og en irreversibel
skrivning gentages aldrig blindt.

## Handlingens klasse

`runtime/src/classification.mjs` klassificerer hvert verbum:

| Klasse | Betydning | Eksempler |
| --- | --- | --- |
| `read` | Ingen mutation; kan altid gentages | `observe.read`, `diagnose`, `health` |
| `reversible-write` | Kan rulles tilbage eller gentages uden varig skade | `restart`, `scale`, `config.apply`, `rollback`, `backup` |
| `irreversible-write` | Kan ikke gøres om | `upgrade.patch`, `restore`, `migrate`, `subject.erase`, `subject.export` |

Ukendte muterende verber er `irreversible-write` (fail-safe), og en opgave med
flere handlinger arver den mest risikable klasse. `compensationFor(verb)` giver
den kendte kompensationshandling (fx `upgrade.patch` → `rollback`).

## Jobtilstandsmaskinen

`jobs/src/state.mjs` tillader kun:

```
queued ──▶ leased ──▶ running ──▶ completed
   ▲          │          │    └──▶ failed
   │          │          ├──▶ unknown ──▶ dead-letter
   │          │          └──▶ retry-scheduled ──▶ leased
   │          └──▶ dead-letter
   └────────────── redrive fra dead-letter
```

`completed`, `failed`, `dead-letter` og `cancelled` er terminale. En ulovlig
overgang afvises af `assertTransition`.

## Holdbar kø, leases og idempotency

`persistence/src/adapters/job-queue.mjs` (migration v5) giver:

- **`submit`** — dedupliker på `idempotency_key`; samme logiske job leveret to
  gange opretter ikke en ny række.
- **`lease`** — tager næste forfaldne job i en `BEGIN IMMEDIATE`-transaktion og
  hæver `lease_token` (fencing). En worker med et gammelt token kan ikke
  afslutte jobbet.
- **`heartbeat`/`markRunning`** — kræver det aktuelle `lease_token`.
- **`startAttempt`/`finishAttempt`** — skriver det sporbare forsøgsspor i
  `job_attempts` (start, slut, udfald, fejl, policy-version, approval-ID,
  execution-ID).
- **`scheduleRetry`** — sætter `retry-scheduled` og `next_attempt_at`.
- **`deadLetter`** — flytter jobbet til `job_dead_letters` med den fulde
  jobrække og en begrundelse.
- **`redrive`** — genindlæser et dead-letter-job (nulstiller forsøg).
- **`recoverStaleLeases`** — genåbner leases hvis `lease_until` er udløbet.

`TENANT_TABLES` udvider med `job_attempts` og `job_dead_letters`, så
tenant-viewene også filtrerer dem.

## Retry-politik

`jobs/src/retry.mjs` afgør efter hvert forsøg:

- **gennemfør** hvis tilstanden er `completed`,
- **retry** kun hvis handlingen ikke er irreversibel, der er forsøg tilbage, og
  fejlen er forbigående (`timeout`, `ECONNRESET`, `429`, `503`, `service
  unavailable`, `governance utilgængelig`, …),
- **escalate/dead-letter** for irreversible fejl og `unknown`,
- **dead-letter** når forsøgsgrænsen er nået eller fejlen er permanent.

Backoff er eksponentiel med jitter og loft.

## Runneren

`jobs/src/runner.mjs`:

1. leaser næste forfaldne job og markerer det `running`,
2. undersøger **før** et nyt forsøg om et tidligere forsøg på samme job står
   `pending`/`unknown`. Er det tilfældet, reconcileres det først; en
   irreversibel ændring genudføres aldrig blindt,
3. bygger en task pr. forsøg med idempotency-ID `<job-idempotency-key>:a<N>:<index>`,
4. lader hvert forsøg gå gennem den fulde runtimegrænse (A4, scope, rolle, typet
   værktøj, PDP, godkendelse, credential, intent/outcome),
5. oversætter resultatet til en jobtilstand og anvender retry-/dead-letter-politikken.

En **retry** er dermed et nyt forsøg med et nyt intent: PDP spørges igen, og en
A3-handling kræver en ny, gyldig godkendelse (`authorizationProvider`).

## Reconciliation og kompensation

`jobs/src/reconciler.mjs` afgør et `unknown` via action-journalens resolver.

- Kan sandheden afgøres, afsluttes jobbet som `resolved-succeeded`/`-failed`.
- Kan den ikke afgøres, og handlingen er **reversibel**, indsættes en
  kompensationshandling (`compensationFor`) som et nyt job der selv kører
  gennem grænsen.
- Er handlingen **irreversibel**, eskaleres jobbet til dead-letter
  (`requiresHumanReview`) — der genudføres intet.

## Kontrakter

- `contracts/job.schema.json` — jobbet: klasse, tilstand, idempotency-key,
  forsøg, lease og dead-letter.
- `contracts/job-reconciliation.schema.json` — reconciliation-resultatet.

## Kør

```bash
make jobs-check    # tilstand, klassifikation, leases, retry, dead-letter
make jobs-test     # runner, reconciliation og konformans
make persistence-check
make persistence-test
```

Verifikation skal udføres af en separat verifier; lokale tests er ikke
uafhængig verifikation.
