# DKC-041 — Implementér holdbart fil- og objektlager

Kumulativ overlay oven på DKC-001..DKC-039. Lægges med `./apply.sh <checkout>/00-core`.

- **Reviewets base:** `5f9fa73`
- **Undersøgt checkout:** `83ad91a`
- **Forudsætninger:** DKC-037 og DKC-038 er verificeret til stede i den
  anvendte stak (serviceklasserne og `infrastructure/ha-plan.json`). Overlayen
  kæder `dkc-039/apply.sh` (→ `dkc-040/apply.sh` → `dkc-038/apply.sh` →
  `dkc-060/apply.sh` → … → DKC-001).
- **Node:** v22.22.1

## Implementeret adfærd

Kundedata må ikke være bundet til den container eller server, der behandlede
dem. DKC-041 indfører en konkret lagerplan og et rigtigt, replikeret
fil-/objektlager.

1. **Vedligeholdt CSI- og objektlager** (`storage/storage-plan.json`,
   `contracts/storage-plan.schema.json`): Longhorn (replikeret CSI) og MinIO
   (S3-kompatibelt, versionsstyring, object-lock, erasure coding). Begge er
   vedligeholdte og har en dokumenteret fejlmodel, som `storage/src/plan.mjs`
   kræver.
2. **Topologi** (`topology`): tre hosts i tre fejldomæner, to diske pr. host,
   replikafaktor 3, skrive-quorum 2, læse-quorum 2 (overlappende), quorum =
   flertal, minimum 20 % og 10 GB fri pr. host. `capacityStatus()` udløser
   alarm/hard-stop under planens tærskler.
3. **Versionsstyrede objekter og checksums** (`storage/src/object-store.mjs`):
   hver version har en sha256-checksum, og der læses/skrives over et rigtigt
   filsystem med AES-256-GCM-chiffertekst og per-version AAD.
4. **Synkront skrive-quorum:** en write bekræftes kun når mindst `writeQuorum`
   hosts har skrevet; ellers rulles den tilbage, og writen afvises
   (`quorum-loss`). Der er ingen usikre writes ved quorumtab.
5. **Scrub/repair/rebalance:** `scrub()` opdager silent corruption ved at
   genberegne checksums; `repair()`/`repairAll()` genskaber korrupte/manglende
   replikaer fra en sund kopi; `rebalance()` genopretter replikafaktoren.
6. **Kundeafgrænsede nøgler** (`storage/src/tenant-keys.mjs`): HKDF-SHA256
   afleder en nøgle pr. tenant og dataklasse fra en master-nøgle i et eksternt
   KMS (`storeContainsKey: false`).
7. **Dataklassifikation:** `authoritative` og `object-store` er holdbare,
   krypterede og ikke-genopbyggelige; `cache` og `rebuildable-index` er
   genopbyggelige og må ligge på ephemeral disk. Ingen nødvendig tilstand er
   ephemeral. `storage/src/cache.mjs` og `storage/src/index.mjs` er adskilte.
8. **Relokation:** `relocateWorkload()` verificerer at en anden host ser samme
   filer, checksums og rettigheder.
9. **Renderede manifester** (`gitops/manifests/storage/`, 6 filer): CSI-
   StorageClass med replikering/topologi/kryptering, objektlager-bucket med
   versionsstyring/object-lock/erasure coding, default-deny-netværk,
   scrub-CronJob og kapacitetsalarmer; `storage-check` holder plan og
   manifester i sync.
10. **Krydsvalidering:** `storageServiceClassProblems` (DKC-037) og
    `storageHAProblems` (DKC-038) afviser klasser/planer der kræver mere
    redundans end lageret tilbyder.

Den deterministiske holdbarhedsøvelse bærer `measured: false`; den er **ikke**
et driftsbevis.

## Ændrede og nye filer

Se `evidence/deliverable-files.txt` (41 filer). Hovedgrupper:

- `storage/` — `storage-plan.json`, `package.json`, `src/{plan,object-store,
  tenant-keys,cache,index,render,cli,drill}.mjs`, `test/*.test.mjs`.
- `contracts/storage-plan.schema.json` + `contracts/examples/storage-plan.example.json`,
  `conformance/src/storage.mjs`, `conformance/test/storage-conformance.test.mjs`,
  `conformance/src/schemas.mjs`, `conformance/src/validate-schemas.mjs`.
- `gitops/manifests/storage/` — 6 genererede manifester.
- `Makefile` (`storage-render/-check/-test/-drill` + `ci`),
  `tools/baseline/registry.mjs` (komponent `storage` + 4 checks).
- `release/matrix/test-matrix.json` (1.16.0, `REQ-STORAGE-001`),
  `release/matrix/threats.json` (2 trusler), `docs/security/threat-model.md`,
  `docs/testing/test-matrix.md`.
- `docs/adr/0047-holdbart-fil-og-objektlager.md`, `docs/adr/README.md`,
  `docs/spec/storage.md`, `docs/spec/README.md`,
  `docs/runbooks/storage-scrub-repair.md`.
- `release/artifacts.json`, `release/sbom/platform-sbom.cdx.json`,
  `docs/status/supply-chain.md` (regenereret for den nye første­partspakke),
  `docs/status/implementation-matrix.md` (regenereret af `make baseline`).

## Testkommandoer og resultat

| Kommando | Resultat |
| --- | --- |
| `make validate` | PASS — lagerplanen validerer med skema + semantik |
| `make lint` | PASS — 483 JSON-filer, 1210 filer |
| `make storage-render` | PASS — 6 manifester |
| `make storage-check` | PASS — plan, semantik, manifester, serviceklasser, HA-plan |
| `make storage-test` | PASS — 26 + 7 tests (objektlager, cache/indeks, plan, konformans) |
| `make storage-drill` | PASS — alle 5 acceptkrav, `measured: false` |
| `make release-check` | PASS — 39 krav, matrixversion 1.16.0 |
| `make release-test` | PASS |
| `make supply-chain-sbom` + `make supply-chain-check` | PASS — SBOM-digest `b5e5386e6a27…` |
| `make continuity-check/-test`, `make infrastructure-check/-test` | PASS — krydsvalidering |
| `make persistence-check/-test`, `make gitops-test`, `make test` | PASS — regression |
| `make baseline` | 146 checks: 114 PASS, 1 FAIL, 31 NOT RUN |

## Acceptkriterier

| # | Kriterium | Status | Evidens |
| --- | --- | --- | --- |
| 1 | Flyt workload til anden server og verificér samme filer og rettigheder | **PASS** | `relocateWorkload` + testen "relokation til en anden host giver samme filer, checksums og rettigheder"; drill-check `relocationSameFiles` |
| 2 | Host-/diskfejl og silent-corruption-test dækkes af profilens mål | **PASS** | Planens `provider.*.failureModel`, `scrub.detectsSilentCorruption`; `silentCorruptionDetected` + `repairRestoresReplica`. En **målt** host-/diskfejl på et levende lager er `integration-storage-live` = **NOT RUN** |
| 3 | Tab af quorum tillader ikke usikre writes | **PASS** | Semantik afviser `unsafeWritesOnQuorumLoss`; `put` returnerer `quorum-loss` og ruller tilbage; drill-check `quorumLossRejectsWrites` |
| 4 | Tab af cache ændrer ikke autoritative data | **PASS** | `cache.mjs` er adskilt; test "tab af cache ændrer ikke autoritative data"; drill-check `cacheLossDoesNotChangeAuthoritative` |
| 5 | Repair/rebalance under belastning bevarer de vedtagne SLOer | **PASS** | `rebalance()` + `scrub` efter belastning; `slos.maxRepairSeconds`; drill-check `repairUnderLoadPreservesSlo` |

## Leverancer

| # | Leverance | Status |
| --- | --- | --- |
| 1 | Vedligeholdt CSI-/objektlager med dokumenteret replika-/erasure-coding-fejlmodel | **PASS** |
| 2 | Volumer, objektversioner, checksums, scrub/repair, kapacitetsalarmer og kundeafgrænsede nøgler | **PASS** |
| 3 | Klassificér data, cache og genopbyggelige indeks; ingen nødvendig tilstand på ephemeral disk | **PASS** |
| 4 | Antal hosts/diske, fejldomæner, quorum og minimum frirum for topologien | **PASS** |

## Ærligt udestående

- `integration-storage-live` er **NOT RUN**: der findes ingen levende
  CSI-driver (Longhorn) eller S3-kompatibelt objektlager (MinIO) i dette miljø.
  Replikering, checksums, scrub/repair, quorum, nøgler, cache/indeks og
  relokation er efterprøvet deterministisk over et rigtigt filsystem; en målt
  host-/diskfejl og en faktisk rebalance under produktion kræver uafhængig
  driftsverifikation.
- Baseline har fortsat den **forud eksisterende** `changelog-check`-fejl:
  commits (inkl. `83ad91a`) mangler DCO sign-off. Den er ikke indført eller
  skjult af DKC-041.
- Holdbarhedsøvelsen er `measured: false` og er ikke et driftsbevis.
- En konfiguration certificerer ikke et målt serviceniveau.

## Review-identifikatorer

- Review-base: `5f9fa73`
- Undersøgt checkout: `83ad91a`
- Forudsætnings-overlays: DKC-001..DKC-039 (tip `dkc-039/apply.sh`)
- Denne overlay: `dkc-041/`
- E2E: pakkens `apply.sh` på en frisk `83ad91a`-checkout giver et træ der er
  byte-identisk med arbejdsklonen (`evidence/e2e-tree-diff.txt` er tom).
