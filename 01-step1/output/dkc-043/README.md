# DKC-043 — Indfør sikker deduplikering og kontrolleret oprydning

Kumulativ overlay oven på stak-tippet DKC-042. Lægges med
`./apply.sh <checkout>/00-core`.

- **Reviewets base:** `5f9fa73457d22583b9948611d5cc3afffec4ae38` (`5f9fa73`)
- **Undersøgt checkout:** `83ad91a963d8055f77c29fb4361455689df95acb` (`83ad91a`)
- **Forudsætningskæde:** `dkc-042/apply.sh` → `dkc-049/apply.sh` →
  `dkc-021/apply.sh` → `dkc-048/apply.sh` → `dkc-041/apply.sh` →
  `dkc-039/apply.sh` → `dkc-040/apply.sh` → … → `dkc-001/apply.sh`.
  DKC-043 afhænger formelt af **DKC-006** (tenantadskillelse gennem
  kontrolplanet) og **DKC-042** (uafhængig backup, PITR og
  katastrofegendannelse). Begge er verificeret i den anvendte stak:
  `identity/src/tenant.mjs` + `conformance/src/tenant.mjs`, og
  `backup/src/dr/*.mjs` + `backup/dr/*.json` med WORM-låsen i
  `storage/src/object-store.mjs`.
- **Miljø:** Node v22.22.1. Ingen levende S3/MinIO-instans, ingen ekstern KMS,
  intet Docker/cosign/trivy/kubectl/tofu. De statisk fuldt gennemførlige dele er
  implementeret og efterprøvet over et rigtigt filsystem og en rigtig
  SQLite-backup; den målte effekt på et levende objektlager er NOT RUN.

## Implementeret adfærd

1. **Fire separate dedup-domæner** (`dedup/dedup-policy.json`,
   `contracts/dedup-policy.schema.json`, `contracts/dedup-receipt.schema.json`,
   `dedup/src/policy.mjs`): backupblokke (indholdsadresserede chunks),
   primære objekter (valgfrit med egen validering), jobhændelser (kun
   idempotency-nøgle) og forretningsposter (aldrig flet). Politikken erklærer
   `crossTenantDedup: false`, `primaryDataDedupOptional: true`,
   retention-aware mark-and-sweep, single-writer lease og besparelsesgaten.
2. **Dedupgrænse pr. tenant, krypteringsdomæne og retentionklasse**
   (`dedup/src/store.mjs`, `dedup/src/keys.mjs`): hvert domæne har sin egen
   chunk-namespace og sin egen HKDF-SHA256-afledte AES-256-GCM-nøgle fra et
   eksternt nøglemagasin. Chunk-adressen er `sha256(domainId + ":" + sha256)`,
   så identisk klartekst i to domæner får forskellige adresser og chiffertekster.
   Der deduplikeres aldrig på tværs af kunder.
3. **Indholdsdefineret chunking** (`dedup/src/chunker.mjs`): gear-CDC giver
   grænser fra indholdet, så en indsættelse kun skubber grænser i nærheden af
   ændringen; chunkingen er deterministisk og hver chunk bærer sin sha256.
4. **Konsistent metadata/referencekæde og retention-aware GC**
   (`dedup/src/store.mjs`): hvert snapshot er en ordnet liste af chunk-id'er
   plus en digest; refs tælles op/ned, og `prune` er mark-and-sweep der kun
   sletter urefererede, ikke-beskyttede chunks. Beskyttede snapshots (WORM)
   røres aldrig.
5. **Single-writer lease med fencing-token** (`dedup/src/store.mjs`): prune
   kræver en gyldig lease; en aktiv lease kan ikke overtages, og et gammelt
   token afvises, så to samtidige prunere ikke kan slette hinandens data.
6. **Crash-recovery** (`dedup/src/store.mjs`): intentionen journalføres før
   chunks skrives. `recover()` genopbygger et committet put, dropper et delvist
   put og rydder forældreløse chunk-filer; et crash midt i en prune efterlader
   en genoprettelig tilstand.
7. **Dedup og fuld gendannelse af backupblokke på den gennemprøvede
   backupløsning** (`dedup/src/backup.mjs`): `backup/src/vault.mjs` læses
   komponent for komponent, og `restoreDedupedBackup` genforener og verificerer
   hver komponent mod backup-manifestet, før den skriver gendannelsen.
8. **Valgfri primær dedup og et hårdt forbud mod fletning**
   (`dedup/src/objects.mjs`): primære objekter kræver integritets- og
   restorevalidering plus en navngivet menneskelig godkendelse;
   forretningsposter gemmes hver for sig og flettes aldrig automatisk af
   storage-dedup.
9. **Jobhændelser kun på idempotency-nøgle** (`dedup/src/events.mjs`): tenant +
   begivenheds-id + ressource + version inden for et tidsvindue undertrykkes;
   indholdet flettes aldrig.
10. **Besparelsesgate og receipt** (`dedup/src/measure.mjs`): `savingsActive` er
    kun sand når både integritetskontrollen (scrub) og den fulde restore bestod.
    Et `DedupReceipt` med korruptioner eller en manglende kontrol kan ikke hævde
    en aktiv besparelse.
11. **Konformansvalidering** (`conformance/src/dedup.mjs`,
    `conformance/src/validate-schemas.mjs` afsnit 32): skema plus
    beslutningssemantik for politik og receipts.

`docs/storage/dedup-plan.md` genereres fra politikken med `make dedup-write`, og
`make dedup-check` afviser den, hvis den er ude af trit.

## Ændrede filer

43 filer (0 slettede): se `evidence/deliverable-files.txt`. De vigtigste:

- `dedup/` — `package.json`, `dedup-policy.json`, `src/{chunker,keys,store,backup,objects,events,measure,policy,render,check,cli,index}.mjs`
  og 5 testsuiter.
- `contracts/{dedup-policy,dedup-receipt}.schema.json` + 2 eksempler.
- `conformance/src/dedup.mjs`, `conformance/src/schemas.mjs`,
  `conformance/src/validate-schemas.mjs`,
  `conformance/test/dedup-conformance.test.mjs`.
- `docs/{spec/deduplication.md, runbooks/dedup-garbage-collection.md,
  storage/dedup-plan.md, adr/0052-…md, adr/README.md, spec/README.md}`.
- `Makefile` (`dedup-write`, `dedup-check`, `dedup-test`, `dedup-drill` + `ci`),
  `tools/baseline/registry.mjs` (komponent `deduplication` + 4 checks),
  `release/matrix/{test-matrix,threats}.json` (REQ-DEDUP-001 + 2 trusler),
  `docs/{testing/test-matrix.md, security/threat-model.md,
  status/implementation-matrix.md, status/supply-chain.md}`,
  `release/{artifacts.json, sbom/platform-sbom.cdx.json}`.

## Testkommandoer og resultater

Kørt i den arbejdsklonede stak (DKC-042 + DKC-043). Alle nedenstående er PASS i
`evidence/`-loggene:

| Kommando | Resultat | Log |
| --- | --- | --- |
| `make validate` | PASS | `evidence/validate.log` |
| `make lint` | PASS | `evidence/lint.log` |
| `make dedup-check` | PASS | `evidence/dedup-check.log` |
| `make dedup-test` | PASS (31 + 4 tests) | `evidence/dedup-test.log` |
| `make dedup-drill` | PASS (målt, gate `pass`) | `evidence/dedup-drill.log` |
| `make backup-check` | PASS | `evidence/backup-check.log` |
| `make backup-test` | PASS (23 + 8 tests) | `evidence/backup-test.log` |
| `make storage-check` | PASS | `evidence/storage-check.log` |
| `make storage-test` | PASS (26 + 7 tests) | `evidence/storage-test.log` |
| `make release-check` | PASS (44 krav, matrixversion 1.21.0) | `evidence/release-check.log` |
| `make release-test` | PASS | `evidence/release-test.log` |
| `make architecture-check` | PASS | `evidence/architecture-check.log` |
| `make supply-chain-check` | PASS (efter `make supply-chain-sbom`) | `evidence/supply-chain-check.log` |
| `make supply-chain-test` | PASS | `evidence/supply-chain-test.log` |
| `make test` | PASS (278 tests) | `evidence/test.log` |
| `make baseline` | 125 PASS, 1 FAIL, 36 NOT RUN af 162 | `evidence/baseline.log`, `evidence/baseline-summary.txt` |

E2E på en frisk klon med kun pakkens `apply.sh`:

| Kommando | Resultat | Log |
| --- | --- | --- |
| `./dkc-043/apply.sh <clone>/00-core` | PASS | `evidence/e2e-apply.log` |
| `make install` | PASS | `evidence/e2e-install.log` |
| fokuseret kontrol (`validate`, `lint`, `dedup-check`, `dedup-test`, `dedup-drill`, `release-check`) | PASS | `evidence/e2e-check.log` |
| `make test` | PASS | `evidence/e2e-test.log` |
| træ-diff mod arbejdsklonen | byte-identisk | `evidence/e2e-tree-diff.txt` |

### Baseline

`make baseline` giver **125 PASS, 1 FAIL, 36 NOT RUN, 0 error af 162 checks**.
Den ene FAIL er den kendte, forudgående **`changelog-check`**: commits i
checkoutet mangler DCO sign-off (også `83ad91a`). Den er ikke "rettet" eller
skjult, og den optræder uændret i `evidence/baseline.log`. De tre nye
real-/contract-checks (`dedup-check`, `dedup-test`, `dedup-drill`) er PASS, og
`integration-dedup-live` er NOT RUN med en præcis begrundelse. Baseline muterer
som vanligt 30 sporede filer under `modules/*/conformance`; snapshottet blev
gendannet bagefter, og `diff -rq` viste ingen afvigelser.

## Acceptkriterier

| # | Kriterium | Resultat | Evidens |
| --- | --- | --- | --- |
| 1 | Mål logiske/fysiske bytes og fuld restore efter dedup | PASS | `dedup/test/store.test.mjs`, `dedup/test/backup.test.mjs`, `make dedup-drill` |
| 2 | Sletning af én reference ødelægger ikke en anden eller en beskyttet backup | PASS | `dedup/test/store.test.mjs` (refs + beskyttet snapshot overlever prune) |
| 3 | Crash midt i indeks/prune efterlader genoprettelig tilstand | PASS | `dedup/test/store.test.mjs` (fault-injection + `recover()`) |
| 4 | Korrupt chunk opdages; berørte snapshots vises | PASS | `dedup/test/store.test.mjs` (`scrub().affectedSnapshots`) |
| 5 | Forretningsdubletter flettes aldrig automatisk af storage-dedup | PASS | `dedup/test/objects-events.test.mjs`, policy-semantik |
| 6 | Besparelse aktiveres kun hvis integrity- og restoretests består | PASS | `dedup/test/backup.test.mjs`, `dedup/src/measure.mjs`, `conformance/test/dedup-conformance.test.mjs` |
| 7 | Dedupgrænse pr. tenant/krypteringsdomæne/retentionklasse; ingen tværkunde som standard | PASS | `dedup/src/store.mjs`, `dedup/test/store.test.mjs`, `dedup/test/policy.test.mjs` |
| 8 | Målt dedup-effekt på et levende objektlager | **NOT RUN** | `integration-dedup-live` — ingen levende S3/MinIO eller ekstern KMS i miljøet |

## Leverancer

1. **Separat design for backupblokke, primære objekter, jobhændelser og
   forretningsposter** — PASS: fire domæner i politik, kode og spec.
2. **Gennemprøvet backupløsning; primær dedup valgfrit og med egen validering**
   — PASS: `backup/src/vault.mjs` genbruges; primær dedup er slået fra og kræver
   integritet + restore + menneskelig godkendelse.
3. **Dedupgrænse pr. tenant, krypteringsdomæne og retentionklasse; ingen
   tværkundededuplikering som standard** — PASS.
4. **Konsistent metadata/referencekæde, retention-aware GC og single-writer
   lease for prune** — PASS.

## Grænser og resterende arbejde

- En **målt** delingsgrad, krypteringsydelse og oprydning på et rigtigt
  S3-/MinIO-objektlager med en ekstern KMS er NOT RUN
  (`integration-dedup-live`); den kræver uafhængig driftsverifikation.
- Dedup af primærdata er bevidst slået fra; at slå den til kræver en
  ejerbesluttet, versionsstyret politikændring, en bestået integritets- og
  restorevalidering og en navngivet menneskelig godkendelse.
- Forretningsdubletter kræver fortsat en ejerbesluttet, versionsstyret
  sammensmeltning uden for dedup-laget.
- `changelog-check` forbliver den ene kendte FAIL (manglende DCO sign-off).

## Verifikation

Manifestet er selvkonsistent: alle hashes i `OVERLAY-MANIFEST.txt` er
verificeret med `sha256sum -c` (se `evidence/manifest-verify.log`, der ikke
indeholder sin egen linje). `evidence/e2e-tree-diff.txt` viser, at en frisk
klon med kun denne pakkes `apply.sh` er byte-identisk med arbejdsklonen.
