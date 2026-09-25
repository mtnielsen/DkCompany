# Installations- og releaseacceptance på tværs af profiler

- **Status:** accepteret
- **Beslutningstagere:** Anna Andersen (Platform Owner), Cecilia Christensen (Security Owner), Ditte DPO (Data Protection Officer)
- **Dato:** 2026-10-07
- **Beslutningsdrev:** DKC-062 kræver bevis for, at en administrator kan installere, konfigurere og drive kun de ønskede moduler: kørebare brugerrejser på de understøttede lokale/VPS-profiler og HA når den vælges, en profilbevidst gate-aggregator, et RACI-register og en særskilt registreret menneskelig ejeraccept.

## Kontekst og problemstilling

Installer (DKC-054) kan bygge og udføre en signeret plan, distribution
(DKC-053) resolver profiler, produktlivscyklussen (DKC-061) opdaterer og fjerner,
providerkontrakterne (DKC-059) skifter leverandør, og release-gaten (DKC-063)
kan afvise svagt evidensgrundlag. Men der findes ingen samlet **acceptance** der
svarer på: Kan netop denne profil faktisk installeres, konfigureres, udvides,
opgraderes og gendannes? Hvilke gates er aktive for en single-server kontra en
HA- eller immutable-profil? Hvem er det ansvarlige menneske og stedfortræderen
for hver service, dataklasse og kontrolproces? Og hvordan forhindres det, at en
manglende, forældet, forkert-artefakt eller ikke-godkendt evidens bliver til en
grøn accept?

Uden en fælles acceptkontrakt ville en single-server-installation blive bedømt
efter HA-gates den ikke kan opfylde, en HA-profil kunne bestå uden sine
forudsætningskapabiliteter (DKC-038–043 og DKC-050–052), host management
(DKC-058), immutable (DKC-047–049) og self-healing (DKC-045–046) ville mangle
deres særskilte gates, og en grøn check ville kunne forveksles med en
menneskelig accept.

## Beslutningskriterier

- Hver brugerrejse (install, konfiguration, tilføj/fjern, opgradering,
  provider-skift, eskalation, recovery og exit) skal være kørbar og deterministisk
  efterprøvet på de understøttede profiler og platforme.
- Fælles gates (sikkerhed, privacy, restore, rolle) skal altid gælde.
- HA, host management, immutable og self-healing skal være særskilte gates der
  kun aktiveres når profilen/kapabiliteten er valgt, og hver aktiv gate skal
  kræve sine forudsætningskapabiliteter i koden.
- Gaten skal afvise manglende, forældet, forkert-artefakt og ikke-godkendt
  evidens; fravalg af en profil må ikke ophæve en obligatorisk
  auditbeskyttelse.
- RACI skal have et ansvarligt menneske og en stedfortræder pr. service,
  dataklasse og kontrolproces.
- Menneskelig ejeraccept skal være en særskilt registreret begivenhed og aldrig
  udledes af en grøn check.
- Løsningen skal skelne tydeligt mellem deterministisk fixture-evidens,
  integration og en faktisk målt installation.

## Beslutning

Vi indfører en **profilbevidst acceptmodel** for DKC-062 med fire versionerede
kontrakter:

1. `acceptance-scenario.schema.json` — `AcceptanceScenarioSet`: kørebare
   brugerrejser bundet til en understøttet profil/platform med trin, forventet
   udfald, bevisniveau og en navngivet menneskelig ejer.
2. `acceptance-gate-policy.schema.json` — `AcceptanceGatePolicy`: fire fælles
   gates (sikkerhed, privacy, restore, rolle) og fire særskilte profilgates (HA,
   host-management, immutable, self-healing) med `appliesWhen`,
   forudsætningskapabiliteter, krav, checks og ejer.
3. `raci-registry.schema.json` — `RaciRegistry`: ansvarlig, stedfortræder,
   accountable, konsulterede og informerede pr. service, dataklasse og
   kontrolproces.
4. `acceptance-result.schema.json` — `AcceptanceResult`: maskinlæsbart resultat
   pr. acceptmål med distinkte statusser og en beslutning der kun bliver
   `accepted` med både testbevis og registreret ejeraccept.

Den kanoniske kilde er `distribution/acceptance/scenarios.json`,
`gate-policy.json`, `raci.json` og `owner-acceptance.json`. Den profilbevidste
aggregator ligger i `distribution/src/acceptance-gate.mjs`; de kørebare rejser i
`distribution/src/acceptance-run.mjs`; den deterministiske kontrol og rapport i
`acceptance-check.mjs` og `acceptance-report.mjs`. Rapporten genereres på
`acceptance/report/acceptance-report.json` og `docs/pilot/acceptance-report.md`.

## Konsekvenser

- En single-server markeres non-HA med en accepteret nedetids-/recoveryprofil;
  HA-gaten er `not-applicable`, men den fælles sikkerhedsgate (inkl.
  auditbeskyttelse) består uændret. Fravalg af immutable ophæver derfor ikke
  auditbeskyttelsen.
- HA, host management, immutable og self-healing kan ikke aktiveres uden deres
  forudsætningskapabiliteter i kode/register; en manglende kapabilitet giver
  `missing` og blokerer.
- `acceptance/report/acceptance-report.json` er deterministisk og committet;
  `acceptance-check` afviser en rapport der er ude af trit med kilden.
- Den committede rapport viser, at alle deterministiske rejser består, men at
  hver aktiv gate afventer en registreret menneskelig ejeraccept. En grøn check
  kan derfor aldrig blive `accepted` alene.
- En faktisk målt installation på ren VPS/lokal server/HA og den menneskelige
  accept forbliver en særskilt integration (`integration-acceptance-live`) og er
  **NOT RUN** i dette miljø.

## Alternativer overvejet

- **Genbrug af release-gaten alene:** afvises, fordi den ikke er profilbevidst og
  ikke skelner en aktiv HA/immutable/self-healing-gate fra en ikke-anvendelig.
- **En enkelt fælles acceptgate:** afvises, fordi en single-server ellers ville
  blive målt mod HA-krav den ikke kan opfylde, og en HA-profil kunne bestå uden
  forudsætningerne.
- **Automatisk genereret ejeraccept:** afvises, fordi en menneskelig accept skal
  være en særskilt, navngiven begivenhed og aldrig udledes af en check.
