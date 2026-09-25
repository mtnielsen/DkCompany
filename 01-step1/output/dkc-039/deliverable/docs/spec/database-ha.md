# Database-HA med fencing og konsistent failover

DKC-039. Databasen er den fælles tilstand bag godkendelser, jobs, budgetter og
audit. Denne spec beskriver den database-HA-plan der gør en bekræftet
transaktion holdbar og forhindrer split-brain, og de grænser der er ærligt
markeret som NOT RUN.

## Mål

- En bekræftet transaktion har en commitkvittering og findes efter failover.
- En netværkspartition giver højst én autoritativ skriver.
- Godkendelser og policy-læsning betjenes ikke fra en forældet replica.
- Tab af en nødvendig sync-replika stopper writes frem for at tabe data.
- Genstart/rejoin og schemaopgradering er testbare med realistisk data.
- En konfiguration certificerer ikke et målt niveau.

## Planen

`persistence/ha-plan.json` er den kanoniske plan og valideres af
`contracts/database-ha.schema.json` samt beslutningssemantikken i
`persistence/src/ha.mjs`:

- **Operator:** en vedligeholdt databaseoperator og failover-controller
  (CloudNativePG) på en understøttet motor; platformen driver ikke sin egen
  engine.
- **Topologi:** tre stemmeberettigede instanser (primary + to sync-replikaer) i
  tre fejldomæner, quorum = flertal, plus en ikke-stemmeberettiget async-læser.
- **Durability:** kritiske writes bruger `synchronous_commit=remote_apply` og
  bekræftes først efter quorum; `noSilentAsyncFallback` og
  `onSyncReplicaLoss: reject-writes` forbyder tavs datatab.
- **Fencing:** den tidligere primary fences med et monotont token før promotion;
  usikker promotion er forbudt.
- **Read-consistency pr. flow:** godkendelser er `primary-only` med
  staleness-budget 0; policy og audit kræver primary eller sync-committed;
  rapportering må læse en replica inden for et bundet staleness-budget.
- **WAL/PITR:** WAL arkiveres krypteret, PITR er aktiveret, og base-backups
  kører efter en plan.
- **Failback/rejoin:** den tidligere primary skal fences, rejoin'e, indhente
  loggen og verificere checksums før den må promoveres.

## Protokollen

`persistence/src/replication.mjs` implementerer den synkrone
replikeringskontrakt over SQLite-lagret:

1. **Commit:** en write skrives til primary'ens `replication_log` og
   replikeres til de nåbare replikaer. Kun når mindst
   `minSyncReplicasForWrites` sync-replikaer har kvitteret, skrives en
   `commit_receipt`, og writen bekræftes. Ellers rulles rækken tilbage på alle
   noder, og writen afvises (`sync-replica-loss`).
2. **Fencing:** `fence(node)` hæver et monotont `fenceEpoch` og revokerer
   skriveretten. En fenced node modtager ikke nye writes.
3. **Promotion:** `promote(node)` kræver at den gamle primary er fenced, at
   kandidaten er en sync-replika, og at kandidaten har alle bekræftede receipts.
4. **Partition:** `assessPartitions()` tæller kun stemmeberettigede instanser, så
   en gruppe uden quorum ikke kan have en autoritativ skriver — højst én samlet.
5. **Rejoin:** `rejoin(node, { from })` kopierer manglende log-rækker, verificerer
   digester, kopierer receipts og ophæver fencing.

## Kontrakter

- `contracts/database-ha.schema.json` — den kanoniske plan.
- `contracts/examples/database-ha.example.json` — planen som eksempel.
- `contracts/examples/database-profile.managed.example.json` — den profil planen
  refererer til.

## Test og kontrol

| Kommando | Dækker |
| --- | --- |
| `make db-ha-render` | Genererer `gitops/manifests/db-ha/` fra planen |
| `make db-ha-check` | Plan, semantik, manifester, databaseprofil og serviceklasser |
| `make db-ha-test` | Replikering, receipts, fencing, partition, rejoin, schemaopgradering |
| `make db-ha-drill` | Deterministisk failover med commitkvitteringer |

En **målt** failover på en rigtig PostgreSQL/operator og en faktisk
WAL-arkivering er `integration-db-failover` og er NOT RUN i dette miljø.
Protokollen er efterprøvet mod den rigtige SQLite-persistens, men en levende
motor kræver uafhængig driftsverifikation.
