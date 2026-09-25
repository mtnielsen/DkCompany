# Projektstyring og rettighedsbevidst søgning (OpenProject)

DKC-027 leverer opgaver, projektplaner og samarbejde med OpenProject som første
kandidat. Modulet ligger i `modules/openproject-adapter/` og wrapper OpenProject
uændret bag den fælles adapter-SDK (DKC-023).

## Formål og afgrænsning

- **System-of-record for projektindhold:** OpenProject ejer projekter,
  arbejdspakker, ansvarlige, afhængigheder, medlemskaber, vedhæftninger og
  statushændelser. Adapteren ændrer intet ved upstream.
- **Platformens ansvar:** tenant-tilknytning og den tenantafgrænsede reference,
  audit, samtykke og DSAR, den ACL-bevidste søge-/AI-projektion samt slette- og
  retentionkvitteringer.
- **Ikke i scope:** at erstatte OpenProject med en egen databasemodel. En
  kopimodel ville skabe et dubleret system-of-record og datadrift.

## Roller og rettigheder

| Platformrolle | project.read | workpackage.write | member.manage | file.read | project.export |
| --- | --- | --- | --- | --- | --- |
| tenant-admin | ja | ja | ja | ja | ja |
| project-admin | ja | ja | ja | ja | ja |
| member | ja | ja | nej | ja | nej |
| reader | ja | nej | nej | ja | nej |
| external-guest | ja | nej | nej | ja | nej |
| auditor | ja | nej | nej | nej | nej |

`decideProjectAccess` er default-deny: uden et dækkende medlemskab i samme tenant
nægtes adgang. `projectRole` filtrerer medlemskaber på projekt, så et medlemskab
i ét projekt ikke giver adgang til et andet. En projektgæst afvises, medmindre
kundepolitikken (`guestAccess: own-projects-only`) udtrykkeligt tillader egne
projekter, og en gæst får aldrig skrive- eller eksportrettigheder.

## Import og eksport

Eksport og import bruger kontrakten
[`contracts/project-export.schema.json`](../../contracts/project-export.schema.json)
(`ProjectBundle`) med en stabil `externalId` pr. projekt og arbejdspakke.
Importplanen sammenligner på en kanonisk projektion, så en gentaget import af
samme bundt giver nul `creates` og ingen dubletter. Et bundt med en dubleret
`externalId`, en ukendt afhængighed, en cyklus eller en fremmed tenant afvises,
før noget skrives.

## Rettighedsbevidst søgning og AI

`buildPermissionProjection` bygger den projektmængde principalen må se og
versioneres ved hver medlemskabsændring. `isProjectionFresh` afviser en
projektion, der ikke er på den aktuelle rettighedsversion eller er ældre end
`ai.maxIndexAgeSeconds` (default 300 s). Retrieval fejler fail-closed
(`stale_projection`) i stedet for at svare ud fra en forældet cache. Dermed slår
en permissionændring igennem, før søgning eller AI svarer.

## Editioner

| Edition | Projekter | Arbejdspakker | Medlemskaber | Filer | Statushændelser | Central SSO |
| --- | --- | --- | --- | --- | --- | --- |
| OpenProject Community | ja | ja | ja | ja | ja | nej |
| OpenProject Enterprise | ja | ja | ja | ja | ja | ja (OIDC/SAML) |

`assessEditionCombination` frigiver hver feature for sig. Community frigives
ikke som kandidat, fordi platformen kræver central SSO; den rapporteres som
`partial` med en eksplicit afvigelse i stedet for at skjule manglen.

## Verber og ærlighed

- `health` er `full` med et fixture-bevis.
- `backup`/`upgrade.dry-run`/`slo` er `partial`.
- `restore`, `verify-restore`, `upgrade`, `migrate`, `rollback` er `unsupported`,
  fordi de kræver database-/volumeniveau uden for API'et.
- Privacy: `subject.locate`, `subject.export` og `subject.erase` er `partial`
  (backups, søgeindeks og revisionsspor kræver en upstream-oprydning efter
  DKC-021); `subject.legal_hold` er `unsupported`; `retention.policy` er
  `partial`.

## API-flade

| Verbum | Sti |
| --- | --- |
| health | `GET /healthz` |
| project.list | `POST /v1/projects/list` |
| project.read | `POST /v1/projects/read` |
| workpackage.create | `POST /v1/projects/work-packages` |
| workpackage.update | `POST /v1/projects/work-packages/update` |
| project.member.add | `POST /v1/projects/members` |
| project.member.remove | `POST /v1/projects/members/remove` |
| project.guest.invite | `POST /v1/projects/guests` |
| project.export | `POST /v1/projects/export` |
| project.import | `POST /v1/projects/import` |
| project.search.scope | `POST /v1/projects/search-scope` |
| project.ai.retrieve | `POST /v1/projects/ai-retrieval` |
| subject.locate | `POST /v1/privacy/locate` |
| subject.export | `POST /v1/privacy/export` |
| subject.erase | `POST /v1/privacy/erase` |

Alle muterende verber er gated i `module-manifest.json` og kræver en fail-closed
PDP-beslutning. Auth, tenantudledning, audit, idempotens og versionsforhandling
genbruges fra adapter-SDK'en.

## Begrænsninger

- Der findes ingen rigtig OpenProject-installation i dette miljø. Al adfærd er
  efterprøvet mod `mock-openproject.mjs` og den rigtige PDP; en levende upstream
  er registreret som `integration-openproject` (NOT RUN).
- Kandidaten er bevidst **ikke** godkendt (`candidate_not_approved`), fordi en
  testet gendannelse mangler.
- Vedhæftningsindhold eksporteres delvist; backup/restore og versionsopgradering
  er ærligt `partial`/`unsupported`.
