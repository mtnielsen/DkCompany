# Sammenhængende ITSM med menneskelige ejere

> DKC-044. Adapteren wrapper GLPI uændret og genbruger den fælles adapter-SDK
> (DKC-023). Kilden er `modules/itsm-adapter/` og `service-registry/`.

## Formål

AI skal arbejde i en **sporbar serviceproces**, hvor mennesker er ansvarlige og
eskalationspunkt. Modulet er en adapter, ikke en ny platform: GLPI kører
uændret, og platformen oversætter sine serviceproces-verber til GLPI's API. Det
menneskelige ejerskab og de ærlige begrænsninger er indbygget i domænet, ikke i
en prompt.

## Servicekatalog og on-call

`service-registry/` er den autoritative kilde:

- `services.json` (`ServiceCatalog`): hver tjeneste har et navngivet menneske som
  ejer, en on-call-rotation, en kommunikationskanal uden for platformen, en
  runbook, en fuld SLA (sev1–sev4), en OLA, CI-relationer og vidensartikler.
- `oncall.json` (`OnCallRotationSet`): primær, sekundær og manager er navngivne
  mennesker, og eskalationskæden er strengt stigende. En AI er aldrig
  vagthavende eller eskalationspunkt.
- `src/catalog.mjs` indeholder den rene fortolkning: transitive afhængigheder,
  ejeropslag, eskalationsmål og kvitteringsfrister.

## Editionkombination

GLPI findes som ren GPL-kerne (Community) og som Network-abonnement. En kandidat
er først frigivet, når **licens, API og driftsprofil** er valideret pr.
delmodul:

| Kombination | Edition | Frigivne delmoduler |
| --- | --- | --- |
| `glpi-network` | Network | servicekatalog, incidents, requests, problemer, changes, CMDB, vidensbase, **SLA** |
| `glpi-community` | Community | servicekatalog, incidents, requests, problemer, changes, CMDB, vidensbase (SLA frigives ikke) |

`assessEditionCombination()` frigiver hvert delmodul for sig og blokerer et
delmodul, hvis licensen er uafklaret, API'et ikke er det dokumenterede REST-API,
eller driftsprofilen mangler backup/RPO/RTO.

## Incidenter, problemer og changes

- **Alarm → incident**: `correlateAlarm()` giver én incident. Samme `alertId` er
  idempotent, og samme `serviceId` + `ruleId` + `signal` lægges på den åbne
  incident. Incidenten får den vagthavende som ejer og de transitive berørte
  tjenester. En `sev1`-alarm giver en **major incident**.
- **Kvittering og eskalation**: enhver alvorlighed kræver menneskelig kvittering.
  `acknowledgementState()` beregner fristen fra SLA'ens svartid;
  `riskyActionAllowed()` stopper risikofyldt handling, indtil et menneske har
  kvitteret, og peger på næste menneske i eskalationskæden.
- **Problem og kendt fejl**: `problemCandidate()` finder gentagne incidents.
  `createProblem()` kræver en navngiven menneskelig validering; en AI kan ikke
  validere.
- **Change**: `createChange()` kobler incident, tjeneste, runbook, godkendelse og
  audit-ID sammen og kræver runbook, mindst én menneskelig godkendelse og mindst
  én incident.
- **Major incident**: `majorIncidentCloseProblems()` nægter at lade en AI lukke
  en major incident, kræver menneskelig kvittering og en navngiven menneskelig
  godkendelse, og accepterer ikke et grønt healthcheck alene.

## Kundevisning

`customerCases()` er default-deny: kunden ser kun sager i sin egen tenant, og
`customerView()` fjerner interne felter, ejeridentitet og AI-handlinger, med
mindre politikken eksplicit tillader dem.

## Roller og agenter

En serviceproces må bruge flere agenter, men `serviceProcessProblems()` afviser
en agent, der optræder med flere roller, en agent uden den forventede rolle, en
ukendt rolle eller en forbudt AI-rolle (ejer/godkender/on-call). Rollerne er de
uforanderlige roller fra DKC-055.

## Privacy og backup

| Verbum | Niveau | Note |
| --- | --- | --- |
| `subject.locate` | partial | lokalisering ud fra de subjektreferencer GLPI-ticket'en bærer; e-mail er ikke en verificeret subjektnøgle |
| `subject.export` | partial | sagsfelterne; audit-/backupkopier følger DKC-020 |
| `subject.erase` | partial | GLPI-database, audit og backups kræver en godkendt sletteproces (DKC-021) |
| `subject.legal_hold` | unsupported | håndteres af retention-modulet (DKC-021) |
| `retention.policy` | partial | globale indstillinger, ikke pr. subjekt |

Backup er `partial` (database-/filbackup, men ikke et konsistent
plugin-snapshot gennem API'et); restore/verify-restore er `unsupported`.

## Grænser

- Der findes ingen rigtig GLPI-installation i dette miljø. Alt er efterprøvet
  mod `mock-itsm.mjs` og den rigtige PDP; en rigtig upstream er registreret som
  `integration-glpi` (NOT RUN).
- Kandidaten er bevidst ikke godkendt (`candidate_not_approved`), fordi en testet
  gendannelse af GLPI mangler.
