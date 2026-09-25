# Runbook — database-failover

Formål: håndtere tab af database-primary'en sikkert, skelne planlagt switchover
fra et hårdt nedbrud, og bevare alle bekræftede transaktioner uden split-brain.

## Forudsætninger

- Planen i `persistence/ha-plan.json` er gældende; `make db-ha-check` bekræfter
  at den er konsistent.
- Mindst `minSyncReplicasForWrites` sync-replikaer er sunde.
- En navngivet incident commander og det aftalte RTO-vindue.

## Planlagt switchover (frivillig)

1. Bekræft at alle sync-replikaer er indhentet, og at WAL-arkivet er ajour.
2. Fence den nuværende primary, så den ikke længere kan acceptere writes.
3. Promovér den valgte sync-replika (`promote`), og bekræft at den har alle
   bekræftede receipts.
4. Peg læse-trafikken om; godkendelser læses fortsat kun fra primary.
5. Rejoin den gamle primary som replika, og verificér checksums.

## Hårdt primary-nedbrud

1. Bekræft at quorum stadig er intakt. Er det ikke, må der **ikke** skrives.
2. Fence den gamle primary (revoker skriveretten), så den ikke kan genoptage
   skrivning efter en partition.
3. Promovér en sync-replika der har alle bekræftede receipts.
4. Bekræft at alle commitkvitteringer findes på den nye primary.

Ved quorumtab: stop nye writes, eskalér til security-owner, og genopret quorum
før skrivning genoptages. Der findes ingen vej til usikre writes.

## Tab af en nødvendig sync-replika

Politikken er `reject-writes`. Når færre end `minSyncReplicasForWrites`
sync-replikaer kvitterer, afvises writen frem for at overgå tavst til async.
Genopret replikaen (eller vent på rejoin), og genoptag først derefter writes.

## Rejoin og schemaopgradering

1. Fence noden, hvis den ikke allerede er det.
2. Rejoin den fra den aktuelle primary; verificér at alle log-digester matcher.
3. Kør migrationerne på noden, og bekræft at data og `event_outbox` er intakte.
4. Ophæv først fencing når checksums og receipts er verificeret.

## Bevis

`make db-ha-drill` simulerer failover deterministisk og bekræfter at alle
commitkvitteringer findes efter promotion, at partitionen højst giver én
autoritativ skriver, og at tab af en sync-replika stopper writes. Simuleringen
er **ikke** en måling (`measured: false`). En rigtig failover og WAL-arkivering
på en levende motor er `integration-db-failover` og er NOT RUN i dette miljø.
