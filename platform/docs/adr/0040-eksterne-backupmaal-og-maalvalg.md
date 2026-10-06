# ADR-0040 — Eksterne backupmål med preflight, canary og bevaret recoveryhistorik

- **Status:** accepteret
- **Beslutningstagere:** Platform Owner, Kontinuitetsansvarlig
- **Dato:** 2026-09-23
- **Beslutningsdrev:** DKC-016 gjorde backupen krypteret og gendannelsen verificeret, men backupmålet var en lokal mappe. Kunden skal kunne vælge et uafhængigt eksternt mål uden at miste recoverygarantier — og uden at en connector alene erklærer en ekstern kilde beskyttet.

## Kontekst og problemstilling

Et backupmål er en sikkerhedsgrænse: det skal ligge i et andet fejl- og
adgangsdomæne end primæret, nøglen må ikke følge med data, og et mål uden
verificeret WORM må ikke kaldes immutable. Samtidig skal fejl i credentials,
certifikat, plads eller retention vise sig **før** en profil godkendes, og et
skift af mål må ikke kaste den gamle recoveryhistorik væk.

## Beslutningskriterier

- Mindst én understøttet ekstern objektlagerprofil bag en fælles backend-kontrakt.
- Credentials er en reference, aldrig en hemmelighed.
- Read-only preflight hvor muligt; canary (skriv/læs/slet) særskilt markeret.
- Immutabilitet kræver verificeret WORM med evidens.
- Produktion kræver TLS-verifikation og et andet fejl-/adgangsdomæne.
- Et skift bevarer den gamle historik til retentionen er opfyldt.
- Eksterne datakilder har en eksplicit håndtering.

## Overvejede muligheder

- **A:** Lade hvert mål implementere sin egen klient og godkendelseslogik.
- **B:** Kun understøtte ét cloud-mål og afvise alt andet.
- **C:** En fælles backend-kontrakt med filsystem- og S3-backends, en read-only
  preflight, en særskilt canary, et målsæt med `previousTargets` og en
  krydsreference mod datatjenesternes eksterne kilder.

## Beslutning

Vi indfører (C). `contracts/backup-target.schema.json` og
`contracts/backup-target-set.schema.json` beskriver mål og målsæt.
`backup/src/backends/` har `filesystem` og S3 (SigV4). `backup/src/targets.mjs`
implementerer `preflightTarget` (read-only, klassificerede fejl),
`canaryTarget` (skriv/læs/slet), `syncBackupToTarget`/`fetchBackupFromTarget` og
`planTargetSwitch` (bevaret historik). `conformance/src/backup.mjs` håndhæver
WORM-, TLS-, domæne- og kildesemantikken.

### Konsekvenser

- **Positive:** Målet er konfigurerbart og efterprøvet før godkendelse; WORM
  kaldes kun immutable når det er verificeret; historik og eksterne kilder
  håndteres eksplicit.
- **Negative:** En rigtig S3/MinIO-instans kræver ekstern infrastruktur og
  credentials og er derfor NOT RUN her.
- **Neutrale:** Filsystem-backenden bruges fortsat til staging og tests.

## Fordele og ulemper ved mulighederne

| Mulighed | Fordele | Ulemper |
| --- | --- | --- |
| A | Fuld fleksibilitet | Inkonsistent godkendelse, let at springe preflight over |
| B | Simpelt | Låser kunden til én udbyder |
| C | Fælles kontrakt, ærlig WORM/TLS/domæne, bevaret historik | Kræver en ekstern instans for fuldt driftsbevis |

## Mere information

- `docs/spec/backup-targets.md`
- `docs/runbooks/backup-targets.md`
- `backup/src/backends/`, `backup/src/targets.mjs`
- `contracts/backup-target.schema.json`, `contracts/backup-target-set.schema.json`
- ADR-0019 (holdbar tilstand), ADR-0037 (serviceklasser), ADR-0039 (krypteret backup)
