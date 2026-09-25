# Runbook — storage scrub og repair

Formål: opdage og reparere silent corruption eller tabte replikaer i fil- og
objektlageret uden at ændre autoritative data og uden at bryde SLOerne.

## Forudsætninger

- Planen i `storage/storage-plan.json` er gældende; `make storage-check`
  bekræfter at den er konsistent.
- Mindst skrive-quorum hosts er nåbare, og en sund replika findes.
- En navngivet incident commander og det aftalte repair-tidsbudget
  (`slos.maxRepairSeconds`).

## Regelmæssig scrub

1. Kør `make storage-drill` for den deterministiske kontrol, eller
   `node storage/src/cli.mjs scrub <rootDir>` mod en given lagerrod.
2. Scrub genberegner sha256 for hver version og rapporterer
   `{ checked, corruptions, ok }`.
3. Er `ok: true`, er der intet at gøre. Er der korruptioner, gå til repair.

## Repair af silent corruption

1. Bekræft at mindst én sund replika findes (`corruptions` angiver host).
2. Kør `repairAll()`. For hver korruption kopieres den sunde chiffertekst fra en
   anden host, checksummen verificeres, og manifestet genskabes.
3. Kør scrub igen og bekræft `ok: true`.
4. Hvis ingen sund kopi findes (`no-healthy-source`), må objektet **ikke**
   betragtes som gendannet. Eskalér og gendan fra backup.

## Manglende replika og rebalance

1. `rebalance()` genopretter replikafaktoren blandt de nåbare hosts fra en sund
   kopi.
2. Bekræft bagefter at hvert objekt har `replicaFactor` sunde kopier.

## Quorumtab

Ved færre end skrive-quorum nåbare hosts afvises nye writes (`quorum-loss`).
Der findes ingen vej til usikre writes. Stop skrivninger, genopret quorum, og
genoptag først derefter. En læsning kræver fortsat et overlappende læse-quorum.

## Cache og indeks

Cache (`storage/src/cache.mjs`) og genopbyggelige indeks
(`storage/src/index.mjs`) er adskilte. Et cache- eller indekstab kræver kun at
strukturen bygges igen fra det autoritative lager; autoritative data ændres ikke.

## Relokation

1. Attach volumen på den nye host.
2. Verificér checksums og filrettigheder (`relocateWorkload`).
3. Genoptag workloade og decommission den gamle host.

## Bevis

`make storage-drill` simulerer relokation, silent corruption, quorumtab,
cachetab og repair under belastning deterministisk og bekræfter de fem
acceptkrav. Simuleringen er **ikke** en måling (`measured: false`). En rigtig
host-/diskfejl og en faktisk rebalance på et levende CSI-/objektlager er
`integration-storage-live` og er NOT RUN i dette miljø.
