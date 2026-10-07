# Uafhængig backup, PITR og katastrofegendannelse

> DKC-042 · ADR-0051. Hele kundepakken skal kunne genoprettes efter tabet eller
> kompromitteringen af hele primærmiljøet — uden at primærklyngens egne
> driftscredentials kan slette historikken.

DKC-016 gav en krypteret backup med separat nøgleadgang, DKC-057 gjorde
backupmålene testbare, og DKC-039 gav database-HA med WAL/PITR. DKC-042 samler
dem i en **uafhængig** katastrofeplan: 3-2-1-1-0, applikationskonsistent PITR
med data-/ACL-afstemning, en separat recovery-identitet, et isoleret
recovery-miljø, et kendt rent restorepunkt, en slettejournal og en planlagt
failback.

## Den kanoniske plan og det afledte dokument

`backup/dr/disaster-recovery-plan.json` er kilden. Den validerer mod
[`contracts/disaster-recovery-plan.schema.json`](../../contracts/disaster-recovery-plan.schema.json),
og `conformance/src/disaster-recovery.mjs` håndhæver beslutningerne.
`docs/continuity/dr-plan.md` genereres med `make dr-write`, og `make dr-check`
afviser det, hvis det er ude af trit.

## 3-2-1-1-0

Planens `principle` erklærer 3-2-1-1-0, og hver erklæring skal stemme med de
faktiske `copies`:

- **3** kopier, **2** medier, **1** ekstern kopi, **1** offline/immutable kopi
  og **0** uoprettelige fejl (mindst én verificeret restore).

Hver kopi bærer et fejl- og adgangsdomæne. De immutable kopier må ikke bruge
primærklyngens driftscredentials og skal have en dokumenteret sletningsspærring.
`backup/src/dr/plan.mjs` krydsrefererer kopierne mod de konfigurerede
`backup/targets/*.json`, så en plan ikke kan pege på et mål, der ikke findes.

## Primærklyngens grænse

`plan.primaryCluster.canDeleteProtectedBackups` er `false`, og `delete` samt
`retention-shorten` står eksplicit på `forbiddenOperations`. Håndhævelsen ligger
i `backup/src/dr/access.mjs`:

- `createRecoveryAccessGate(...).authorizeProtectedBackupDelete(...)` afviser
  **altid** primærklyngens driftscredentials (uanset godkendelse),
- en tilladt sletning kræver to forskellige, navngivne godkendere og at udføreren
  ikke selv godkender,
- en COMPLIANCE-låst kopi afvises mekanisk, og
- det underliggende lager (DKC-041/048) afviser sletningen, så et kompromitteret
  credentials ikke kan fjerne historikken.

## Applikationskonsistent PITR og ACL-afstemning

Et snapshot alene er ikke bevis. `backup/src/dr/pitr.mjs` arkiverer en
append-only, hash-kædet WAL-strøm ved siden af base-backup'en og:

1. vælger den nyeste base-backup før det valgte tidspunkt og inden for
   recovery-vinduet,
2. afspiller præcis de WAL-poster, der ligger mellem base og det valgte
   tidspunkt, på en **rigtig** SQLite-kopi,
3. afstemmer data (rækkeantal pr. tabel og digest) og ACL (subject → rolle) mod
   den forventede matrix, og
4. giver en `blocked`-status hvis tidspunktet ligger uden for vinduet, hvis
   WAL-kæden er brudt, eller hvis ACL afviger — med en begrundelse pr. afvigelse.

Rapporten validerer mod
[`contracts/pitr-reconciliation.schema.json`](../../contracts/pitr-reconciliation.schema.json).

## Separat recovery-identitet og adgang

`backup/dr/recovery-access-profile.json` validerer mod
[`contracts/recovery-access-profile.schema.json`](../../contracts/recovery-access-profile.schema.json):

- recovery-identiteten er adskilt fra primærklyngens driftscredentials,
- kun et verificeret menneske kan aktivere den, med to-personers godkendelse og
  en maksimal varighed,
- der findes ingen stående adgang, og
- krypteringsnøgler, konfiguration, katalog og images holdes uden for
  backup-lageret og pinnes på digest.

## Isoleret recovery-miljø og kendt rent restorepunkt

`plan.recoveryEnvironment` erklærer et netværksisoleret miljø uden afhængighed
af den primære klynge. Tabet af **IAM**, **DNS** og **secret-store** skal indgå
både i miljøets `dependencies` og i brugerflowets `includesDependencies`.
Manifesterne ligger i `gitops/manifests/recovery/`.

`plan.knownCleanPoint` peger på et verificeret, kendt rent restorepunkt med en
navngiven menneskelig verifikator og en evidensreference.

## Slettejournal og failback

`plan.deletionJournal` peger på den append-only, hash-kædede suppressionsjournal
(`backup/src/suppression.mjs`). Ved gendannelse anvendes kun poster nyere end
backupens skæringstidspunkt, så slettede persondata ikke genindføres.

`plan.failback` kræver en dokumenteret procedure, fence og rejoin med
checksum-verifikation (DKC-039).

## Øvelsen

`backup/src/dr/drill.mjs` genopretter hele kundepakken i et isoleret miljø uden
en fungerende primærklynge og måler RPO/RTO for det **samlede** brugerflow —
inklusive IAM, DNS og secret-store — ikke kun databaseopstart. Rapporten
validerer mod
[`contracts/disaster-recovery-drill.schema.json`](../../contracts/disaster-recovery-drill.schema.json).

`make dr-drill` kører øvelsen mod den lokale SQLite-persistens. Rapporten bærer
`measured: false`: den er en deterministisk model, og en målt øvelse mod en
levende PostgreSQL-klynge er `integration-dr-live` og **NOT RUN**.

## Miljøgrænse

Den lokale PITR- og DR-øvelse kører rigtigt mod SQLite og et rigtigt WORM-lager.
En produktionsøvelse med tab af hele primærklyngen, en rigtig PostgreSQL-PITR og
eksterne object stores kræver en levende klynge og et navngivet menneskes
godkendelse og er derfor registreret som `integration` og **NOT RUN** i dette
miljø.
