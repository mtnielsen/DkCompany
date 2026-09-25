# Providerkontrakter og migrationskontrol

- **Status:** accepteret
- **Beslutningstagere:** Anna Andersen (Platform Owner), Cecilia Christensen (Security Owner)
- **Dato:** 2026-10-05
- **Beslutningsdrev:** DKC-059 kræver, at dokumenteret udskiftelighed bliver en testet egenskab: versionsforhandling af capabilities for IAM, modelprovider, databaser, storage, backup, kø og apps, en supportmatrix over drop-in/planlagt/ikke-understøttet skift, én verificeret backendudskiftning og én appmigration med afstemning af data, ACL, id-mapping og funktionstab, samt cutover med reconciliation, rollback, read-only gammel provider og credentialrevokation.

## Kontekst og problemstilling

Platformen har en fælles adapter-SDK (DKC-023), en evalueret
integrationskandidat pr. adapter, en fail-closed dependency-resolver (DKC-053)
og indbyggede/eksterne datatjenester (DKC-056). Migrationsværktøjerne (DKC-031)
dækker appindhold. Der mangler imidlertid et **providerlag**: hvordan
afgøres det, om en database, et lager, en IAM, en kø, en modelprovider eller en
app kan skiftes? I dag ville et skift blive afgjort af en forbindelsesstreng
eller et produktnavn — en påstand, ikke et bevis. En naiv udskiftning kan
nedgradere en sikkerhedskritisk capability til laveste fællesnævner, tabe ACL,
links eller referencespor, tvetydiggøre en agentidentitet, slette historisk
audit eller efterlade aktive rettigheder hos den gamle provider.

## Beslutningskriterier

- Gør versionsforhandling og capabilities eksplicitte for alle syv klasser.
- Afvis en manglende obligatorisk capability og enhver nedgradering af en
  sikkerhedskritisk semantik før ændring.
- Lad aldrig en forbindelsesstreng — heller ikke en identisk — omgå gaten.
- Klassificér hvert skift eksplicit som drop-in, planlagt datamigration eller
  ikke-understøttet; påstå ikke fri udskiftning mellem SQL-motorer eller apps.
- Afstem data, ACL, id-mapping, links og referencespor efter migration.
- Bevar entydig menneskelig/agentidentitet og historisk audit-provenance ved et
  IAM-skift.
- Sæt den gamle provider read-only, tilbagekald dens credentials, bevar
  evidensen, og dokumentér rollback.

## Overvejede muligheder

- **A:** Stol på forbindelsesstrenge og produktnavne; skift frit og ryd op
  bagefter.
- **B:** Byg et capability-katalog, et providerregister, en supportmatrix og en
  preflight/cutover/afstemning i `provider-registry/` oven på
  `migration/`-mønstret, med fail-closed forhandling.
- **C:** Løs det pr. provider uden en fælles kontrakt.

## Beslutning

Vi vælger **B**.

- `provider-registry/capabilities.json` er et versionsstyret katalog over
  capabilities for `iam`, `modelprovider`, `database`, `storage`, `backup`,
  `queue` og `apps`, med `mandatory` og `securityCritical`.
- `provider-registry/providers.json` er registret med version, edition,
  forbindelsesform og capability-niveau pr. provider.
- `provider-registry/support-matrix.json` klassificerer hvert skift som
  `drop-in`, `planned-migration` eller `unsupported`. Et skift uden en række
  afvises.
- `provider-registry/policy.json` gør default-deny, tenantisolation,
  capability-forhandling, read-only, credentialrevokation og rollback
  obligatorisk.
- `migration/src/provider-negotiate.mjs` forhandler og klassificerer;
  `preflightSwap` er porten. En manglende obligatorisk capability eller en
  sikkerhedskritisk nedgradering giver `allowed: false`, uanset
  forbindelsesstreng.
- `migration/src/provider-swap.mjs` mapper poster med en deterministisk mål-id,
  bevarer den stabile reference, afstemmer antal/checksums/links/autorisation/
  referencespor, sætter den gamle provider read-only, tilbagekalder credentials
  og gemmer en kvittering med en rollback-grænse.
- `migration/src/provider-store.mjs` er en filbaseret, holdbar butik med epochs
  og snapshot/restore. `migration/src/provider-permissions.mjs` håndhæver
  default-deny og rollebeskyttelse.
- Rapporten erklærer `measured: false`; den målte udskiftning er NOT RUN.

### Konsekvenser

- **Positive:** Udskiftelighed bliver en testet egenskab med en eksplicit
  supportmatrix og en afstemt, reversibel cutover. Kritiske sikkerhedssemantikker
  kan ikke nedgraderes, og en forbindelsesstreng kan ikke omgå gaten.
- **Negative:** Hvert skift skal klassificeres og vedligeholdes i matricen, og en
  planlagt migration kræver et migrationsbevis og en menneskelig godkendelse.
- **Neutrale:** Der tilføjes fem kontrakter og fire nye baseline-checks; den
  målte integration forbliver NOT RUN.

## Fordele og ulemper ved mulighederne

| Mulighed | Fordele | Ulemper |
| --- | --- | --- |
| A | Hurtigt | Ingen garanti; nedgraderer sikkerhed og taber data |
| B | Testet, fail-closed, afstemt og reversibel | Kræver katalog, matrix og godkendelse |
| C | Lokalt tilpasset | Ingen fælles kontrakt; gentager fejl pr. provider |

## Mere information

- `docs/spec/provider-contracts.md`
- `docs/operations/provider-swap.md`
- `docs/runbooks/provider-swap.md`
- `docs/adr/0070-migrations-og-exitvaerktoejer.md`
- `docs/adr/0036-faelles-adapter-sdk-og-godkendelsestest.md`
- `docs/adr/0031-indbyggede-og-eksterne-datatjenester.md`
