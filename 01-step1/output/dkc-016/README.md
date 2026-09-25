# DKC-016 — Bevis backup og gendannelse (leverance)

Implementering af **DKC-016** for `mtnielsen/DkCompany`. Bygger på DKC-001 ..
DKC-020. `00-core/` i det faktiske repo er fortsat **ikke ændret**; alt ligger
under `01-step1/output/dkc-016/`.

- **Reviewets base:** `5f9fa73457d22583b9948611d5cc3afffec4ae38` (`5f9fa73`)
- **Undersøgt checkout:** `83ad91a963d8055f77c29fb4361455689df95acb` (`83ad91a`)
- **Forudsætnings-overlays:** `dkc-020` → `dkc-024` → `dkc-023` → `dkc-064` →
  `dkc-018` → `dkc-015` → … → `dkc-001` (kædes af `apply.sh`)
- **Miljø:** Node v22.22.1. Ingen levende klynge, ingen ekstern database, intet
  Docker/cosign/trivy/tofu/kubectl.

## Forudsætninger og valg

DKC-016 afhænger formelt af **DKC-013** (genoptagelig, idempotent eksekvering)
og **DKC-015** (infrastruktur og miljøadskillelse). Forudsætningerne er
verificeret i kode, ikke i et statusfelt:

- `persistence/src/backup.mjs` (DKC-008) tager en konsistent SQLite-snapshot med
  verificeret restore og rækkeantal — den genbruges uændret.
- `persistence/src/adapters/job-queue.mjs` og `jobs/` (DKC-013) giver holdbare,
  idempotente job; `persistence/src/migrations.mjs` giver versionsstyrede
  migrationer.
- `continuity/service-classes/*.service-class.json` (DKC-037) bærer de vedtagne
  RPO-/RTO-mål og `backup`-felterne (`required`, `offsite`, `encrypted`,
  `restoreTested`), som øvelsen måler imod.
- `persistence/src/checkpoint.mjs` (DKC-009) giver et eksternt, HMAC-signeret
  audit-checkpoint uden for databasen.
- `audit_personal` (migration v3) adskiller personhenførbare payloads med egen
  retention og `erased_at` — det er den tabel suppressionsjournalen rydder.

Der fandtes **ingen** krypteret backup, **ingen** separat nøgleadgang, **ingen**
kontrol af slettede persondata ved restore og **ingen** målt RPO/RTO. Opgaven er
delvist miljøblokeret: der findes ingen produktionsklynge eller ekstern
database. Valget var at implementere hele processen **rigtigt** og efterprøve
den mod den lokale, rigtige SQLite-persistens, mens en produktionsøvelse med tab
af den primære database registreres ærligt som **NOT RUN**.

## Implementeret adfærd

1. **Krypteret beholder med separat nøgleadgang.** `backup/src/vault.mjs`
   krypterer database, objekter og nødvendig konfiguration hver for sig med
   AES-256-GCM og AAD-binding til `backupId:kind:name`.
   `backup/src/keys.mjs` læser nøglen fra et magasin **uden for** backup-lageret
   (`createFileKeyProvider`), og manifestet erklærer `keySeparated: true` /
   `storeContainsKey: false`. `manifest.json` bærer klartekst- og
   chiffertekst-SHA-256 pr. komponent samt en samlet manifestdigest. Et ændret
   manifest eller en ændret chiffertekst afvises. Hemmeligheder i
   konfigurationen redigeres væk før kryptering.
2. **Sletninger overlever en gendannelse.** `backup/src/suppression.mjs` er en
   append-only, hash-kædet journal uden for backupen. Manifestet pinner dens
   hoved, så en trunkeret journal afvises. Ved gendannelse ryddes
   `audit_personal.payload`/`subject_key` og sættes `erased_at` for de poster,
   der blev slettet **efter** backupens skæringstidspunkt. Dermed genindføres
   slettede persondata ikke ukontrolleret.
3. **Isoleret gendannelse med funktionelle checks.** `backup/src/restore.mjs`
   gendanner til en tom, isoleret mappe og kører `database-integrity`,
   `audit-chain`, `tenant-isolation` og — når den findes — `audit-checkpoint`
   mod det eksterne checkpoint.
4. **Målt RPO/RTO med release-gate.** `backup/src/drill.mjs` måler RTO
   (gendannelsestid) og RPO (afstand mellem seneste committede skrivning og
   backupens skæringstid) og sætter `gate.status` til `blocked` med en
   begrundelse ved enhver afvigelse. En `pass`-gate kan pr. kontrakt ikke bære
   nogen afvigelse.
5. **Default-deny autorisation og to-personers-godkendelse.**
   `backup/src/authz.mjs` tillader kun et verificeret menneske i tenanten; backup
   kræver `backup-operator`/`continuity-officer`, og gendannelse kræver
   `continuity-officer` **og** en separat, navngivet godkendelse bundet til
   backup-id'et. Agenter, demo-identiteter, fremmed tenant og samme
   godkender/udfører afvises.
6. **Kontrakter og semantisk validator.**
   `contracts/backup-manifest.schema.json` og
   `contracts/restore-drill.schema.json` med eksempler; `conformance/src/backup.mjs`
   afviser bl.a. nøgle i lageret, manglende databasekomponent, en `pass`-gate
   med fejlet check eller RTO/RPO over mål og en `blocked`-gate uden begrundelse.

## Ændrede filer

Se `evidence/logs/deliverable-files.txt` (39 filer). Hovedparten er det nye
`backup/`-modul (8 kildefiler, 7 testfiler + fixture), to kontrakter med
eksempler, `conformance/src/backup.mjs` + test, Makefile-mål (`backup-check`,
`backup-test`, `backup-drill`), baseline-registeret, testmatrixen (1.8.0),
regenereret SBOM/artefaktmanifest, ADR-0039 samt spec og runbook.

## Testkommandoer og resultater

| Kommando | Resultat |
| --- | --- |
| `make validate` | PASS (59 skemaer, 63 eksempler; 2 nye backup-kontrakter) |
| `make lint` | PASS |
| `make backup-check` | PASS (skema + semantik) |
| `make backup-test` | PASS (24 backup-tests + 8 conformance-tests) |
| `make backup-drill` | PASS (krypteret backup → isoleret restore → RPO/RTO → gate pass) |
| `make continuity-check` / `continuity-test` | PASS (21 + 6 tests, ingen regression) |
| `make persistence-check` / `persistence-test` | PASS (56 tests, ingen regression) |
| `make release-check` / `release-test` | PASS (31 krav, matrix 1.8.0; 27 + 5 tests) |
| `make supply-chain-check` / `supply-chain-test` | PASS (regenereret SBOM; 31 tests) |
| `make test` | PASS (178 conformance-tests) |
| `make baseline` | 92 pass, 1 fail (kendt `changelog-check`), 19 not run af 112 |

Logfiler ligger i `evidence/logs/`; den fulde baseline (112 checks) i
`evidence/baseline/`.

## Acceptkriterier

| Kriterium | Status | Evidens |
| --- | --- | --- |
| Data, rettigheder og audit kan verificeres efter restore | **PASS** | `backup/test/restore.test.mjs`: `database-integrity`, `tenant-isolation` (tenant-viewet viser kun tenantens egne rækker) og `audit-chain` samt `audit-checkpoint` mod det eksterne checkpoint. |
| Tab af primær database dækkes af en gennemført øvelse | **PASS (lokal primær SQLite) / NOT RUN (produktionsklynge)** | `backup/test/drill.test.mjs` + `make backup-drill`: en rigtig backup tages, gendannes i isoleret miljø og verificeres. `integration-backup-production-drill` er NOT RUN (ingen levende klynge/ekstern database). |
| Slettede persondata genindføres ikke ukontrolleret efter restore | **PASS** | `backup/test/restore.test.mjs`: en sletning efter backupen rydder `audit_personal`; en sletning før backupen giver intet at rydde; en trunkeret journal afvises. |
| Tid og datatab måles; afvigelser spærrer pilotrelease | **PASS** | `backup/test/drill.test.mjs`: for stramt RTO- og RPO-mål giver `gate.status = blocked` med begrundelse; `conformance/test/backup-conformance.test.mjs` afviser en `pass`-gate over mål. |

## Resterende begrænsninger

- **Produktionsøvelse NOT RUN.** Tab af den primære database på en levende
  klynge kræver ekstern infrastruktur, en rigtig database og et navngivet
  menneskes godkendelse; det kan ikke udledes af en lokal kørsel.
  `integration-backup-production-drill` registrerer det ærligt.
- Øvelsen er kørt mod SQLite-persistensen. En PostgreSQL-baseret produktionsvej
  skal bruge samme kontrakter, men driveren er ikke installeret her
  (`integration-postgresql` NOT RUN).
- Nøgleprovideren er fil-/in-memory-baseret; i drift leveres nøglen af en
  KMS/secret-store med samme `getKey`/`keyId`-kontrakt.
- Objektbackup'en dækker førsteparts objektfiler; en ekstern objektbutik kræver
  en eksplicit scope-aftale (jf. DKC-056).
- Den forudgående `changelog-check`-FAIL (manglende DCO sign-off, inkl.
  `83ad91a`) er dokumenteret og ikke ændret i denne opgave.

## Verifikation af pakken

- `OVERLAY-MANIFEST.txt` dækker `deliverable/`, `evidence/`, `README.md` og
  `apply.sh` med SHA256 og pakkerod-relative stier; verificeret med
  `sha256sum -c`.
- `apply.sh` er kørt end-to-end på et friskt `83ad91a`-klon; træet er
  byte-identisk med arbejdsklonen, og de fokuserede checks er grønne.
- Deliverable-sættet er beregnet ved at diffe arbejdstræet mod et referenceklon
  med kun `dkc-020/apply.sh` lagt (walk af alle filer, `node_modules`,
  `.conformance-out` og `.git` undtaget); den nye `backup/`-mappe er gennemgået
  rekursivt. Kørsels-muterede fixtures (`modules/*/conformance/**`, 30 filer) er
  gendannet fra referenceklonen.
