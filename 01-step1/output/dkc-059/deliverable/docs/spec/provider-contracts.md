# Providerkontrakter og migrationskontrol

Modulet `provider-registry/` og providerudvidelserne i `migration/` gør
dokumenteret udskiftelighed til en **testet egenskab** frem for et generelt
løfte. Platformen kan skifte en provider (IAM, modelprovider, database, lager,
backup, kø eller en applikation) når — og kun når — capability-forhandlingen og
kompatibilitetsmatricen tillader det, og når migrationen er afstemt og kan rulles
tilbage.

## Capability-katalog og versionsforhandling

`provider-registry/capabilities.json` er et versionsstyret katalog. Hver
capability har en klasse, en minimumsversion, og flag for `mandatory` og
`securityCritical`. `provider-registry/providers.json` er registret: hver
provider erklærer klasse, produkt, version/edition, forbindelsesform og de
capabilities den tilbyder med version og niveau (`enforced`/`advisory`).

`migration/src/provider-negotiate.mjs` forhandler:

1. **Alle obligatoriske capabilities** for klassen skal findes i målet. Ellers
   er resultatet `unsupported`, og skiftet stoppes før nogen ændring.
2. **En sikkerhedskritisk capability må ikke nedgraderes.** Hvis kilden havde
   den på niveau `enforced`, skal målet også have den på `enforced` (og mindst
   samme version inden for samme produkt). En manglende capability eller et
   lavere niveau giver `security_capability_missing` /
   `security_downgrade_level`. Kritiske semantikker kan altså **ikke** reduceres
   til laveste fællesnævner.
3. **Ukendte capabilities afvises**, så en provider ikke kan opfinde en
   capability uden for kataloget.

Resultatet er `supported`, `degraded` eller `unsupported` med en begrundelse pr.
problem. Politikken (`provider-registry/policy.json`) tillader ikke en
stiltiende nedgradering.

## Supportmatrix

`provider-registry/support-matrix.json` klassificerer hvert skift som:

- **drop-in** — samme klasse, alle obligatoriske capabilities og
  sikkerhedssemantikker bevares; kun forbindelsen skifter.
- **planned-migration** — datamigrering med id-/ACL-mapping, migrationsbevis,
  afstemning, menneskelig godkendelse og rollback.
- **unsupported** — skiftet bryder en obligatorisk capability eller en
  sikkerhedssemantik, eller der mangler et migrationsbevis.

Et skift uden en eksplicit række afvises (`no_compatibility_row`). Matricen er
den ene kilde til sandhed; koden udleder ikke et skift af produktnavne.

### Drop-in-skift

Et drop-in-skift kræver hverken datamigration eller et migrationsbevis. Det
kræver stadig, at alle obligatoriske capabilities findes og at ingen
sikkerhedskritisk semantik nedgraderes, og at den gamle providers credentials
tilbagekaldes.

### Planlagt datamigration

Et planlagt skift kræver `requiresMigrationProof: true`, id- og ACL-mapping,
en afstemt cutover, en menneskelig godkendelse og en dokumenteret rollback.
Eksempler: lager fra lokalt filsystem til objektlager, database fra SQLite til
PostgreSQL, IAM fra Keycloak til Entra ID og en appmigration.

### Manglende obligatorisk capability

En manglende obligatorisk capability stopper skiftet **før** ændring. Det
gælder også, når forbindelsesstrengen er identisk med kildens: en
forbindelsesstreng — eller et fælles SQL-dialekt — er en påstand, ikke et bevis.
Politikkens `connectionStringNeverBypassesGate` gør det eksplicit, og
`conformance/test/provider-conformance.test.mjs` efterprøver det.

### Ingen fri SQL-udskiftning

Der findes ingen generel påstand om frit skift mellem SQL-motorer. SQLite →
PostgreSQL er en planlagt migration med afstemning og rollback; SQLite → MySQL
er `unsupported`, fordi målet mangler `database.row-tenant-isolation` og ikke
håndhæver kryptering i hvile.

## Preflight

`preflightSwap` kombinerer kompatibilitetsklassificeringen og
capability-forhandlingen til en `ProviderPreflight` med:

- `allowed` og de præcise `problems`,
- `requiredMappings` (data, id'er, ACL, migrationsbevis),
- `cutover` (godkendelse, rollback, read-only, credentialrevokation), og
- `connectionStringMatches` — oplysningen ændrer aldrig `allowed`.

Preflight'en er den port, cutover kalder først. En ikke-tilladt preflight
kaster `preflight_blocked`.

## Backendudskiftning

`migration/src/provider-swap.mjs` mapper hvert kildeobjekt til en deterministisk
mål-id (`map:<sha256>`), men bevarer den **stabile reference**
(`mig:<tenant>:<app>:<entitet>:<kilde-id>`) og sporer den i referencesporet.
ACL, links, klassifikation og data følger med. Afstemningen opgør:

- **antal** (kilde, mappet, oprettet, fejlet),
- **checksums** (sha256 over den projektion der er invariant under id-mapping),
- **links** (hver relation peger på en kendt stabil reference),
- **autorisation** (ACL bevares 1:1), og
- **referencespor** (hver reference er sporet til sit mål).

En verificeret backendudskiftning er kørt deterministisk mod fixturen
`provider-registry/swaps/backend-replacement.json`.

## Appmigration

En appmigration bærer desuden et **funktionstab**
(`provider-registry/swaps/app-migration.json`), så tabt funktionalitet vises før
cutover. En appmigration uden et dækningsbevis afvises; f.eks. er
`nextcloud → bookstack` `unsupported`, fordi de to applikationer har forskellige
entitetssemantikker.

## IAM-skift

Et IAM-skift (`provider-registry/swaps/iam-migration.json`) bevarer:

- **entydig menneskelig/agentidentitet** — hver principal mapper til præcis én
  identitet med samme `kind` (human/agent) og `subject`, og
- **historisk audit-provenance** — hver auditpost fra kilden findes i målet.

Nedgradering af MFA, agentidentitet eller audit-provenance afvises af
capability-forhandlingen.

## Cutover, read-only, credentialrevokation og rollback

En cutover kræver en tilladt preflight, en menneskelig godkendelse af indhold og
adgangsrettigheder (to-personers-kontrol) og et snapshot taget før cutover.
Efter cutover:

1. sættes den **gamle provider read-only**,
2. **tilbagekaldes dens aktive credentials**, mens evidensen bevares, og
3. gemmes en kvittering med rollback-grænsen.

`rollbackSwap` gendanner snapshottet, genåbner den gamle provider og gendanner
id-mapping og rettigheder. `provider-registry/` erklærer `measured: false`; en
faktisk målt udskiftning mod en levende provider kræver ekstern infrastruktur og
er NOT RUN.
