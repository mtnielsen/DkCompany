# Fejl- og katastrofetest (chaos)

DKC-051 automatiserer fejlmatrixen fra arkitekturtillægget og beviser
platformens adfærd ved samtidige fejl og kompromitterede agentrettigheder.
Matrixen ligger i [`chaos/failure-matrix.json`](../../chaos/failure-matrix.json)
og valideres mod
[`contracts/failure-matrix.schema.json`](../../contracts/failure-matrix.schema.json).

## Scenarier

Hvert scenarie erklærer **failure scope**, **forventet dataudfald**, **RPO/RTO**,
**tilladt autonomi** og en konkret **probe**. Matrixen dækker:

| Scenarie | Failure scope | Probe |
| --- | --- | --- |
| `ha-host-loss` | single-host | `runFailoverDrill` (DKC-038) |
| `ha-quorum-loss` | quorum | `assessQuorum` (DKC-038) |
| `network-partition` | network-partition | `runDatabaseFailoverDrill` (DKC-039) |
| `database-failover` | database | `runDatabaseFailoverDrill` (DKC-039) |
| `storage-disk-full` | storage | `createStorageCluster` + kapacitetsalarm (DKC-041) |
| `storage-corruption` | storage | `runStorageDrill` (DKC-041) |
| `queue-replay` | queue | outbox/inbox (DKC-040) |
| `control-plane-loss` | control-plane | `createSafeFallback` (DKC-046) |
| `site-restore` | site | `runDisasterRecoveryDrill` (DKC-042) |
| `dedup-prune` | deduplication | `createDedupStore.prune` (DKC-043) |
| `kms-unavailability` | keys | storage-keyring fail-closed (DKC-041/048) |
| `immutable-bypass` | immutable | `createImmutableEnforcer` (DKC-048) |
| `healing-storm` | control-plane | `createRemediationBudget` (DKC-046) |

## Invarianter

- **Ingen split-brain**: højst én autoritativ skriver pr. partition.
- **Ingen tabte kvitterede writes**: alle commitkvitteringer findes efter failover.
- **Immutable-bypass afvises og logges**: hvert forsøg nægtes og skrives i audit.
- **Healingstorm er afgrænset**: et fælles forsøgs-/fejl-/ændringsbudget stopper
  stormen og eskalerer til et menneske.
- **Kan gentages fra ren installation**: kun syntetiske data og midlertidige
  filer; intet kundedata.

## Kørsel

| Kommando | Formål |
| --- | --- |
| `make chaos-run` | Kør hele matrixen og skriv `docs/continuity/chaos-report.md` + `chaos/report/chaos-report.json` |
| `make chaos-check` | Validér matrix, prober og renderede artefakter |
| `make chaos-test` | Kør matrix-, probe- og konformanstestene |
| `make chaos-report` | Skriv den kørte rapport til stdout |
| `make chaos-live` | Kør matrixen i en isoleret, levende stagingklynge — **NOT RUN** (ekstern) |

Resultatet bærer `measured: false`. En målt fejløvelse på en levende
stagingklynge er beskrevet i
[`docs/continuity/chaos-live.md`](../continuity/chaos-live.md) og er en ekstern
integration.
