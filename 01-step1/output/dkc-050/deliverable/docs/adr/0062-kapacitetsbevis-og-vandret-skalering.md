# Kapacitetsbevis og vandret skalering

- **Status:** accepteret
- **Beslutningstagere:** Anna Andersen (Platform Owner), Cecilia Christensen (Security Owner)
- **Dato:** 2026-09-24
- **Beslutningsdrev:** DKC-050 kræver, at kapacitet og begrænsninger måles i stedet for at antage, at flere replikaer giver lineær skalering.

## Kontekst og problemstilling

Et platformsefterspørgsel vokser i tre kundestørrelser og i belastningstrin. Uden en reproducerbar lastprofil og en model over flaskehalse kan et system se skalerbart ud i et diagram, mens det i praksis kollapser ved 5x på grund af en enkelt stateful komponent, en mættet connection pool eller en støjende tenant. Samtidig må en kapacitetsmangel ikke føre til tab af kvitterede data.

## Beslutningskriterier

- En reproducerbar lastprofil pr. kundestørrelse med samtidige brugere, requests, jobs, filer, data og AI-kald.
- Baseline og væksttest ved 1x/2x/5x på mindst tre hosts med N+1.
- Autoskalering for stateless og køworkers; stateful skalering kun efter signeret runbook.
- Tenantkvoter med vægtet fairness, så en støjende tenant ikke kan forbruge alle ressourcer.
- Connection pools, backpressure og enhedspris.
- En app uden multi-active-support må ikke kunne skaleres ved blot at øge replikatællingen.
- Overskredet kapacitet afvises kontrolleret, og en kvittering gives først efter holdbar skrivning.

## Overvejede muligheder

- **A:** Antag lineær skalering og skru op for replikatællingen, når belastningen stiger.
- **B:** En deterministisk kapacitetsmodel med målbar kapacitet pr. replika, kømodel for latens, tenantfairness og en eksplicit, runbookstyret stateful-plan; en levende lasttest er en ekstern integration.
- **C:** Køb en kommerciel kapacitetsplanlægger og stol på dens tal.

## Beslutning

Vi vælger **B**. `performance/capacity-plan.json` erklærer tre lastprofiler, tre hosts i tre fejldomæner og en kapacitet pr. replika for hvert workload. `performance/src/projection.mjs` projektér hver profil ved 1x/2x/5x og rapporterer throughput, p95/p99, fejlrate, køalder, replikeringslag og pris. Latensen vokser efter en kømodel, så en flaskehals bliver synlig. `performance/src/quota.mjs` fordeler kapacitet med en vægtet kø og et hårdt loft pr. tenant, og `performance/src/pool.mjs` reserverer admin-forbindelser. Backpressure afviser kontrolleret med en retry-vejledning, og `durableBeforeAck` sikrer, at intet kvitteret arbejde mistes. Stateful workloads autoskalerer aldrig; de kræver `stateful-scaling@1.0.0`. Modellen bærer `measured: false`, og den levende lasttest er en ekstern integration.

### Konsekvenser

- **Positive:** Flaskehalse og ikke-lineær skalering bliver synlige før drift; en støjende tenant begrænses; kapacitetsmangel taber ikke kvitterede data.
- **Negative:** Modellen skal vedligeholdes, når workloads eller hosts ændres, og en målt lasttest mangler stadig.
- **Neutrale:** Kapacitetsplanen er en ny førstepartskomponent uden et modulmanifest; den påvirker ikke de eksisterende serviceklasser.

## Fordele og ulemper ved mulighederne

| Mulighed | Fordele | Ulemper |
| --- | --- | --- |
| A | Simpelt | Skjuler flaskehalse; stateful komponenter skalerer ikke; støjende tenant kan sulte andre |
| B | Synlige flaskehalse, fairness, kontrolleret afvisning, runbookstyret stateful | Kræver vedligeholdt model og en ekstern måling |
| C | Færdigt værktøj | Lukket model, ingen kobling til platformens kontrakter eller runbooks |

## Mere information

- [`docs/spec/performance.md`](../spec/performance.md), [`docs/capacity/scaling-report.md`](../capacity/scaling-report.md), [`docs/capacity/live-load-test.md`](../capacity/live-load-test.md)
- [`performance/capacity-plan.json`](../../performance/capacity-plan.json), [`contracts/capacity-plan.schema.json`](../../contracts/capacity-plan.schema.json)
- [`docs/runbooks/stateful-scaling.md`](../runbooks/stateful-scaling.md), [`docs/adr/0044-ha-klynge-og-sikker-serverkommunikation.md`](0044-ha-klynge-og-sikker-serverkommunikation.md), [`docs/adr/0045-holdbar-beskedudveksling-og-outbox.md`](0045-holdbar-beskedudveksling-og-outbox.md)
