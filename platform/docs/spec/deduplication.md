# Sikker deduplikering og kontrolleret oprydning

DKC-043. Dedup reducerer unødige kopier uden at skabe nye datatabs- eller
fortrolighedsproblemer. Designet er bevidst opdelt i fire separate domæner,
fordi backupblokke, primære objekter, jobhændelser og forretningsposter har
forskellige krav til konsistens, fortrolighed og forretningsbetydning.

Kanonisk politik: [`dedup/dedup-policy.json`](../../dedup/dedup-policy.json).
Beslutningerne er arkiveret i [ADR-0052](../adr/0052-sikker-deduplikering-og-kontrolleret-oprydning.md).

## Fire separate domæner

| Domæne | Aktiv | Semantik | Begrundelse |
| --- | --- | --- | --- |
| `backup-blocks` | ja | indholdsadresserede chunks | Backup af database, objekter og konfiguration gentages natligt; den gennemprøvede backupløsning læses komponent for komponent. |
| `primary-objects` | nej (valgfrit) | indholdsadresserede chunks | Dedup af primærdata er valgfrit og kræver sin egen integritets- og restorevalidering plus en navngivet menneskelig godkendelse. |
| `job-events` | ja | kun idempotency-nøgle | En gentaget levering af samme begivenhed undertrykkes; indholdet flettes aldrig, fordi to begivenheder med samme payload kan være to forskellige hændelser. |
| `business-records` | nej | aldrig flet | To forretningsdubletter er to selvstændige, versionsstyrede poster indtil en ejer beslutter en sammensmeltning uden for dedup-laget. |

## Dedupgrænsen

Dedup sker **kun** inden for en tenant, et krypteringsdomæne og en
retentionklasse. Hvert domæne har:

- sin egen chunk-namespace under `chunks/<domainHash>/`,
- sin egen HKDF-SHA256-afledte AES-256-GCM-nøgle fra et eksternt KMS
  (`dedup/src/keys.mjs`), og
- sin egen chunk-adresse `sha256(domainId + ":" + chunkSha256)`.

Identisk klartekst i to domæner får dermed forskellige adresser og forskellige
chiffertekster. En tenant kan ikke udlede en anden tenants indhold ved at
sammenligne chunks, og en kompromitteret domænenøgle åbner ikke andre domæner.
`crossTenantDedup` er `false` og afvises af både skemaet og semantikken.

## Indholdsdefineret chunking

`dedup/src/chunker.mjs` opdeler en buffer med gear-CDC: en rullende hash over
indholdet afgør grænserne, så en indsættelse eller sletning kun skubber grænser
i nærheden af ændringen. Hver chunk får sin sha256. Chunkingen er deterministisk:
samme bytes giver samme chunks uanset filnavn, tid eller proces.

## Referencekæde og retention-aware GC

Et snapshot er en ordnet liste af chunk-id'er plus digesten af det fulde
indhold. Chunks referencetælles:

- `putSnapshot` opretter manglende chunks og øger refs; identiske chunks
  genbruges inden for domænet.
- `removeSnapshot` sænker refs og fjerner snapshotet fra indekset.
- `prune` er mark-and-sweep: den udløber ikke-beskyttede snapshots hvis
  `retentionUntil` er passeret, beregner de refererede chunks og sletter kun
  urefererede chunks. Beskyttede snapshots (fx WORM-kopier) holdes altid.

Prune kræver en gyldig **single-writer lease** med et fencing-token. En aktiv
lease kan ikke overtages, og et gammelt token afvises, så to samtidige prunere
ikke kan slette hinandens data.

## Crash-recovery

Intentionen journalføres **før** chunks skrives:

- et crash efter journalen men før indekset: `recover()` genopbygger snapshotet
  hvis alle chunks findes, ellers droppes det delvise put,
- et crash midt i en prune: `recover()` sletter kun chunks der ikke længere
  refereres, og rydder forældreløse chunk-filer.

Tilstanden efter et crash er derfor enten det committede snapshot eller en
konsistent tilstand uden delvise referencer.

## Korruption

`scrub()` dekrypterer og verificerer hver chunk mod indeksets digest og
returnerer de berørte snapshots pr. korrupt chunk. `verifyDedupedRestore`
genforener hvert snapshot og sammenligner mod backup-manifestet, så et brudt
dedup-lager ikke kan producere en tavst forkert gendannelse.

## Besparelsesgaten

`evaluateSavingsGate` kører en integritetskontrol (scrub) og en fuld restore
(genforening og digest-verifikation af hvert snapshot). `savingsActive` er kun
sand når begge består. Et [`DedupReceipt`](../../contracts/dedup-receipt.schema.json)
bærer de målte logiske og fysiske bytes, referencekæden og resultatet af begge
kontroller; et receipt med korruptioner kan ikke hævde en aktiv besparelse.

## Kommandoer

```
make dedup-write   # skriv docs/storage/dedup-plan.md fra politikken
make dedup-check   # politik, semantik, providers og dokumentsync
make dedup-test    # chunking, referencekæde, crash-recovery, GC-lease, korrupt chunk
make dedup-drill   # rigtig backup → dedup → mål → fuld restore
```

## Grænser

Alt ovenstående er efterprøvet deterministisk over et rigtigt filsystem og en
rigtig SQLite-backup. En målt delingsgrad, krypteringsydelse og oprydning på et
levende S3-/MinIO-objektlager med en ekstern KMS er `integration-dedup-live` og
er **NOT RUN**; den kræver uafhængig driftsverifikation.
