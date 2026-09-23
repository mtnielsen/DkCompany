# Direkte kodeprompts — revision 5

Denne pakke erstatter revision 4's planner-først-instruktioner. Du skal ikke starte med en planlægningsagent.

## Brug pakken

1. Giv kodeagenten adgang til repositoryet og denne udpakkede mappe.
2. Kopiér `START-CODING.md` til agenten. Den implementerer DKC-001 med det samme.
3. Ved næste tildeling send indholdet af den relevante fil i `prompts/`. Hver fil er en selvstændig direkte kodeprompt med scope, krav, leverancer og testkriterier.
4. Brug `data/execution-waves.json` til at vælge opgaver med leverede forudsætninger. Numrene er IDer, ikke en sekventiel kø.
5. Lad en separat verifier kontrollere ændringen; mennesker beholder godkendelse. Lokal udvikling kræver ikke, at platformens fremtidige approval-service allerede findes.

En kodeagent skal kunne træffe almindelige implementeringsvalg uden at skifte til en formel planner-rolle. Den må ikke omdefinere ændringens scope, ophæve kontrolkrav eller godkende sit eget arbejde.

## Indhold

- 66 direkte kodeprompts i `prompts/`.
- `tasks.json`: samme opgaver og krav i maskinlæsbart format.
- `data/requirements.json`: krav koblet til opgaver.
- `data/execution-waves.json`: afhængighedsrækkefølge.
- `data/applikationer.json` og `reference/applikationskatalog.md`: 169 modulbeskrivelser og kandidater.
- `reference/`: detaljerede sikkerheds-, drifts-, installations- og testkrav som opslagsmateriale.

Opgaver, der tidligere lød som planlægning, har nu konkrete kodeleverancer: schemaer, validatorer, konfiguration, registre, CI-checks eller testværktøjer. Dokumentation alene er ikke en færdig kodeopgave. Registrering af et branche-/HR-modul er heller ikke det samme som en færdig forretningsapplikation; prompten gør forskellen eksplicit.

Juridiske ejerbeslutninger, menneskelig godkendelse, faktiske driftsperioder og uafhængige pentests kan ikke erstattes af genererede PASS-resultater. Agenten bygger de tilhørende funktioner og rapporterer manglende ekstern evidens ærligt.

Pakken indeholder ikke repositorykode eller credentials. Der er ikke ændret eller pushet kode ved at lave disse prompts.

## Kodeopgaver

| Prompt | Leverance | Forudsætninger |
|---|---|---|
| [DKC-001](prompts/DKC-001.md) | Implementér reproducerbar baselinekontrol | Ingen |
| [DKC-002](prompts/DKC-002.md) | Implementér deployment- og identitetskontrakter | DKC-001 |
| [DKC-003](prompts/DKC-003.md) | Erstat identitets-shims med verificerbar autentifikation | DKC-002 |
| [DKC-004](prompts/DKC-004.md) | Gør godkendelser autentiske og bundet til ændringen | DKC-003 |
| [DKC-005](prompts/DKC-005.md) | Luk runtime-bypass af godkendelser | DKC-004, DKC-055 |
| [DKC-006](prompts/DKC-006.md) | Håndhæv kundeadskillelse gennem hele kontrolplanet | DKC-003 |
| [DKC-007](prompts/DKC-007.md) | Stram policy-, scope- og evidenskontrol | DKC-003, DKC-006 |
| [DKC-008](prompts/DKC-008.md) | Indfør holdbar tilstand og migrationer | DKC-002, DKC-006 |
| [DKC-009](prompts/DKC-009.md) | Gør audit holdbar og stop handlinger ved logsvigt | DKC-007, DKC-008 |
| [DKC-010](prompts/DKC-010.md) | Udsted reelle kortlivede rettigheder og nødstop | DKC-003, DKC-007, DKC-055 |
| [DKC-011](prompts/DKC-011.md) | Indfør værktøjsgrænse og injection-tests | DKC-007, DKC-010 |
| [DKC-012](prompts/DKC-012.md) | Gør modelgateway anvendelig og budgetter bindende | DKC-003, DKC-006, DKC-008, DKC-011 |
| [DKC-013](prompts/DKC-013.md) | Gør eksekvering genoptagelig og idempotent | DKC-005, DKC-008, DKC-009 |
| [DKC-014](prompts/DKC-014.md) | Byg reproducerbare artefakter og beskyt releasevejen | DKC-001, DKC-002, DKC-063 |
| [DKC-015](prompts/DKC-015.md) | Etabler reproducerbar staging med GitOps | DKC-008, DKC-010, DKC-014 |
| [DKC-016](prompts/DKC-016.md) | Bevis backup og gendannelse | DKC-013, DKC-015 |
| [DKC-017](prompts/DKC-017.md) | Tilslut reel overvågning og hændelseshåndtering | DKC-009, DKC-015 |
| [DKC-018](prompts/DKC-018.md) | Adskil kontraktchecks fra integration og driftsbevis | DKC-007, DKC-015, DKC-063 |
| [DKC-019](prompts/DKC-019.md) | Implementér dataregister og retentionkonfiguration | DKC-002, DKC-006, DKC-012 |
| [DKC-020](prompts/DKC-020.md) | Gør indsigt og eksport til en rigtig tværgående proces | DKC-013, DKC-019, DKC-024 |
| [DKC-021](prompts/DKC-021.md) | Håndhæv sletning, legal hold og gendannelsesregler | DKC-016, DKC-019, DKC-020, DKC-048 |
| [DKC-022](prompts/DKC-022.md) | Implementér evidens- og risikoregister | DKC-017, DKC-018, DKC-019, DKC-021, DKC-047 |
| [DKC-023](prompts/DKC-023.md) | Lav fælles adapterværktøjer og godkendelsestest | DKC-002, DKC-006, DKC-007, DKC-018, DKC-019, DKC-037, DKC-047, DKC-053 |
| [DKC-024](prompts/DKC-024.md) | Bevis Keycloak og Mattermost mod rigtige instanser | DKC-003, DKC-015, DKC-023 |
| [DKC-025](prompts/DKC-025.md) | Byg portal og kundens livscyklus | DKC-004, DKC-006, DKC-013, DKC-015, DKC-023 |
| [DKC-026](prompts/DKC-026.md) | Integrér filer og kontorsamarbejde | DKC-016, DKC-021, DKC-023, DKC-025 |
| [DKC-027](prompts/DKC-027.md) | Integrér projektstyring | DKC-016, DKC-021, DKC-023, DKC-025 |
| [DKC-028](prompts/DKC-028.md) | Integrér vidensbase og rettighedsbevidst søgning | DKC-011, DKC-012, DKC-021, DKC-023, DKC-025 |
| [DKC-029](prompts/DKC-029.md) | Integrér support og sagsbehandling | DKC-021, DKC-023, DKC-025 |
| [DKC-030](prompts/DKC-030.md) | Integrér CRM med entydigt ejerskab af kundedata | DKC-021, DKC-023, DKC-025 |
| [DKC-031](prompts/DKC-031.md) | Byg migrations- og exitværktøjer | DKC-020, DKC-025, DKC-026, DKC-027, DKC-028, DKC-029, DKC-030 |
| [DKC-032](prompts/DKC-032.md) | Indfør AI-drift i skyggetilstand og begrænset autonomi | DKC-005, DKC-010, DKC-011, DKC-012, DKC-013, DKC-017, DKC-024, DKC-046, DKC-049 |
| [DKC-033](prompts/DKC-033.md) | Implementér pilotforløb og readiness-kontrol | DKC-016, DKC-017, DKC-018, DKC-022, DKC-024, DKC-025, DKC-026, DKC-027, DKC-028, DKC-029, DKC-030, DKC-031, DKC-032, DKC-062, DKC-065 |
| [DKC-034](prompts/DKC-034.md) | Implementér forbrugs- og driftsomkostningsmåling | DKC-002, DKC-017, DKC-025 |
| [DKC-035](prompts/DKC-035.md) | Implementér modulregistrering for økonomi, HR og handel | DKC-022, DKC-023, DKC-030, DKC-033, DKC-034 |
| [DKC-036](prompts/DKC-036.md) | Implementér enterprise- og brancheprofiler | DKC-023, DKC-033, DKC-034, DKC-035 |
| [DKC-037](prompts/DKC-037.md) | Implementér serviceklasser og recoverymål | DKC-002 |
| [DKC-038](prompts/DKC-038.md) | Implementér HA-klynge og sikker kommunikation mellem servere | DKC-015, DKC-037 |
| [DKC-039](prompts/DKC-039.md) | Implementér database-HA med fencing og konsistent failover | DKC-008, DKC-037, DKC-038 |
| [DKC-040](prompts/DKC-040.md) | Gør beskeder og jobkø robuste på tværs af servere | DKC-013, DKC-038 |
| [DKC-041](prompts/DKC-041.md) | Implementér holdbart fil- og objektlager | DKC-037, DKC-038 |
| [DKC-042](prompts/DKC-042.md) | Indfør uafhængig backup, PITR og katastrofegendannelse | DKC-016, DKC-039, DKC-041 |
| [DKC-043](prompts/DKC-043.md) | Indfør sikker deduplikering og kontrolleret oprydning | DKC-006, DKC-042 |
| [DKC-044](prompts/DKC-044.md) | Etabler sammenhængende ITSM med menneskelige ejere | DKC-017, DKC-025, DKC-037 |
| [DKC-045](prompts/DKC-045.md) | Implementér menneskestyret change og runbookgodkendelse | DKC-004, DKC-005, DKC-014, DKC-044, DKC-055 |
| [DKC-046](prompts/DKC-046.md) | Implementér begrænset selvreparation med sikker fallback | DKC-010, DKC-011, DKC-013, DKC-017, DKC-038, DKC-045, DKC-048, DKC-055 |
| [DKC-047](prompts/DKC-047.md) | Implementér dataklasser for AI-immutable | DKC-007, DKC-019, DKC-037 |
| [DKC-048](prompts/DKC-048.md) | Håndhæv immutable data uden for agentens kontrol | DKC-010, DKC-041, DKC-047 |
| [DKC-049](prompts/DKC-049.md) | Gør logging komplet på tværs af agenter og servere | DKC-009, DKC-017, DKC-040, DKC-048 |
| [DKC-050](prompts/DKC-050.md) | Bevis vandret skalering og kapacitet under fejl | DKC-012, DKC-026, DKC-027, DKC-038, DKC-039, DKC-040, DKC-041 |
| [DKC-051](prompts/DKC-051.md) | Kør fejl- og katastrofetests inklusive immutable og dedup | DKC-042, DKC-043, DKC-046, DKC-049, DKC-050 |
| [DKC-052](prompts/DKC-052.md) | Implementér beredskabsøvelser og overtagelseskontrol | DKC-022, DKC-032, DKC-044, DKC-045, DKC-051 |
| [DKC-053](prompts/DKC-053.md) | Implementér installationsprofiler og dependency-resolver | DKC-002, DKC-037 |
| [DKC-054](prompts/DKC-054.md) | Byg installer og fælles konfiguration med sikre standarder | DKC-006, DKC-014, DKC-019, DKC-025, DKC-053 |
| [DKC-055](prompts/DKC-055.md) | Håndhæv præcis én rolle pr. agent gennem hele workflowet | DKC-003, DKC-004, DKC-007 |
| [DKC-056](prompts/DKC-056.md) | Tilbyd indbyggede og eksterne datatjenester med entydigt ejerskab | DKC-008, DKC-019, DKC-053 |
| [DKC-057](prompts/DKC-057.md) | Gør eksterne backupmål konfigurerbare og testbare | DKC-016, DKC-019, DKC-053, DKC-056 |
| [DKC-058](prompts/DKC-058.md) | Tilføj valgfri sikker server- og OS-administration | DKC-010, DKC-014, DKC-045, DKC-048, DKC-053, DKC-055 |
| [DKC-059](prompts/DKC-059.md) | Implementér providerkontrakter og migrationskontrol | DKC-023, DKC-031, DKC-053, DKC-056 |
| [DKC-060](prompts/DKC-060.md) | Bevis tværgående IAM og dataadgang for Communications, HR, BI og Reporting | DKC-006, DKC-019, DKC-023, DKC-053, DKC-055, DKC-056 |
| [DKC-061](prompts/DKC-061.md) | Gør opdatering, fjernelse, support og offline-drift til produktflows | DKC-014, DKC-031, DKC-053, DKC-054, DKC-057, DKC-059 |
| [DKC-062](prompts/DKC-062.md) | Implementér installations- og releaseacceptance | DKC-022, DKC-054, DKC-055, DKC-057, DKC-060, DKC-061, DKC-064, DKC-066 |
| [DKC-063](prompts/DKC-063.md) | Implementér testmatrix og CI-releasegates | DKC-002 |
| [DKC-064](prompts/DKC-064.md) | Implement continuous security checks and vulnerability lifecycle | DKC-014, DKC-018, DKC-055, DKC-063 |
| [DKC-065](prompts/DKC-065.md) | Implementér pentest-harness og assessment-gates | DKC-062, DKC-064, DKC-066 |
| [DKC-066](prompts/DKC-066.md) | Expose authorized operations, quality and security data to dashboards | DKC-017, DKC-018, DKC-055, DKC-063 |
