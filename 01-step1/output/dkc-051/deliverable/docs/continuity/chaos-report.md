# Fejl- og katastroferapport

> Genereret fra `chaos/failure-matrix.json` med `make chaos-run`. Tallene er en **deterministisk model** (`measured: false`). En målt fejløvelse på en levende stagingklynge er en ekstern integration, se [`chaos-live.md`](chaos-live.md).

**Gate:** PASS

## Invarianter

| Invariant | Resultat |
| --- | --- |
| noSplitBrain | PASS |
| noLostAcknowledgedWrites | PASS |
| immutableBypassDeniedAndLogged | PASS |
| healingStormBounded | PASS |
| repeatableFromCleanInstall | PASS |

## Scenarier

| Scenarie | Failure scope | Dataudfald | RPO mål/målt | RTO mål/målt | Autonomi | Split-brain | Tabte writes | Resultat |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ha-host-loss | single-host | no-acknowledged-loss | 0/0 | 2/1 | safe-fallback | nej | 0 | PASS |
| ha-quorum-loss | quorum | no-acknowledged-loss | 0/0 | 5/0 | none | nej | 0 | PASS |
| network-partition | network-partition | no-acknowledged-loss | 0/0 | 2/0.25 | none | nej | 0 | PASS |
| database-failover | database | no-acknowledged-loss | 0/0 | 5/0.25 | safe-fallback | nej | 0 | PASS |
| storage-disk-full | storage | no-acknowledged-loss | 0/0 | 30/0 | none | nej | 0 | PASS |
| storage-corruption | storage | no-loss | 0/0 | 30/0.1 | safe-fallback | nej | 0 | PASS |
| queue-replay | queue | no-loss | 0/0 | 15/0 | safe-fallback | nej | 0 | PASS |
| control-plane-loss | control-plane | no-acknowledged-loss | 0/0 | 30/0 | safe-fallback | nej | 0 | PASS |
| site-restore | site | bounded-loss | 0/0 | 60/0 | runbook-with-approval | nej | 0 | PASS |
| dedup-prune | deduplication | no-loss | 0/0 | 30/0 | safe-fallback | nej | 0 | PASS |
| kms-unavailability | keys | no-acknowledged-loss | 0/0 | 30/0 | safe-fallback | nej | 0 | PASS |
| immutable-bypass | immutable | no-loss | 0/0 | 5/0 | none | nej | 0 | PASS |
| healing-storm | control-plane | no-acknowledged-loss | 0/0 | 30/0 | safe-fallback | nej | 0 | PASS |

## Afvigelser

Ingen. Alle scenarier og invarianter er opfyldt i modellen.

## Sådan gentages øvelsen

```sh
make chaos-run     # kører hele fejlmatrixen deterministisk
make chaos-check   # validerer matrix og renderede artefakter
```

Øvelsen bruger kun syntetiske data og midlertidige filer og rydder op efter sig. Den kan køres fra en ren installation uden kundedata.
