# Eksterne backupmål og målsæt

> DKC-057 · ADR-0040. Kunden skal kunne vælge et uafhængigt backupmål uden at
> miste recoverygarantier — og uden at en connector alene erklærer en ekstern
> kilde beskyttet.

DKC-016 gav en krypteret, verificeret backupbeholder. DKC-057 gør **målet**
konfigurerbart: en backend-kontrakt, en read-only preflight, en særskilt
canary-øvelse og et målsæt der bevarer den gamle recoveryhistorik ved skift.
Modulet ligger i [`backup/`](../../backup).

## Kontrakter

- [`contracts/backup-target.schema.json`](../../contracts/backup-target.schema.json)
  — et mål med `environment`, `targetType` (`object-store`/`sftp`/`nas`/`cloud`),
  `endpoint` (url, region, bucket, pathPrefix), `credentialsRef`, `tls`,
  `encryption`, `retention.immutability`, `schedule`, `bandwidth`,
  `failureDomain` (id + accessDomain) og `recoveryOwner`.
- [`contracts/backup-target-set.schema.json`](../../contracts/backup-target-set.schema.json)
  — per-tenant: `activeTargetRef`, `previousTargets` med `retainedUntil`,
  `primaryFailureDomain` og `externalSources`.

Konfigurerede mål ligger under `backup/targets/` og målsæt under
`backup/target-sets/`. `backup/src/target-check.mjs` validerer både eksempler og
konfiguration og krydsrefererer eksterne kilder mod datatjenesternes register.

## Backend-kontrakt

`backup/src/backends/` har to backends bag samme kontrakt (`headBucket`,
`putObject`, `getObject`, `headObject`, `listObjects`, `deleteObject`,
`capabilities`, `preflight`):

- **`filesystem.mjs`** — et lokalt/monteret mål. Bruges til staging og tests.
- **`s3.mjs`** — et S3-kompatibelt objektlager. Taler den rigtige S3-REST med
  AWS Signature Version 4 (signeret med `node:crypto`), path-style addressing og
  understøttelse af TLS-verifikation, CA-reference, certifikat-pinning og
  minimum TLS-version.

`createBackendForTarget` afbilder en profil til en backend og afviser ukendte
protokoller frem for at falde tilbage til noget uforudsigeligt.

## Preflight (read-only) og canary

- `preflightTarget` opløser `credentialsRef` gennem en injiceret resolver (en
  reference, aldrig en hemmelighed), læser bucket, versionsstyring og
  object-lock/retention og lister målet. Fejl klassificeres som
  `credentials_error`, `certificate_error`, `network_error`, `bucket_not_found`,
  `space_error` eller `retention_error` — og vises **før** profilen godkendes.
- `canaryTarget` skriver en lille fil, læser den tilbage og verificerer digesten
  og sletter den igen. Det er her, plads-/kvotefejl og manglende
  skriverettigheder viser sig. Mod et immutable mål bliver canary-objektet
  tilbageholdt af object-lock (`retained-by-object-lock`), hvilket er forventet.

## Immutabilitet og WORM

Et mål uden **verificeret** WORM må ikke markeres immutable:
`conformance/src/backup.mjs` afviser `mode != none` uden `verified: true` og
`evidenceRef`, og `preflightTarget` afviser et `required: true`-mål når backenden
ikke rapporterer object-lock. Retentionslængden må ikke være kortere end
object-lockets mindsteretention.

## Fejl-/adgangsdomæne

I produktion må det aktive mål ikke dele **både** fejldomæne (`id`) og
adgangsdomæne (`accessDomain`) med det primære miljø. Et mål med et andet
fejldomæne alene er nok til at passere kravet.

## Skift af mål og bevaret historik

`planTargetSwitch` gør det gamle aktive mål til et `previousTarget` med en
`retainedUntil` beregnet ud fra den sidste backup og målets retention. Målet
forlader først sættet når fristen er passeret (eller et navngivet menneske har
godkendt en purge). Dermed bevares den gamle recoveryhistorik.

## Eksterne datakilder

`externalSources` i målsættet erklærer for hver ekstern kilde om dens backup
ligger hos **ejeren** (`owner-backup`), er en **autoriseret platformsbackup**
(`authorized-platform-backup`, kræver en scope-aftale) eller **ikke findes**
(`no-backup`). `externalSourceCoverageProblems` kræver, at enhver ekstern kilde i
datatjenesteregistret har en håndtering: en connector alene erklærer ikke kilden
beskyttet.

## Miljøgrænse

En rigtig S3/MinIO-instans er ikke tilgængelig her. SigV4-klienten og
preflight/canary efterprøves mod en protokolfast test-dobbelt
(`backup/test/support/mock-s3.mjs`), og `integration-backup-external-target` er
registreret som **NOT RUN**.
