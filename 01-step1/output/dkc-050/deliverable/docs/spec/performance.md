# Kapacitet og vandret skalering

DKC-050 måler kapacitet og begrænsninger i stedet for at antage, at flere
replikaer giver lineær skalering. Planen ligger i
[`performance/capacity-plan.json`](../../performance/capacity-plan.json) og
valideres mod
[`contracts/capacity-plan.schema.json`](../../contracts/capacity-plan.schema.json).

## Reproducerbar lastprofil

Planen erklærer tre kundestørrelser (lille, mellemstor, stor) med seks
dimensioner hver: samtidige brugere, requests pr. sekund, jobs pr. sekund,
filer pr. dag, datamængde og AI-kald pr. dag. Den mellemstore profil er baseline
for N+1-målingen. Profilerne er syntetiske og ændres kun med en ny version af
planen.

## Baseline og væksttest

`buildCapacityReport` projektér hver lastprofil ved 1x, 2x og 5x repræsentativ
belastning. For hvert trin rapporteres throughput, p95/p99, fejlrate, køalder,
replikeringslag, pris pr. måned og den aktuelle flaskehals. Replikaerne udledes
af autoscalerens politik, ikke af en fast antagelse. Projektionen bærer
`measured: false`: det er en deterministisk model, og en levende lasttest på
mindst tre hosts er en ekstern integration
([`docs/capacity/live-load-test.md`](../capacity/live-load-test.md)).

## Autoskalering

- **Stateless tjenester** skalerer efter CPU-utilisering inden for en fast
  replikaramme og respekterer cooldowns for op- og nedskalering.
- **Køworkers** skalerer efter kødybde.
- **Stateful workloads** autoskalerer aldrig. De kræver en signeret runbook og
  et menneske, og en app uden multi-active-support vinder intet ved at øge
  replikatællingen. Se [`docs/runbooks/stateful-scaling.md`](../runbooks/stateful-scaling.md).

De genererede politikker ligger i `gitops/manifests/performance/` og genskabes
med `make performance-render`.

## Tenantkvoter, fairness og pools

- Hver tenant har en kvote (requests/s, samtidige jobs, lager, AI-kald,
  forbindelser). En overskreden kvote afvises med `429`.
- Fordelingen bruger en vægtet kø (`weighted-fair-queue`) med en reserveret
  mindsteandel og et hårdt loft pr. tenant (`maxSharePercent`). En støjende
  tenant kan derfor ikke forbruge alle ressourcer.
- Connection pools har et hårdt loft pr. replika og reserverer forbindelser til
  administration, så tenanttrafik ikke sulter drift og failover.

## Backpressure og kontrolleret afvisning

Når køen når `queueDepthCritical`, pauses udgivere, og nye forespørgsler afvises
med `503` og en retry-vejledning. En kvittering gives først efter holdbar
skrivning (`durableBeforeAck`), så et allerede kvitteret stykke arbejde ikke går
tabt ved kapacitetsmangel. Backpressure stemmer med beskedtopologien i
[`jobs/messaging.json`](../../jobs/messaging.json) (DKC-040).

## Enhedspris

Prisen pr. request, job, AI-kald og GB samt pr. vCPU-time ligger i planens
`cost`-blok. `performance/src/cost.mjs` regner enhedsprisen, og rapporten viser
pris pr. måned før/efter skalering.

## Checks

| Check | Formål |
| --- | --- |
| `make performance-render` | Skriv autoscaler-/kvote-/PDB-manifester og rapport fra planen |
| `make performance-check` | Skema, semantik, renderede filer, HA- og beskedkrydsvalidering |
| `make performance-test` | Projektion, kvoter, fairness, autoskalering, pools og konformans |
| `make performance-drill` | Deterministisk kapacitets- og skaleringsøvelse |
| `make performance-live` | Rigtig lasttest på levende hosts — **NOT RUN** (ekstern) |
