# Holdbart fil- og objektlager

DKC-041. Kundedata må ikke være bundet til den container eller server, der
behandlede dem. Denne spec beskriver den konkrete lagerplan, det replikerede
objekt-/fillager og de grænser der er ærligt markeret som NOT RUN.

## Mål

- En bekræftet write findes på et quorum og overlever en host-/diskfejl.
- En netværkspartition eller et quorumtab tillader ikke usikre writes.
- Silent corruption opdages af en checksum og repareres fra en sund replika.
- Ingen nødvendig tilstand ligger på ephemeral disk.
- Cache og genopbyggelige indeks kan smides væk uden at ændre autoritative data.
- Nøgler er kundeafgrænsede og ligger uden for lageret.
- En workload kan flyttes til en anden server med samme filer og rettigheder.
- En konfiguration certificerer ikke en målt fejlmodel.

## Planen

`storage/storage-plan.json` er den kanoniske plan og valideres af
`contracts/storage-plan.schema.json` samt beslutningssemantikken i
`storage/src/plan.mjs`:

- **CSI og objektlager:** et vedligeholdt CSI-lager (Longhorn) med replikering
  og et S3-kompatibelt objektlager (MinIO) med versionsstyring, object-lock og
  erasure coding. Begge har en dokumenteret fejlmodel.
- **Topologi:** tre hosts i tre fejldomæner, to diske pr. host, replikafaktor 3,
  skrive-quorum 2 og læse-quorum 2 (overlappende), quorum = flertal, minimum
  20 % og 10 GB fri pr. host.
- **Dataklassifikation:** `authoritative` og `object-store` er holdbare,
  krypterede og ikke-genopbyggelige; `cache` og `rebuildable-index` er
  genopbyggelige og må ligge på ephemeral disk. Ingen nødvendig tilstand er
  ephemeral.
- **Checksums og scrub:** sha256 ved skrivning og læsning; scrub hvert døgn
  opdager silent corruption og reparerer fra en sund replika eller parity.
- **Nøgler:** kundeafgrænsede nøgler afledt pr. tenant og dataklasse; nøglen
  ligger i et eksternt KMS, ikke i lageret.
- **Relokation:** en dokumenteret procedure der flytter workloade til en anden
  host og verificerer filer, checksums og rettigheder.

## Implementeringen

`storage/src/object-store.mjs` implementerer protokollen over et rigtigt
filsystem. Hver host har sin egen mappe med blobs (AES-256-GCM-chiffertekst) og
manifests (versionsmetadata):

1. **Put:** objektet krypteres med tenantens afledte nøgle, får en sha256-checksum
   og skrives til alle nåbare hosts. Kun når mindst `writeQuorum` hosts har
   skrevet, bekræftes versionen; ellers rulles den tilbage, og writen afvises
   (`quorum-loss`). Der er ingen usikre writes.
2. **Get:** læsningen kræver et overlappende læse-quorum, verificerer checksummen
   og falder tilbage til en sund replika hvis én er korrupt.
3. **Scrub/repair:** `scrub()` genberegner checksums for hver version og opdager
   silent corruption; `repair()` og `repairAll()` genskaber manglende eller
   korrupte replikaer fra en sund kopi; `rebalance()` genopretter replikafaktoren.
4. **Cache/indeks:** `storage/src/cache.mjs` og `storage/src/index.mjs` er
   adskilte, genopbyggelige strukturer. At smide dem væk ændrer ikke det
   autoritative lager.
5. **Relokation:** `relocateWorkload()` verificerer at en anden host ser samme
   filer, checksums og rettigheder.

## Kontrakter

- `contracts/storage-plan.schema.json` — den kanoniske plan.
- `contracts/examples/storage-plan.example.json` — planen som eksempel.

## Test og kontrol

| Kommando | Dækker |
| --- | --- |
| `make storage-render` | Genererer `gitops/manifests/storage/` fra planen |
| `make storage-check` | Plan, semantik, manifester, serviceklasser og HA-plan |
| `make storage-test` | Versioner, checksums, quorum, tenantnøgler, scrub/repair, cache, indeks og konformans |
| `make storage-drill` | Deterministisk holdbarhedsøvelse med de fem acceptkrav |

En **målt** host-/diskfejl og en faktisk rebalance på et levende CSI-/objektlager
er `integration-storage-live` og er NOT RUN i dette miljø. Protokollen er
efterprøvet over et rigtigt filsystem, men en levende fejlmodel kræver
uafhængig driftsverifikation.
