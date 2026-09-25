# Arbejdspladsmodul: filer, deling, kalender og kontoredaktør

> DKC-026. Adapteren wrapper Nextcloud uændret og genbruger den fælles
> adapter-SDK (DKC-023). Kilden er `modules/nextcloud-adapter/`.

## Formål

Pilotkunder skal have ét bredt arbejdspladsmodul: filer, deling, kalender og en
kontoredaktør. Modulet er en **adapter**, ikke en ny platform: Nextcloud og
kontoredaktøren kører uændret, og platformen oversætter sine verber og
arbejdspladsoperationer til deres API'er. Alt, hvad adapteren ikke kan gennem
API'et, erklæres ærligt som `partial` eller `unsupported`.

## Editionkombination

En arbejdsplads er først en kandidat, når **både** fil-/kalenderkernen og
kontoredaktøren er valideret for licens, API og driftsprofil. De dokumenterede
kombinationer ligger i `modules/nextcloud-adapter/service/src/constants.mjs`:

| Kombination | Kerne | Kontoredaktør | Status |
| --- | --- | --- | --- |
| `nextcloud-hub-onlyoffice` | Nextcloud Hub 30 Enterprise | ONLYOFFICE Docs 8.1 Enterprise | alle fire delmoduler frigives |
| `nextcloud-hub-collabora` | Nextcloud Hub 30 Enterprise | Collabora Online 24.04 Development | fil/deling/kalender frigives, **editor frigives ikke** (driftsprofil uden backup) |

`assessEditionCombination()` frigiver fil-, delings-, kalender- og editormodulet
hver for sig. Et delmodul frigives kun, hvis licensen er afklaret, API'et er
dokumenteret, og driftsprofilen har en backupstrategi og RPO/RTO.

## Autorisation og deling

- **Én beslutning** (`decideFileAccess`): default-deny. Ejer har altid adgang;
  en bruger- eller gruppedeling giver kun adgang, hvis den bærer den nødvendige
  rettighedsbit. En fremmed tenant afvises, og en deaktiveret konto afvises.
- **Kun et verificeret menneske** må dele, oprette offentlige links, invitere
  gæster og afvikle en bruger. Agent-verber (fx DSAR-eksport) er bundet af
  PDP'en og af kundepolitikken.
- **Ekstern deling** følger `externalSharing` (`disabled` / `domain-restricted` /
  `allowed`) og en domæne-allowlist.
- **Offentlige links** kræver, at kundepolitikken tillader dem, og håndhæver
  adgangskode, udløb, maksimal levetid og forbud mod upload.

## Identitetslivscyklus og gæster

- Eksterne gæster oprettes som Nextcloud-brugere med `isGuest` og kundens gruppe.
  Invitation, suspension (luk sessioner + deaktivér) og fjernelse (tilbagekald
  delinger + slet bruger) er separate, auditérbare handlinger.
- **Offboarding** lukker sessioner, tilbagekalder alle delinger ejet af
  subjektet og overfører eller sletter subjektets filer efter kundepolitikken.
  Kvitteringen indeholder tællere, ikke indhold.

## Privacy-verber

| Verbum | Niveau | Note |
| --- | --- | --- |
| `subject.locate` | full | bruger, filer, delinger, sessioner og kalendere via API |
| `subject.export` | full | filer, delinger og kalendere med `aclPreserved` |
| `subject.erase` | partial | filer/delinger/sessioner slettes; backups, versions-/papirkurvshistorik og søgeindeks kræver upstream-oprydning (DKC-021) |
| `subject.legal_hold` | unsupported | håndteres af retention-modulet (DKC-021) |
| `retention.policy` | partial | globale indstillinger, ikke pr. subjekt |

## Backup, restore og sletning

- **Backup**: `partial`. App-konfiguration og databasedump kan eksporteres, men
  et konsistent filsnapshot kræver volume-adgang.
- **Restore/verify-restore**: `unsupported`. Gendannelse sker på volume- og
  databaseniveau uden for API'et.
- **Sletning**: kræver begrundelse og godkendelse, blokeres af legal hold og
  aktiv retention, og rapporterer de kopier adapteren ikke kan fjerne. Den
  slettede payload gemmes ikke i revisionssporet.

## Grænser

- Der findes ingen rigtig Nextcloud-installation i dette miljø. Alt er
  efterprøvet mod `mock-nextcloud.mjs` og den rigtige PDP; en rigtig upstream er
  registreret som `integration-nextcloud` (NOT RUN).
- Kontoredaktøren er kun valideret gennem editionkombinationens licens-, API- og
  driftsprofil. En faktisk WOPI-redigering mod ONLYOFFICE/Collabora er NOT RUN.
