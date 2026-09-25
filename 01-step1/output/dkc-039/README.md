# DKC-039 — Implementér database-HA med fencing og konsistent failover

Kumulativ overlay oven på DKC-001..DKC-060. Lægges med `./apply.sh <checkout>/00-core`.

- **Reviewets base:** `5f9fa73`
- **Undersøgt checkout:** `83ad91a`
- **Forudsætninger:** DKC-008, DKC-037 og DKC-038 — verificeret til stede i den
  anvendte stak. Overlayen kæder `dkc-040/apply.sh` (→ `dkc-038/apply.sh` →
  `dkc-060/apply.sh` → … → DKC-001).
- **Node:** v22.22.1

## Implementeret adfærd

DKC-039 gør databasen HA med en maskinelt kontrolleret replikeringskontrakt.

1. **Operator og topologi** (`persistence/ha-plan.json`,
   `contracts/database-ha.schema.json`): en vedligeholdt databaseoperator og
   failover-controller (CloudNativePG) på PostgreSQL, tre stemmeberettigede
   instanser (primary + to sync-replikaer) i tre fejldomæner, quorum = flertal,
   plus en ikke-stemmeberettiget async-læser.
2. **Sync-quorum og durability** (`durability` + `persistence/src/replication.mjs`):
   kritiske writes bruger `synchronous_commit=remote_apply` og bekræftes først,
   når mindst `minSyncReplicasForWrites` sync-replikaer har kvitteret. Ellers
   rulles rækken tilbage, og writen afvises (`sync-replica-loss`). Der er ingen
   tavs async-overgang, og async-replikaer tæller ikke som ack.
3. **Fencing før promotion:** den tidligere primary fences med et monotont
   `fenceEpoch`; `promote` kræver fence, en sync-replika som kandidat og at
   kandidaten har alle bekræftede `commit_receipts`. Usikker promotion afvises.
4. **Read-consistency pr. flow:** godkendelser er `primary-only` med
   staleness-budget 0; policy og audit kræver primary eller sync-committed;
   rapportering må læse en replica inden for et bundet budget. `canServeRead`
   håndhæver det, og `database-ha.example.json` afvises hvis godkendelser læses
   fra en replica.
5. **WAL, PITR og failback/rejoin:** WAL arkiveres krypteret med PITR og en
   base-backup-plan; den tidligere primary skal fences, rejoin'e (`pg-rewind`),
   indhente loggen og verificere checksums før promotion.
6. **Renderede manifester** (`gitops/manifests/db-ha/`, 5 filer):
   CloudNativePG-`Cluster` med synkron replikering, `ScheduledBackup`,
   disruption budget = quorum, default-deny-netværkspolitik og alarmer for
   replikations- og arkivfejl; `db-ha-check` holder plan og manifester i sync.
7. **Krydsvalidering mod DKC-037:** `databaseHAServiceClassProblems` afviser
   klasser der kræver flere fejldomæner/replikaer end databasen tilbyder, eller
   som erklærer eventual consistency/ulovlig multi-writer.

Den deterministiske failover-øvelse bærer `measured: false`; den er **ikke** et
driftsbevis.

## Ændrede og nye filer

Se `evidence/deliverable-files.txt` (30 filer). Hovedgrupper:

- `persistence/ha-plan.json`, `persistence/src/{ha,ha-drill,ha-render,ha-cli}.mjs`,
  `persistence/src/replication.mjs`, `persistence/test/ha.test.mjs`.
- `gitops/manifests/db-ha/` — 5 genererede manifester.
- `contracts/database-ha.schema.json` + `contracts/examples/database-ha.example.json`,
  `conformance/src/database-ha.mjs`, `conformance/test/database-ha-conformance.test.mjs`,
  `conformance/src/schemas.mjs`, `conformance/src/validate-schemas.mjs`.
- `Makefile` (`db-ha-render/-check/-test/-drill` + `ci`),
  `tools/baseline/registry.mjs` (komponent `database-ha` + 4 checks).
- `release/matrix/test-matrix.json` (1.15.0, `REQ-DBHA-001`),
  `release/matrix/threats.json` (2 trusler), `docs/testing/test-matrix.md`,
  `docs/security/threat-model.md`.
- `docs/adr/0046-…`, `docs/adr/README.md`, `docs/spec/database-ha.md`,
  `docs/spec/README.md`, `docs/runbooks/database-failover.md`,
  `docs/status/implementation-matrix.md`.

## Testkommandoer og resultater

| Kommando | Resultat |
|---|---|
| `make validate` | PASS (database-HA valideret) |
| `make lint` | PASS |
| `make db-ha-check` | PASS |
| `make db-ha-render` | PASS (5 manifester i sync) |
| `make db-ha-test` | PASS (18 HA-tests + 8 konformanstests) |
| `make db-ha-drill` | PASS (alle receipts, ≤1 skriver, sync-tab stopper writes) |
| `make persistence-check` | PASS (11 migrationer: v1..v11) |
| `make persistence-test` | PASS (74 tests) |
| `make test` | PASS (236 tests) |
| `make release-check` | PASS (38 krav, matrixversion 1.15.0) |
| `make release-test` | PASS |
| `make supply-chain-check` | PASS |
| `make infrastructure-check` | PASS |
| `make infrastructure-test` | PASS |
| `make jobs-test` / `make messaging-test` | PASS (ingen regression) |
| `make baseline` | 111 PASS / 1 FAIL / 30 NOT RUN (142 checks) |

Den ene FAIL er den forud eksisterende `changelog-check` (manglende DCO
sign-off, inkl. `83ad91a`). Den er hverken skjult eller ændret. `make baseline`
ændrede 30 sporede fixturefiler under `modules/*/conformance`; de er restaureret
fra snapshot efter kørslen, så de ikke indgår i leverancen.

## Acceptkriterier

| Kriterium | Status | Bevis |
|---|---|---|
| Registrér commitkvitteringer før kill af primary; alle kvitterede writes findes efter failover | **PASS** (model) | `replication.mjs` + `ha.test.mjs` + `db-ha-drill`: 5 receipts, 0 tabte efter promotion |
| Netværkspartition giver højst én autoritativ skriver | **PASS** | `assessPartitions` tæller kun stemmeberettigede; `partitionAtMostOneWriter` PASS i drill og test |
| Godkendelser læses ikke fra en forældet replica | **PASS** | `readConsistency.approvals = primary-only`; `canServeRead` og konformanstest afviser sync-/async-læsning |
| Tab af nødvendig sync-replika stopper writes efter politik frem for skjult datatab | **PASS** | `commit` afviser med `sync-replica-loss` og ruller rækken tilbage; test + drill |
| Genstart/rejoin og schemaopgradering testes med realistisk data | **PASS** (SQLite) | `rejoin` kopierer/verificerer digester; test opgraderer alle replikaer v10→v11 med `jobs`-rækker og bekræfter replikering |
| Vedligeholdt operator/failover-controller valgt | **PASS** | `engine.operator=CloudNativePG`; semantikken afviser ikke-vedligeholdt operator |
| Målt failover på en rigtig motor | **NOT RUN** | `integration-db-failover` (`external: true`) — ingen levende PostgreSQL/operator i dette miljø |

## Restgrænser

- Ingen levende PostgreSQL-installation, operator eller klynge i dette miljø.
  `integration-db-failover` er registreret som `external: true` og NOT RUN; en
  målt failover og en faktisk WAL-arkivering kræver uafhængig driftsverifikation.
- Replikeringsprotokollen er efterprøvet over den rigtige SQLite-persistens, men
  det er en deterministisk model — ikke en måling på en produktionsmotor.
- `changelog-check` fejler fortsat (forud eksisterende, DCO sign-off mangler).
- Overlayen erklærer ikke produktionsparathed; kun lokale kontrakt-, persistens-
  og simulationstests er kørt.
