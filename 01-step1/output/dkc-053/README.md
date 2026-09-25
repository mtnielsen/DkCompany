# DKC-053 — Installationsprofiler og dependency-resolver (leverance)

Implementering af **DKC-053** for `mtnielsen/DkCompany`. Bygger på
DKC-001 .. DKC-013, DKC-055, DKC-012 og DKC-037. `00-core/` er fortsat **ikke
ændret**; alt ligger under `01-step1/output/dkc-053/`.

## Forudsætninger og valg

DKC-053 afhænger formelt af **DKC-002** (deployment-profiler) og **DKC-037**
(serviceklasser). Overlayen lægges oven på hele den nuværende stak via
`dkc-037/apply.sh`, som kæder `dkc-012/apply.sh` og dermed
DKC-001 .. DKC-013 + DKC-055. **DKC-037 er valgt som forudsætning, fordi den er
den aktuelle stak-top.** DKC-002's `deployment-profile.schema.json` og
`conformance/src/architecture.mjs` er bevaret uændret og genbruges: hver
installationsprofil binder til en af de tre eksisterende deployment-profiler
(`smv`, `service`, `enterprise`).

## Hvad der er implementeret

1. **Tre nye versionerede kontrakter.**
   - `contracts/component-manifest.schema.json` — `kind: ComponentManifest` med
     `componentType`, `category`, `securityCore`, `provides`, `requires`,
     `optionalRequires`, `conflicts`, `dataServices`, `migrations`, `resources`,
     `download`, `operations`, `supportProfile`, `platforms` og
     `implementation.status` (`implemented` / `catalog-only` / `external`).
   - `contracts/installation-profile.schema.json` — `kind: InstallationProfile`
     der binder en DKC-002 deployment-profil til kataloget med `securityCore`,
     `defaultApplications`, `optionalApplications`, `supportedPlatforms`,
     `capacity`, `supportProfile`, `hostManagement.optIn: true` og en
     `migration` med `pathRef` og `expectedDowntimeMinutes`.
   - `contracts/platform-matrix.schema.json` — `kind: PlatformMatrix` med
     navngivne OS-/arkitektur-/runtime-kombinationer og en `testCommand`.
2. **Katalog.** `catalog/` har 13 komponentmanifester (obligatorisk
   sikkerhedskerne: `platform-core`, `identity-broker`, `audit-service`;
   valgfrie applikationer: `communications`, `hr`, `bi`, `reporting`; tekniske
   komponenter og datatjenester; `host-management` som opt-in;
   `bi-legacy` for at kunne afvise en konflikt), 3 installationsprofiler
   (`small-vps`, `ha-cluster`, `enterprise-dedicated`) og `platforms.json`
   med 4 navngivne, testbare kombinationer.
3. **Semantisk validator.** `conformance/src/distribution.mjs` afviser bl.a.
   team-ejere, ugyldig SemVer, ugyldige versionsintervaller, uverificerede
   downloads, en `catalog-only`-komponent der udgiver sig for implementeret,
   en `host-management`-komponent i sikkerhedskernen, single-server uden
   eksplicit non-HA-accept og profiler uden migrationsvej. Validatoren bruges
   af `make validate`, `make distribution-check` og installatøren.
4. **Dependency-resolver.** `distribution/src/resolver.mjs` er en ren funktion
   over kataloget. Den medtager den obligatoriske sikkerhedskerne, samler
   transitive afhængigheder med en begrundelse pr. kant, vælger den højeste
   version der opfylder **alle** versionsintervaller, og rapporterer alle fejl
   **før** mutation: `SECURITY_CORE_MISSING`, `INCOMPATIBLE_VERSION`, `CYCLE`,
   `CONFLICT`, `REMOVED_SHARED_DEPENDENCY`, `INSUFFICIENT_RESOURCES`,
   `MISSING_DATA_SERVICE_PROVIDER` samt profil-/serviceklassefejl
   (`PROFILE_TYPE_MISMATCH`, `SINGLE_SERVER_HA`, `NON_HA_NOT_ACCEPTED`,
   `EXTERNAL_BACKUP_*`, `SERVICE_CLASS_PROFILE_MISMATCH`,
   `SINGLE_SERVER_HA_CLASS`, `HA_CLASS_NOT_ELIGIBLE`).
5. **Egen SemVer.** `distribution/src/semver.mjs` implementerer SemVer 2.0.0 og
   intervaller (`=`, `>=`, `<=`, `>`, `<`, `^`, `~`, delvise versioner, `||`,
   `*`) uden npm-afhængigheder, så installationen er reproducerbar.
6. **Deterministisk preview.** `distribution/src/preview.mjs` viser closure,
   begrundelse pr. komponent, installationsrækkefølge, ressourceforbrug mod
   profilens budget, download-/driftskrav, datatjenester og migrationer.
7. **Tre profiler med sikkerhedskerne og opt-in host-styring.**
   `small-vps` (single-server non-HA med `acceptedNonHaServiceClass` og
   `externalBackupRequired`), `ha-cluster` (multiple-servers HA) og
   `enterprise-dedicated` (dedikeret). Host-styring er `optIn: true` i alle
   profiler og kan ikke blive en del af sikkerhedskernen.
8. **Migrationsvej.** `docs/distribution/single-server-til-ha.md` beskriver
   skiftet fra single-server til HA (og videre til enterprise) med forventet
   nedetid (60/120 minutter), rollback og hvad nedetiden ikke dækker.
9. **ADR og spec.** `docs/adr/0027-installationsprofiler-og-resolver.md` og
   `docs/spec/distribution-profiles.md`; indeksene er opdateret.

## Ændrede/nye filer (overlay, relativt til `00-core/`)

```
Makefile                                             (+ distribution-check/-test/-preview, + i ci)
catalog/components/*.component.json                  (ny: 13 komponentmanifester)
catalog/platforms.json                               (ny: platformmatrix)
catalog/profiles/*.profile.json                      (ny: 3 installationsprofiler)
conformance/src/distribution.mjs                     (ny: semantisk validator)
conformance/src/schemas.mjs                          (+ 3 skema-id'er)
conformance/src/validate-schemas.mjs                 (+ katalogvalidering)
conformance/test/distribution-conformance.test.mjs   (ny: 9 accepttests)
conformance/test/fixtures/distribution/*.invalid.json (ny: 3 negative fixtures)
contracts/component-manifest.schema.json             (ny kontrakt)
contracts/installation-profile.schema.json           (ny kontrakt)
contracts/platform-matrix.schema.json                (ny kontrakt)
contracts/examples/{component-manifest,installation-profile,platform-matrix}.example.json (ny)
distribution/package.json                            (ny)
distribution/src/{semver,catalog,profiles,resolver,preview,check}.mjs (ny)
distribution/test/{semver,resolver,profiles}.test.mjs (ny: 33 tests)
docs/adr/0027-installationsprofiler-og-resolver.md   (ny ADR)
docs/adr/README.md, docs/spec/README.md              (opdateret)
docs/spec/distribution-profiles.md                   (ny spec)
docs/distribution/single-server-til-ha.md            (ny migrationsvej)
docs/status/implementation-matrix.md                 (regenereret)
tools/baseline/registry.mjs                          (+ distribution-komponent og 3 checks)
```

## Testkommandoer og resultater (checkout `83ad91a` + DKC-001..013 + DKC-055 + DKC-012 + DKC-037, Node v22.22.1)

| Kommando | Resultat |
| --- | --- |
| `make distribution-check` | **OK** (13 komponenter, 3 profiler, 4 platforme; kerne-closure = 6 komponenter) |
| `make distribution-test` | **42 pass / 0 fail** (33 resolver/SemVer/profil + 9 konformans-accepttests) |
| `make distribution-preview PROFILE=small-vps APPS=bi` | **OK** — kun BI + teknisk/sikkerhedsmæssige afhængigheder |
| `make distribution-preview PROFILE=ha-cluster APPS=bi,hr` | **OK** — deterministisk preview |
| `make validate` | **37 skemaer / 36 eksempler** + komponent-, profil- og platformseksempel (skema + semantik) |
| `make lint` | **OK** (238 JSON-filer, 587 filer) |
| `make architecture-check` | **OK** (DKC-002-kontrakterne uændret gyldige) |
| `make architecture-test` | **10 pass / 0 fail** |
| `make continuity-check` | **OK** (4 serviceklasser, 4 pilotmoduler, 3 profiler) |
| `make continuity-test` | **27 pass / 0 fail** |
| `make test` (conformance) | **110 pass / 0 fail** (inkl. 9 nye DKC-053-accepttests) |
| `make baseline-test` | **8 pass / 0 fail** |
| `make baseline` | **65 pass, 1 fail (DCO), 0 error, 10 not run af 76**; `distribution-check`, `distribution-test` og `distribution-preview` **PASS** |

`make baseline`'s ene fejl er DKC-001's kendte `changelog-check` (4 commits
mangler DCO sign-off). Baselinekørslen ændrede 30 committede fixture-filer under
`modules/*/conformance`; de er nulstillet med
`git checkout -- modules/*/conformance` fra `00-core/`. Evidens:
`evidence/logs/*.log`, `evidence/baseline/latest.json`,
`evidence/baseline/runs/`, `evidence/baseline/logs/`, `evidence/baseline/artifacts/`.

## Acceptkriterier

| Krav | Status | Bevis |
| --- | --- | --- |
| Valg af kun BI installerer kun BI og dens nødvendige tekniske/sikkerhedsmæssige afhængigheder | **PASS** | `distribution/test/resolver.test.mjs` ("BI-only...") og `conformance/test/distribution-conformance.test.mjs`; preview `--apps bi` indeholder `bi`, `analytics-store`, sikkerhedskernen og datatjenester — ikke `hr`, `reporting`, `communications`, `host-management` |
| Cyklus, inkompatibel version, konflikt og utilstrækkelige ressourcer opdages før mutation | **PASS** | `resolveDependencies` er ren og rapporterer `CYCLE`, `INCOMPATIBLE_VERSION`, `CONFLICT`, `INSUFFICIENT_RESOURCES`, `REMOVED_SHARED_DEPENDENCY`; fire dedikerede tests i `resolver.test.mjs` |
| Single-serverprofil må bruges med eksplicit accepteret non-HA-serviceklasse og ekstern backup | **PASS** | `profiles.test.mjs` ("single-server bruges med accepteret non-HA-serviceklasse og ekstern backup"/"uden non-HA-accept afvises"); `resolver.mjs` `profileSafety` + DKC-037-serviceklasserne |
| Hver understøttet OS/arkitektur/runtime-kombination er navngivet og testbar | **PASS** | `catalog/platforms.json` (4 navngivne kombinationer med `testCommand`), `platformMatrixProblems`, `currentPlatformId`, `profiles.test.mjs` |
| Skift fra single-server til HA har dokumenteret migrationsvej og forventet nedetid | **PASS (dokumentation)** | `catalog/profiles/ha-cluster.profile.json` (`migration.from: small-vps`, `expectedDowntimeMinutes: 60`) og `docs/distribution/single-server-til-ha.md`; testen verificerer at dokumentet findes og nedetiden er > 0 |
| Obligatorisk sikkerhedskerne med valgfri Communications, HR, BI og Reporting | **PASS** | `securityCoreIds` = `audit-service`, `identity-broker`, `platform-core`; `SECURITY_CORE_MISSING`; `optionalApplications` pr. profil; `profiles.test.mjs` |
| Host-styring er separat opt-in | **PASS** | `hostManagement.optIn: true` i alle 3 profiler, `host-management` har `securityCore: false`; `profiles.test.mjs` og `installationProfileProblems` |

## Resterende begrænsninger

- **Ingen faktisk installation eller deploy.** Resolveren og previewet er en
  plan; de skriver intet. Selve installationen (pakkeudrulning, data-migration,
  DNS, secrets) er en drifts-/integrationsopgave og er **NOT RUN**.
- **Communications-applikationen er single-server.** `communications`
  (Mattermost-adapteren) har en non-HA serviceklasse og tilbydes derfor ikke som
  valgfri på HA-profilerne. Vælges den alligevel, afvises planen fail-closed
  med `SERVICE_CLASS_PROFILE_MISMATCH`. En HA-egnet kommunikationskomponent
  kræver et multi-writer-egnet upstream-produkt (ikke antaget).
- **HR, BI og Reporting er `catalog-only`.** Kontrakterne, afhængighederne og
  resolver-adfærden er reelle og testbare, men de bagvedliggende applikationer
  er endnu ikke bygget. Det er angivet ærligt i `implementation.status`.
- **Kataloget er ét versionsspor pr. komponent.** Resolveren understøtter flere
  versioner og vælger den højeste der opfylder alle krav (testet med syntetiske
  kataloger), men det udrullede katalog har kun én version pr. komponent.
- **Platformmatricen er ikke kørt på alle kombinationer.** `linux-amd64-node22`
  er efterprøvet i dette miljø; de øvrige kombinationer er navngivet og har en
  testkommando, men er **NOT RUN** her.
- **Ingen menneskelig release-godkendelse.** Uafhængig verifikation og
  produktionsfrigivelse er separate handlinger.
- **DKC-001's `changelog-check`-fejl består** (4 commits mangler DCO sign-off).
- Overlay, ikke committed kode: `00-core/` er urørt.

## Til uafhængig gennemgang

- **Reviewets base:** `5f9fa73457d22583b9948611d5cc3afffec4ae38` (5f9fa73).
- **Undersøgt checkout:** `83ad91a`.
- **Forudsætnings-overlays:** DKC-001 .. DKC-013, DKC-055, DKC-012 og DKC-037
  (lægges via `apply.sh`, som kæder `dkc-037/apply.sh`).
- **Denne leverance:** `01-step1/output/dkc-053/` (48 filer i `deliverable/`,
  SHA256 i `OVERLAY-MANIFEST.txt`; 12 + 1 evidenslogger og baselinekørsel).
- Uafhængig verifikation, faktisk installation, kørsel på de øvrige
  platformskombinationer og menneskelig release-godkendelse er separate
  handlinger og er **ikke** udført her.
