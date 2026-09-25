# Krypteret backup og gendannelse

> DKC-016 · ADR-0039. Backup skal kunne gendanne et brugbart system med
> konsistente data og rettigheder — og en øvelse skal **måle** tid og datatab.

DKC-008 gav en konsistent SQLite-snapshot med verificeret restore, og DKC-037
gav serviceklasser med RPO-/RTO-mål. DKC-016 samler dem i et selvstændigt
[`backup/`](../../backup)-modul: database, objekter og nødvendig konfiguration
krypteres hver for sig, nøglen holdes i et **andet** magasin, gendannelsen sker i
et isoleret miljø, og en suppressionsjournal forhindrer at slettede persondata
genindføres.

## Krypteret beholder

`backup/src/vault.mjs` skriver en backup som en mappe:

- `manifest.json` — metadata, komponenter, checksums og nøgle-id,
- `components/*.enc` — AES-256-GCM-krypterede komponenter.

Hver komponent krypteres med en AAD på formen `backupId:kind:name`, så en
komponent ikke kan byttes om med en anden. Manifestet bærer både
klartekst-digesten (`sha256`) og chiffertekst-digesten (`ciphertextSha256`) pr.
komponent samt en samlet `checksums.manifestDigest`. Ved læsning verificeres
chifferteksten, dekrypteres, og klarteksten efterprøves mod digesten. En ændret
chiffertekst eller et ændret manifest afvises.

Backupen validerer mod
[`contracts/backup-manifest.schema.json`](../../contracts/backup-manifest.schema.json).
Databasen tages med SQLite's egen online-backup gennem
`persistence/src/backup.mjs`, så skrivere ikke blokeres.

## Separat nøgleadgang

`backup/src/keys.mjs` læser nøglen fra et magasin uden for backup-lageret
(`createFileKeyProvider({ keyDir })`) eller fra en kortlivet, in-memory provider
til jobprocesser. En provider rapporterer eksplicit `storeContainsKey: false`, og
manifestets `encryption.keySeparated` er `true`. En operatør med adgang til
backup-lageret kan derfor ikke dekryptere indholdet uden nøglen.

## Sletninger overlever en gendannelse

`backup/src/suppression.mjs` er en append-only, hash-kædet journal med poster
`{tenantId, digest, subjectKey, erasedAt, reason}`. Den ligger **uden for**
backup-lageret. Backup-manifestet pinner journalens hoved
(`suppression.ledgerDigest`), så en trunkeret journal afvises. Ved gendannelse
anvendes kun poster med `erasedAt` efter backupens skæringstidspunkt: for hver
post ryddes `audit_personal.payload`, `subject_key` og sættes `erased_at`.
Dermed genindføres persondata slettet efter backupen ikke ukontrolleret.

## Isoleret gendannelse og funktionelle checks

`backup/src/restore.mjs` gendanner til en **tom** målmappe og kører derefter:

- `database-integrity` — `PRAGMA integrity_check` på den gendannede database,
- `audit-chain` — `createSqliteAuditLog(...).verifyChain()`,
- `tenant-isolation` — tenant-viewet må kun vise tenantens egne rækker,
- `audit-checkpoint` — når en ekstern checkpoint-store er konfigureret,
  verificeres den gendannede log mod det eksterne checkpoint (DKC-009).

## Målt RPO/RTO og release-gate

`backup/src/drill.mjs` kører en fuld øvelse:

- **RTO** = gendannelsens varighed fra restore starter til de funktionelle checks
  er kørt.
- **RPO** = afstanden mellem den seneste committede skrivning
  (`latestWriteAt`) og backupens skæringstidspunkt.

Rapporten validerer mod
[`contracts/restore-drill.schema.json`](../../contracts/restore-drill.schema.json),
og `gate.status` bliver `blocked` med en begrundelse pr. afvigelse: manglende
integritet, fejlede funktionelle checks, manglende suppression, manglende
tenant-afgrænsning, brudt audit-kæde eller RTO/RPO over mål. En `pass`-gate kan
pr. kontrakt ikke bære nogen afvigelse.

## Autorisation

`backup/src/authz.mjs` er default-deny:

- kun et **verificeret menneske** i tenanten kan tage backup eller gendanne,
- backup kræver rollen `backup-operator`/`continuity-officer`,
- gendannelse kræver `continuity-officer` **og** en separat, navngivet
  godkendelse bundet til backup-id'et (to-personers-princippet).

## Miljøgrænse

Øvelsen kører rigtigt mod den lokale SQLite-persistens. En produktionsøvelse med
tab af den **primære** database kræver en levende klynge, en ekstern database og
et navngivet menneskes godkendelse. Den er derfor registreret som `integration`
og **NOT RUN** i dette miljø (`integration-backup-production-drill`).
