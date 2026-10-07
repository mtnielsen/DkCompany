# Runbook — dedup og kontrolleret oprydning

DKC-043. Denne runbook beskriver, hvordan dedup-lageret inspiceres, hvordan en
prune gennemføres sikkert, og hvad der gøres ved en korrupt chunk.

Se også [specifikationen](../spec/deduplication.md) og
[ADR-0052](../adr/0052-sikker-deduplikering-og-kontrolleret-oprydning.md).

## 1. Inspektér et dedup-domæne

Et domæne identificeres af `tenantId`, `encryptionDomain`, `retentionClass` og
`category`. Brug `dedup/src/store.mjs`:

```js
const store = createDedupStore({ rootDir, keyRing });
store.listDomains();                                   // aktive domæner
store.listSnapshots({ domain });                       // snapshots + retention
store.info({ domain, snapshotId });                    // chunkIds + digest
store.measure({ domain });                             // logiske/fysiske bytes
```

`measure` viser `logicalBytes`, `physicalBytes`, `savedBytes`,
`physicalToLogicalRatio`, `uniqueChunks` og `references`. En besparelse uden en
aktiv gate er kun et tal — se trin 4.

## 2. Verificér integritet

```
make dedup-test
```

`store.scrub({ domain })` returnerer `checked`, `corruptions` og
`affectedSnapshots`. Hver korruption angiver `chunkId`, `reason` (`auth-failed`,
`chunk-missing`, `checksum-mismatch`) og hvilke snapshots der refererer til den.
Et snapshot hvis chunk er korrupt kan ikke gendannes, før den er repareret.

## 3. Prune (kontrolleret oprydning)

Prune må **kun** køres af én skriver ad gangen og kræver en lease:

```js
const { lease } = store.acquireLease({ domain, owner: "gc-worker", leaseMs: 120_000 });
const result = store.prune({ domain, owner: "gc-worker", fencingToken: lease.fencingToken });
store.releaseLease({ domain, owner: "gc-worker", fencingToken: lease.fencingToken });
```

- En aktiv lease kan ikke overtages; vent til den udløber, eller overtag med et
  højere fencing-token.
- `prune` udløber kun snapshots hvor `protected !== true` og `retentionUntil` er
  passeret. Beskyttede snapshots røres aldrig.
- Chunks slettes først når `refs <= 0` **og** ingen snapshot refererer til dem.

## 4. Besparelsesgaten

Besparelsen aktiveres først når både integritetskontrollen og den fulde restore
består:

```js
const gate = evaluateSavingsGate({ store, domain, snapshotIds });
gate.savingsActive; // true kun hvis gate.integrity.ok && gate.restore.ok
```

`make dedup-drill` kører hele forløbet på en rigtig krypteret backup og
returnerer `measured: true` samt de funktionelle checks. Hvis `savingsActive`
er `false`, skal årsagen i `reasons` undersøges, før besparelsen rapporteres.

## 5. Efter et crash

Efter en uventet afbrydelse:

```js
const result = store.recover();
// { recovered, droppedSnapshots, orphanChunks }
```

- `recovered` er antallet af genoprettede put/prune-mutationer.
- `droppedSnapshots` er delvist skrevne puts der aldrig blev committet.
- `orphanChunks` er chunk-filer uden reference, som blev ryddet.

Kør efterfølgende `scrub()` og en fokuseret restoretest, før lageret tages i
brug igen.

## 6. Eskalering

- **Korrupt chunk uden sund kopi:** stop prune, bevar lageret, og gendan det
  berørte snapshot fra den uafhængige backup
  ([disaster-recovery runbook](disaster-recovery.md)).
- **Lease kan ikke overtages:** kontrollér `leaseInfo({ domain })` for en
  hængende holder og dens `until`; overtag først når den er udløbet.
- **Mistenkt tværkundelækage:** stop dedup for det pågældende domæne, verificér
  at `domain.id` bærer tenant + krypteringsdomæne + retentionklasse, og eskalér
  til Security Owner.

## 7. Grænser

Runbooken er skrevet til den deterministiske model over et rigtigt filsystem.
På et levende objektlager skal lease, prune og scrub verificeres mod den
faktiske lagersemantik; det er `integration-dedup-live` og er **NOT RUN**.
