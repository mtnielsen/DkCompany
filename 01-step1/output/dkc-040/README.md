# DKC-040 — Gør beskeder og jobkø robuste på tværs af servere

Kumulativ overlay oven på DKC-001..DKC-060. Lægges med `./apply.sh <checkout>/00-core`.

- **Reviewets base:** `5f9fa73`
- **Undersøgt checkout:** `83ad91a`
- **Forudsætninger:** DKC-013 og DKC-038 — verificeret til stede i den anvendte
  stak. Overlayen kæder `dkc-038/apply.sh` (→ `dkc-060/apply.sh` →
  `dkc-066/apply.sh` → … → DKC-001).
- **Node:** v22.22.1

## Implementeret adfærd

DKC-040 gør beskedudveksling mellem tjenester holdbar på tværs af servere.

1. **Transaktionel outbox** (`jobs/src/outbox.mjs`,
   `persistence/migrations/0011_messaging_outbox.sql`): begivenheder skrives i
   *samme* transaktion som den forretningsmæssige ændring. `append` deduplikerer
   på idempotency-key, og en version pr. ressource opdateres atomisk. Rulles
   ændringen tilbage, forsvinder begivenheden også.
2. **Publisher confirms:** `claimBatch` tager en lease med et monotont
   `lease_token`; kun når `publisher(event)` bekræfter, markeres begivenheden
   `confirmed`. En fejlet udgivelse forbliver synligt `pending` med backoff og
   `last_error` — ingen falsk succes. En gammel udgiver med overtaget lease kan
   ikke bekræfte.
3. **Deduplikerende inbox med rækkefølge** (`jobs/src/inbox.mjs`):
   `(tenant, consumer, event_id)` er unik. Rækken skrives `received` før
   sideeffekten og `processed` efter; ressource-versionen opdateres først ved
   ack. En forsinket begivenhed (version ≤ behandlet) afvises som `skipped`, og
   et hul i versionsrækken udsættes (`deferred`).
4. **Reconciliation i stedet for blind genudførelse:** et genfundet
   `processing`-spor afklares gennem `reconcile`, eller flyttes til dead-letter.
   En irreversibel begivenhed genudføres aldrig blindt.
5. **Singletonjobs med fencing** (`jobs/src/singleton.mjs`): hver overtagelse
   hæver `fencing_token`; `isValid`/`heartbeat` afviser et gammelt token.
6. **Synlig backpressure og poison-isolation** (`jobs/src/health.mjs`):
   `health.snapshot` læser faktisk backlog/alder og svarer `unknown` (aldrig
   grøn) hvis lageret ikke kan læses. Dead-letter-køen er tenantafgrænset, så én
   kunds poison message ikke blokerer de øvrige.
7. **Topologi og kontrakter** (`jobs/messaging.json`,
   `contracts/messaging-topology.schema.json`, `contracts/outbox-record.schema.json`):
   holdbar broker med quorum og confirms, ærlig `at-least-once`-garanti og
   maskinelt håndhævede beslutninger i `jobs/src/topology.mjs` +
   `conformance/src/messaging.mjs`.

Leveringsgarantien er **at-least-once**. Exactly-once påstås ikke.

## Ændrede og nye filer

Se `evidence/deliverable-files.txt` (33 filer). Hovedgrupper:

- `jobs/src/{events,outbox,inbox,singleton,health,messaging,topology,messaging-cli}.mjs`,
  `jobs/test/messaging.test.mjs`, `jobs/messaging.json`.
- `persistence/migrations/0011_messaging_outbox.sql`, `persistence/src/db.mjs`,
  `persistence/test/migrations.test.mjs` (v11 + tenant-views).
- `contracts/messaging-topology.schema.json`, `contracts/outbox-record.schema.json`
  + to eksempler; `conformance/src/messaging.mjs`, `conformance/test/messaging-conformance.test.mjs`,
  `conformance/src/schemas.mjs`, `conformance/src/validate-schemas.mjs`.
- `Makefile` (`messaging-check`/`messaging-test` + `ci`),
  `tools/baseline/registry.mjs` (komponent `messaging` + 3 checks).
- `release/matrix/test-matrix.json` (1.14.0, `REQ-MSG-001`),
  `release/matrix/threats.json` (2 trusler), `docs/testing/test-matrix.md`,
  `docs/security/threat-model.md`.
- `docs/adr/0045-…`, `docs/adr/README.md`, `docs/spec/messaging.md`,
  `docs/spec/README.md`, `docs/runbooks/queue-incident.md`,
  `docs/status/implementation-matrix.md`.

## Testkommandoer og resultater

| Kommando | Resultat |
|---|---|
| `make validate` | PASS (beskedtopologi + outbox-post valideret) |
| `make lint` | PASS |
| `make messaging-check` | PASS |
| `make messaging-test` | PASS (13 outbox/inbox-tests + 10 konformanstests) |
| `make persistence-check` | PASS (11 migrationer: v1..v11) |
| `make persistence-test` | PASS (56 tests) |
| `make jobs-check` | PASS |
| `make jobs-test` | PASS (27 + 4 tests) |
| `make test` | PASS (228 tests) |
| `make release-check` | PASS (37 krav, matrixversion 1.14.0) |
| `make release-test` | PASS |
| `make supply-chain-check` | PASS |
| `make infrastructure-check` | PASS |
| `make infrastructure-test` | PASS |
| `make baseline` | 108 PASS / 1 FAIL / 29 NOT RUN (138 checks) |

Den ene FAIL er den forud eksisterende `changelog-check` (manglende DCO
sign-off, inkl. `83ad91a`). Den er hverken skjult eller ændret. `make baseline`
ændrede 30 sporede fixturefiler under `modules/*/conformance`; de er restaureret
fra snapshot efter kørslen, så de ikke indgår i leverancen.

## Acceptkriterier

| Kriterium | Status | Bevis |
|---|---|---|
| Duplikat, forsinket og ombyttet event giver ikke utilsigtede dobbeltændringer | **PASS** | `jobs/test/messaging.test.mjs`: idempotency-dedup, `skipped` ved forsinket version, `deferred` ved hul; kun én sideeffekt |
| Worker dør efter sideeffekt før ack: systemet reconciler uden blind genudførelse | **PASS** | Testen «nedbrud efter sideeffekt før ack»: uden reconciliation → dead-letter, med reconciliation → `reconciled` uden ny sideeffekt |
| Mistet lease forhindrer en gammel worker i at fortsætte | **PASS** | Outbox-fencing (`lease_token`) og singleton-fencing (`fencing_token`); gamle tokens afvises |
| Kønedbrud giver synlig køtilstand og ingen falsk succes | **PASS** | `makeQueueHealth`: fejlet udgivelse forbliver `pending`; ulæseligt lager giver `unknown`, ikke grøn |
| Poison message blokerer ikke alle kunder | **PASS** | `event_dead_letters` er tenantafgrænset; anden tenant behandles upåvirket |
| Holdbar kø med publisher confirms og consumer-acks | **PASS** (kontrakt/persistens) / **NOT RUN** (rigtig broker) | Outbox/inbox-protokollen er efterprøvet mod den rigtige SQLite-persistens; en faktisk broker er `integration-message-broker` (NOT RUN) |
| Logisk rækkefølge pr. ressource, ingen generel exactly-once-påstand | **PASS** | `ordering` pr. ressource i topologien; `deliveryGuarantee: at-least-once` håndhæves |

## Restgrænser

- Ingen kørende NATS/AMQP/Kafka-broker i dette miljø.
  `integration-message-broker` er registreret som `external: true` og NOT RUN;
  en faktisk brokerbekræftelse og målt leverance kræver uafhængig
  driftsverifikation.
- `publisher`-grænsen er efterprøvet med en testdobbelt; selve
  brokerintegrationen er ikke målt.
- `changelog-check` fejler fortsat (forud eksisterende, DCO sign-off mangler).
- Overlayen erklærer ikke produktionsparathed; kun lokale kontrakt-, persistens-
  og konformanstests er kørt.
