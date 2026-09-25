# DKC-042 — Indfør uafhængig backup, PITR og katastrofegendannelse

Kumulativ overlay oven på stak-tippet DKC-049. Lægges med
`./apply.sh <checkout>/00-core`.

- **Reviewets base:** `5f9fa73457d22583b9948611d5cc3afffec4ae38` (`5f9fa73`)
- **Undersøgt checkout:** `83ad91a963d8055f77c29fb4361455689df95acb` (`83ad91a`)
- **Forudsætningskæde:** `dkc-049/apply.sh` → `dkc-021/apply.sh` →
  `dkc-048/apply.sh` → `dkc-041/apply.sh` → `dkc-039/apply.sh` →
  `dkc-040/apply.sh` → … → `dkc-001/apply.sh`. DKC-042 afhænger formelt af
  **DKC-016** (krypteret backup med separat nøgleadgang og suppressionsjournal),
  **DKC-039** (database-HA med WAL-arkivering og PITR) og **DKC-041** (holdbart
  fil-/objektlager med WORM). Alle tre er verificeret i den anvendte stak:
  `backup/src/{vault,restore,drill,keys,suppression}.mjs`,
  `persistence/src/{replication,ha,ha-drill}.mjs` + `persistence/ha-plan.json` og
  `storage/src/object-store.mjs` med `lockVersion`/`deleteVersion`.
- **Miljø:** Node v22.22.1. Ingen levende klynge, ingen ekstern PostgreSQL,
  ingen rigtige S3/object stores, intet Docker/cosign/trivy/kubectl/tofu.

## Implementeret adfærd

1. **3-2-1-1-0 som håndhævet driftsprincip**
   (`backup/dr/disaster-recovery-plan.json`,
   `contracts/disaster-recovery-plan.schema.json`,
   `backup/src/dr/plan.mjs`): planen erklærer mindst tre kopier på mindst to
   medier, én ekstern og én offline/immutable kopi i adskilte fejl- og
   adgangsdomæner samt mindst én verificeret restore. Den deklarerede tælling
   skal stemme med de faktiske `copies`, hver kopi krydsrefereres mod de
   konfigurerede `backup/targets/*.json`, og der blev tilføjet et nyt
   offline/immutable mål (`backup/targets/offline-vault.json`).
2. **Primærklyngens driftscredentials kan ikke slette beskyttede backups**
   (`backup/src/dr/access.mjs`): `createRecoveryAccessGate(...)` afviser altid
   primærklyngens driftscredentials, kræver to forskellige navngivne godkendere
   og afviser COMPLIANCE-låste kopier; den kalder derefter det rigtige WORM-lager
   (`storage/src/object-store.mjs`), hvor COMPLIANCE-låsen mekanisk afviser
   sletningen. Et afvist forsøg rører ikke lageret.
3. **Applikationskonsistent PITR med data- og ACL-afstemning**
   (`backup/src/dr/pitr.mjs`, `contracts/pitr-reconciliation.schema.json`): en
   append-only, hash-kædet WAL-strøm arkiveres. `planPointInTimeRecovery` vælger
   den nyeste base-backup før det valgte tidspunkt og inden for
   recovery-vinduet, `recoverToPointInTime` afspiller de rigtige WAL-poster på en
   rigtig SQLite-kopi og afstemmer data (rækkeantal/digest) og ACL (subject →
   rolle). Et snapshot alene er ikke bevis; et brudt arkiv, et fremtidigt eller
   for gammelt tidspunkt og en ACL-afvigelse giver `blocked`.
4. **Separat recovery-identitet og recovery-adgang**
   (`backup/dr/recovery-access-profile.json`,
   `contracts/recovery-access-profile.schema.json`, `backup/src/dr/access.mjs`):
   recovery-identiteten er adskilt fra driften, kan kun aktiveres af et
   verificeret menneske med to-personers godkendelse og tidsbegrænsning, har
   ingen stående adgang, og nøgler, konfiguration, katalog og images holdes uden
   for backup-lageret og pinnes på digest.
5. **Isoleret recovery-miljø, kendt rent punkt og slettejournal**
   (`backup/src/dr/drill.mjs`, `gitops/manifests/recovery/*.json`): et
   netværksisoleret miljø uden afhængighed af den primære klynge genopretter
   hele kundepakken, genopretter IAM, DNS og secret-store fra backup, anvender
   den append-only, hash-kædede slettejournal (`backup/src/suppression.mjs`) og
   kræver et navngivet, verificeret kendt rent restorepunkt.
6. **Målt RPO/RTO for det samlede brugerflow**
   (`contracts/disaster-recovery-drill.schema.json`): øvelsen måler det samlede
   brugerflow (log ind → godkend → udfør → audit) inkl. IAM/DNS/secret-store,
   ikke kun databaseopstart, og `gate.status` bliver `blocked` ved enhver
   afvigelse.
7. **Planlagt, fence-krævende failback** (`docs/spec/disaster-recovery.md`,
   `docs/runbooks/disaster-recovery.md`): procedure, fence og rejoin med
   checksum-verifikation.

`docs/continuity/dr-plan.md` genereres fra planen med `make dr-write`, og
`make dr-check` afviser det, hvis det er ude af trit.

## Ændrede filer

42 filer (0 slettede): se `evidence/deliverable-files.txt`. De vigtigste:

- `backup/src/dr/{plan,access,pitr,drill,render,check,cli}.mjs` — DR-laget.
- `backup/dr/{disaster-recovery-plan,recovery-access-profile}.json` — kanonisk data.
- `backup/targets/offline-vault.json` — offline/immutable kopi.
- `contracts/{disaster-recovery-plan,recovery-access-profile,pitr-reconciliation,disaster-recovery-drill}.schema.json` + 4 eksempler.
- `conformance/src/disaster-recovery.mjs`, `conformance/src/schemas.mjs`, `conformance/src/validate-schemas.mjs`, `conformance/test/disaster-recovery-conformance.test.mjs`.
- `backup/test/dr-{plan,access,pitr,drill}.test.mjs`.
- `docs/{spec/disaster-recovery.md, runbooks/disaster-recovery.md, continuity/dr-plan.md, adr/0051-…md, adr/README.md}`.
- `gitops/manifests/recovery/{isolated-recovery-environment,recovery-access-role}.json`.
- `Makefile` (`dr-write`, `dr-check`, `dr-test`, `dr-drill` + `ci`),
  `tools/baseline/registry.mjs` (komponent `disaster-recovery` + 3 checks),
  `release/matrix/{test-matrix,threats}.json` (REQ-DR-001 + 2 trusler),
  `docs/{testing/test-matrix.md, security/threat-model.md, status/implementation-matrix.md}`.

## Testkommandoer og resultater

Kørt i den arbejdsklonede stak (DKC-049 + DKC-042). Alle nedenstående er PASS i
`evidence/`-loggene:

| Kommando | Resultat | Log |
| --- | --- | --- |
| `make validate` | PASS | `evidence/validate.log` |
| `make lint` | PASS | `evidence/lint.log` |
| `make dr-check` | PASS | `evidence/dr-check.log` |
| `make dr-test` | PASS (19 + 8 tests) | `evidence/dr-test.log` |
| `make dr-drill` | PASS (gate `pass`) | `evidence/dr-drill.log` |
| `make backup-check` | PASS | `evidence/backup-check.log` |
| `make backup-test` | PASS (23 + 8 tests) | `evidence/backup-test.log` |
| `make backup-target-check` | PASS | `evidence/backup-target-check.log` |
| `make backup-target-test` | PASS (22 + 11 tests) | `evidence/backup-target-test.log` |
| `make release-check` | PASS (43 krav, matrixversion 1.20.0) | `evidence/release-check.log` |
| `make release-test` | PASS | `evidence/release-test.log` |
| `make architecture-check` | PASS | `evidence/architecture-check.log` |
| `make supply-chain-check` | PASS | `evidence/supply-chain-check.log` |
| `make test` | PASS | `evidence/test.log` |
| `make baseline` | 122 PASS, 1 FAIL, 35 NOT RUN af 158 | `evidence/baseline.log`, `evidence/baseline-summary.txt` |

E2E på en frisk klon med kun pakkens `apply.sh`:

| Kommando | Resultat | Log |
| --- | --- | --- |
| `./dkc-042/apply.sh <clone>/00-core` | PASS | `evidence/e2e-apply.log` |
| `make install` | PASS | `evidence/e2e-install.log` |
| fokuseret kontrol (`validate`, `lint`, `dr-check`, `dr-test`, `release-check`) | PASS | `evidence/e2e-check.log` |
| `make test` | PASS | `evidence/e2e-test.log` |
| træ-diff mod arbejdsklonen | byte-identisk | `evidence/e2e-tree-diff.txt` |

### Baseline

`make baseline` kørte 158 checks: **122 PASS, 1 FAIL, 35 NOT RUN, 0 ERROR**.
Den ene FAIL er den kendte, allerede eksisterende `changelog-check` (ingen DCO
sign-off i historikken, inkl. `83ad91a`); den er hverken "rettet" eller skjult.
Den nye `integration-dr-live` er korrekt NOT RUN med begrundelse. 30 sporede
filer under `modules/*/conformance` blev muteret af baselinekørslen og derefter
genskabt fra et snapshot, så arbejdsklonen er ren for stragglers (verificeret
med `diff -rq`).

## Acceptkriterier

| # | Kriterium | Status | Evidens |
| --- | --- | --- | --- |
| 1 | Primærklyngens driftscredentials kan ikke slette historiske beskyttede backups | **PASS** | `backup/test/dr-access.test.mjs`, `dr-plan.test.mjs`; COMPLIANCE-lås i `storage`; `docs/spec/disaster-recovery.md` |
| 2 | Gendan hele kundepakken i nyt miljø uden fungerende primærcluster | **PASS (model) / NOT RUN (live)** | `backup/test/dr-drill.test.mjs`, `make dr-drill`; `integration-dr-live` NOT RUN (ingen levende klynge) |
| 3 | PITR rammer valgt tidspunkt og data/ACL afstemmes | **PASS (model) / NOT RUN (live PostgreSQL)** | `backup/test/dr-pitr.test.mjs`; `integration-db-failover`/`integration-dr-live` NOT RUN |
| 4 | Tab af primært IAM, DNS og secret-store indgår i recoveryøvelse | **PASS** | `dr-plan`/`dr-drill`-tests; `plan.recoveryEnvironment.dependencies` + `userFlow.includesDependencies` |
| 5 | RPO/RTO måles for samlet brugerflow, ikke kun databaseopstart | **PASS (model, `measured:false`)** | `drill.mjs` (`fullFlowRestoreMs` > `databaseOnlyRtoMinutes`); live måling NOT RUN |

## Ærlige begrænsninger

- Den lokale PITR- og DR-øvelse er en **deterministisk model** på den rigtige
  SQLite-persistens og det rigtige WORM-lager. Rapporten bærer `measured: false`,
  og en målt katastrofeøvelse af hele primærmiljøet på en levende
  PostgreSQL-klynge med rigtige eksterne object stores er `integration-dr-live`
  og **NOT RUN**.
- Object-lock/WORM er efterprøvet mod fillager-modellen og de negative
  håndhævelsestests (DKC-048); en målt verifikation på et rigtigt
  S3-/object-lager er fortsat `integration-immutable-live` (NOT RUN).
- Grundårsagen til den eksisterende `changelog-check`-FAIL (manglende DCO
  sign-off) er ikke en del af DKC-042 og er ikke ændret.
- Juridiske/organisatoriske beslutninger og en uafhængig vurdering er ikke
  en del af denne opgave og er ikke påstået gennemført.

## Review

- **Reviewets base:** `5f9fa73`
- **Undersøgt/implementeret checkout:** `83ad91a` + DKC-001..DKC-049 + dette overlay.
- **Overlay-manifest:** `OVERLAY-MANIFEST.txt` (SHA256, pakkerodrelative stier,
  verificeret med `sha256sum -c`; se `evidence/manifest-verify.log`).
