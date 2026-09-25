# ADR-0027: Installationsprofiler og en fail-closed dependency-resolver for kataloget

- **Status:** accepteret
- **Beslutningstagere:** Anna Andersen (Platform Owner), med Bo Bertelsen som stedfortræder
- **Dato:** 2026-09-23
- **Beslutningsdrev:** DKC-053. ADR-0013 fastlagde deployment-profilerne, og ADR-0026 fastlagde fejldomæner og recovery. Men der fandtes ingen versioneret kontrakt for hvad en installation faktisk består af, og ingen resolver der kunne svare på "hvad installerer jeg, hvorfor, og kan det overhovedet lade sig gøre?" uden at mutere noget. Uden det bliver en produktprofil en salgstekst i stedet for en efterprøvelig plan.

## Kontekst og problemstilling

- **En lille VPS, en lokal server og et HA-setup er tre forskellige produkter.** De deler kontrolplan, men adskiller sig i HA, fejldomæner, backup og kapacitet. Forskellen skal være en kontrakt, ikke en fodnote.
- **Sikkerhedskernen må ikke kunne fravælges.** Identitet, kontrolplan og audit er obligatoriske i alle profiler. Communications, HR, BI og Reporting er valgfrie applikationer.
- **Afhængigheder er transitive og versionsbundne.** En resolver skal finde den valgte closure, vise hvorfor hver komponent er nødvendig, og opdage cyklusser, inkompatible versioner, konflikter, fjernede delte afhængigheder og ressourceknaphed, før noget installeres.
- **Host-styring er farligt og skal være opt-in.** Det må ikke snige sig ind som en skjult del af en profil.
- **En platformspåstand uden et navn er ikke en påstand.** Hver understøttet OS-/arkitektur-/runtime-kombination skal have et navn og en testkommando.

## Beslutningskriterier

- Versionerede komponentmanifester med required/optional dependencies, capabilities, conflicts, versionsintervaller, datatjenester, migrationer, ressourcer, download-/driftskrav, supportprofil og platformskrav.
- Tre installationsprofiler: single-server non-HA, multi-server HA og dedikeret enterprise, hver bundet til en DKC-002 deployment-profil.
- Obligatorisk sikkerhedskerne; valgfri Communications, HR, BI og Reporting.
- En deterministisk resolver der fejler lukket før mutation og viser begrundelser.
- Host-styring som separat opt-in i alle profiler.
- Navngivne og testbare platformskombinationer.
- En dokumenteret migrationsvej fra single-server til HA med forventet nedetid.

## Overvejede muligheder

- **Læg afhængigheder ind i `module-manifest.schema.json`.** Ops-kontrakten er pr. implementeret modul; et katalog over produkter (inkl. endnu ikke byggede apps) ville blande to ansvar sammen og tvinge moduler til at kende deres indkøbskontekst.
- **Et separat `catalog/` + `distribution/` med deres egne kontrakter.** Adskiller ops-kontrakten fra installationskontrakten, kan versioneres selvstændigt og kan indeholde både implementerede og endnu ikke implementerede komponenter ærligt.
- **En "smart" resolver der gætter på en kompatibel version.** Skjuler konflikter. Vi vælger i stedet den højeste version der opfylder ALLE krav og fejler hvis ingen gør.

## Beslutning

Vi indfører et versioneret katalog og en fail-closed resolver, håndhævet i
`contracts/component-manifest.schema.json`,
`contracts/installation-profile.schema.json`,
`contracts/platform-matrix.schema.json`, `conformance/src/distribution.mjs` og
`distribution/`:

1. **Komponentmanifestet** (`kind: ComponentManifest`) bærer `componentType`,
   `category`, `securityCore`, `provides`, `requires`, `optionalRequires`,
   `conflicts`, `dataServices`, `migrations`, `resources`, `download`,
   `operations`, `supportProfile`, `platforms` og `implementation.status`
   (`implemented` / `catalog-only` / `external`). En `catalog-only`-komponent må
   ikke fremstilles som implementeret.
2. **Installationsprofilen** (`kind: InstallationProfile`) binder en DKC-002
   deployment-profil til kataloget med `securityCore`, `defaultApplications`,
   `optionalApplications`, `supportedPlatforms`, `capacity`, `supportProfile`,
   `hostManagement.optIn: true` og en `migration` med `pathRef` og
   `expectedDowntimeMinutes`.
3. **Platformmatricen** (`kind: PlatformMatrix`) navngiver hver understøttet
   OS-/arkitektur-/runtime-kombination og kræver en `testCommand`.
4. **Sikkerhedskernen er obligatorisk.** Resolveren medtager alle komponenter
   med `securityCore: true`, og en profil der ikke dækker dem, afvises.
   Communications, HR, BI og Reporting er valgfrie; host-styring er opt-in.
5. **Resolveren fejler lukket før mutation.** Den rapporterer `CYCLE`,
   `INCOMPATIBLE_VERSION`, `CONFLICT`, `REMOVED_SHARED_DEPENDENCY`,
   `INSUFFICIENT_RESOURCES`, `MISSING_DATA_SERVICE_PROVIDER`,
   `SECURITY_CORE_MISSING` og profil-/serviceklassefejl uden at skrive noget.
6. **Deterministisk preview.** `distribution/src/preview.mjs` viser closure,
   begrundelse pr. komponent, installationsrækkefølge, ressourceforbrug mod
   budget, downloads, driftskrav, datatjenester og migrationer.
7. **Single-server kræver eksplicit non-HA-accept og ekstern backup.** Profilen
   skal have `acceptedNonHaServiceClass: true` og `externalBackupRequired: true`,
   og de involverede serviceklasser skal være non-HA med accepteret nedetid og
   ekstern, offsite backup.

Kontrakterne er versionerede (`apiVersion: contracts.platform/v1alpha1`,
`metadata.version`) og valideres i `make validate`, `make distribution-check` og
`make distribution-test`.

## Konsekvenser

- **Positive:** En produktprofil er nu en efterprøvelig plan. Afhængigheder,
  versioner, konflikter og ressourcer opdages før mutation. Sikkerhedskernen kan
  ikke fravælges, og host-styring kan ikke snige sig ind. Platforme er navngivne
  og testbare.
- **Negative:** Kataloget skal vedligeholdes sammen med modulerne, og en ny
  komponent kræver et manifest, en ejer og en supportprofil.
- **Neutrale:** Resolveren er bevidst uden npm-afhængigheder og implementerer sin
  egen SemVer-løsning; det er mere kode, men gør installationen reproducerbar
  uden et eksternt pakkeregister.

## Fordele og ulemper ved mulighederne

| Mulighed | Fordele | Ulemper |
| --- | --- | --- |
| Afhængigheder i `module-manifest.schema.json` | Én kontrakt pr. modul | Blander ops- og installationsansvar; kan ikke beskrive endnu ikke byggede produkter |
| Separat `catalog/` + `distribution/` | Klar adskillelse, ærlig status, selvstændig versionering | Endnu et katalog at vedligeholde |
| Gætte en kompatibel version | Færre synlige fejl | Skjuler reelle konflikter; fejler sent |

## Mere information

- [`docs/spec/distribution-profiles.md`](../spec/distribution-profiles.md)
- [`docs/distribution/single-server-til-ha.md`](../distribution/single-server-til-ha.md)
- [`contracts/component-manifest.schema.json`](../../contracts/component-manifest.schema.json),
  [`contracts/installation-profile.schema.json`](../../contracts/installation-profile.schema.json),
  [`contracts/platform-matrix.schema.json`](../../contracts/platform-matrix.schema.json)
- [`conformance/src/distribution.mjs`](../../conformance/src/distribution.mjs),
  [`distribution/src/resolver.mjs`](../../distribution/src/resolver.mjs),
  [`distribution/src/preview.mjs`](../../distribution/src/preview.mjs)
- [ADR-0013](0013-deployment-og-tenantmodel.md), [ADR-0026](0026-fejlomraader-n-plus-1-og-recovery.md)
