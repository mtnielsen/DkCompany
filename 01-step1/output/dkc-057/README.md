# DKC-057 — Gør eksterne backupmål konfigurerbare og testbare (leverance)

Implementering af **DKC-057** for `mtnielsen/DkCompany`. Bygger på DKC-001 ..
DKC-016. `00-core/` i det faktiske repo er fortsat **ikke ændret**; alt ligger
under `01-step1/output/dkc-057/`.

- **Reviewets base:** `5f9fa73457d22583b9948611d5cc3afffec4ae38` (`5f9fa73`)
- **Undersøgt checkout:** `83ad91a963d8055f77c29fb4361455689df95acb` (`83ad91a`)
- **Forudsætnings-overlays:** `dkc-016` → `dkc-020` → `dkc-024` → `dkc-023` →
  `dkc-064` → … → `dkc-001` (kædes af `apply.sh`)
- **Miljø:** Node v22.22.1. Ingen rigtig S3/MinIO, ingen ekstern host, intet
  Docker/kubectl/tofu.

## Forudsætninger og valg

DKC-057 afhænger formelt af **DKC-016, DKC-019, DKC-053 og DKC-056**.
Forudsætningerne er verificeret i kode, ikke i et statusfelt:

- `backup/` (DKC-016) giver den krypterede beholder, `manifest.json` og
  `components/*.enc`, som et eksternt mål skal bære.
- `data-services/src/secrets.mjs` (DKC-056) giver secretreferencer på formen
  `<provider>:<sti>`; `data-services/src/recovery.mjs` og
  `data-services/sources/*.json` giver den eksterne-kildepolitik
  (`autoBackup:false`, `treatAsOwnDatabase:false`).
- `distribution/` (DKC-053) og `continuity/service-classes/` (DKC-037) giver
  henholdsvis den validerede katalogmodel og RPO-/RTO-målene.
- `compliance/` (DKC-019) giver dataregisteret og ejerskabet for kilderne.

Der fandtes **ingen** backend-kontrakt, **ingen** preflight/canary, **ingen**
verificeret-WORM-adskillelse, **ingen** fejl-/adgangsdomænekontrol og **intet**
målsæt der bevarer historik ved skift. Opgaven er miljøblokeret på én akse: der
findes ingen rigtig S3/MinIO-instans. Valget var at implementere hele
mekanikken **rigtigt** og efterprøve den mod en protokolfast S3-testdobbelt,
mens den rigtige instans registreres ærligt som **NOT RUN**.

## Implementeret adfærd

1. **Backend-kontrakt med to backends.** `backup/src/backends/filesystem.mjs`
   (lokalt/monteret mål) og `backup/src/backends/s3.mjs` (S3-REST med AWS
   SigV4 signeret via `node:crypto`, path-style addressing, TLS-verifikation,
   CA-reference, certifikat-pinning og minimum TLS-version).
   `createBackendForTarget` afviser ukendte/ikke-validerede protokoller.
2. **Konfiguration.** `contracts/backup-target.schema.json` (endpoint, region,
   credentials-reference, kryptering, retention, schedule, båndbredde,
   immutabilitet, fejl-/adgangsdomæne, recoveryejer) og
   `contracts/backup-target-set.schema.json` (aktivt mål, `previousTargets`,
   `primaryFailureDomain`, `externalSources`). Konfigurerede mål og målsæt
   ligger i `backup/targets/` og `backup/target-sets/`.
3. **Read-only preflight og særskilt canary.** `backup/src/targets.mjs`
   klassificerer credentials-, certifikat-, netværks-, plads-, retention- og
   capability-fejl i `preflightTarget`; `canaryTarget` skriver/læser/sletter en
   lille fil og rapporterer `retained-by-object-lock` mod et immutable mål.
4. **Immutable kun ved verificeret WORM.** `conformance/src/backup.mjs` afviser
   en object-lock-tilstand uden `verified: true` + evidens, og
   `preflightTarget` afviser et `required:true`-mål når backenden ikke
   rapporterer object-lock.
5. **Eksterne datakilder.** `externalSources` erklærer `owner-backup`,
   `authorized-platform-backup` (kræver scope-aftale) eller `no-backup`.
   `externalSourceCoverageProblems` kræver, at enhver ekstern kilde i
   datatjenesteregistret har en håndtering — en connector erklærer ikke kilden
   beskyttet.
6. **Bevaret recoveryhistorik ved skift.** `planTargetSwitch` gør det gamle mål
   til et `previousTarget` med `retainedUntil = sidste backup + retentionDays`,
   og `canPurgePreviousTarget` afgør hvornår det må fjernes.

## Ændrede filer

Se `evidence/logs/deliverable-files.txt` (35 filer). Hovedparten er
`backup/src/backends/` + `backup/src/targets.mjs`, to kontrakter med tre
eksempler, konfiguration under `backup/targets/` og `backup/target-sets/`,
`conformance/src/backup.mjs` + test, Makefile-mål (`backup-target-check/-test/
-preflight/-canary`), baseline-registeret, testmatrixen (1.9.0), ADR-0040 samt
spec og runbook.

## Testkommandoer og resultater

| Kommando | Resultat |
| --- | --- |
| `make validate` | PASS (61 skemaer; 2 nye mål-kontrakter) |
| `make lint` | PASS |
| `make backup-check` / `backup-test` | PASS (23 + 8 tests, DKC-016 uden regression) |
| `make backup-target-check` | PASS (skema + semantik + ekstern-kilde-dækning) |
| `make backup-target-test` | PASS (22 backup-tests + 11 conformance-tests) |
| `make backup-target-preflight` | PASS (read-only mod lokalt mål) |
| `make backup-target-canary` | PASS (skriv/læs/slet) |
| `make continuity-check` / `continuity-test` | PASS (21 + 6 tests) |
| `make release-check` / `release-test` | PASS (32 krav, matrix 1.9.0; 27 + 5 tests) |
| `make supply-chain-check` / `supply-chain-test` | PASS (31 tests) |
| `make test` | PASS (189 conformance-tests) |
| `make baseline` | 94 pass, 1 fail (kendt `changelog-check`), 20 not run af 115 |

Logfiler ligger i `evidence/logs/`; den fulde baseline (115 checks) i
`evidence/baseline/`.

## Acceptkriterier

| Kriterium | Status | Evidens |
| --- | --- | --- |
| Backup og restore fungerer fra anden host med primærmiljøet slukket | **PASS (separat mål, lokal beholder slettet) / NOT RUN (rigtig anden host/S3)** | `targets.test.mjs`: backup → synk til målet → slet den lokale beholder → hent → isoleret restore med alle funktionelle checks grønne. `integration-backup-external-target` er NOT RUN. |
| Fejl i credentials, certifikat, plads eller retention vises før profilen godkendes | **PASS** | `targets.test.mjs` (credential-fejl, WORM-krav), `s3-backend.test.mjs` (ubetroet certifikat → `certificate_error`, betroet CA accepteres; `space_error`), conformance-testene. |
| Backend uden verificeret WORM markeres ikke immutable | **PASS** | `backup-target-conformance.test.mjs` (WORM-krav uden `verified` afvises) og `targets.test.mjs` (preflight afviser `required:true` uden object-lock). |
| Tilsluttet ekstern datakilde erklæres ikke beskyttet alene fordi en connector virker | **PASS** | `externalSourceCoverageProblems` + `make backup-target-check` (manglende håndtering og forkert scope-aftale afvises). |
| Backupstien må ikke ligge i samme eneste fejl-/adgangsdomæne i produktionsprofilen | **PASS** | `planTargetSwitch` og `backupTargetSetProblems` afviser samme `id` **og** `accessDomain`; et andet fejldomæne alene passerer. |
| Skift af backupmål bevarer gammel recoveryhistorik indtil vedtaget retention er opfyldt | **PASS** | `target-switch.test.mjs`: gammelt mål bevares med `retainedUntil` i fremtiden, kan ikke purges, og forlader først sættet når fristen er passeret (eller ved navngivet purge-godkendelse). |

## Resterende begrænsninger

- **Rigtigt S3/MinIO NOT RUN.** SigV4-klienten og preflight/canary er efterprøvet
  mod en protokolfast test-dobbelt (`backup/test/support/mock-s3.mjs`); en rigtig
  instans kræver ekstern infrastruktur og credentials
  (`integration-backup-external-target`).
- **Rigtig anden host NOT RUN.** Filsystem-backenden efterprøves mod et separat
  mål og en slettet lokal beholder; en rigtig anden host/NAS kræver ekstern
  infrastruktur.
- Nøgleprovideren er fil-/in-memory-baseret; i drift leveres nøglen af en
  KMS/secret-store med samme `getKey`/`keyId`-kontrakt.
- Den forudgående `changelog-check`-FAIL (manglende DCO sign-off, inkl.
  `83ad91a`) er dokumenteret og ikke ændret i denne opgave.

## Verifikation af pakken

- `OVERLAY-MANIFEST.txt` dækker `deliverable/`, `evidence/`, `README.md` og
  `apply.sh` med SHA256 og pakkerod-relative stier; verificeret med
  `sha256sum -c`.
- `apply.sh` er kørt end-to-end på et friskt `83ad91a`-klon; træet er
  byte-identisk med arbejdsklonen, og de fokuserede checks er grønne.
- Deliverable-sættet er beregnet ved at diffe arbejdstræet mod et referenceklon
  med kun `dkc-016/apply.sh` lagt (walk af alle filer, `node_modules`,
  `.conformance-out` og `.git` undtaget). Kørsels-muterede fixtures
  (`modules/*/conformance/**`, 30 filer) er gendannet fra referenceklonen.
