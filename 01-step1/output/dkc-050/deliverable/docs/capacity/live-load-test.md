# Levende lasttest (NOT RUN)

DKC-050's model er deterministisk og bærer `measured: false`. Denne fil
beskriver den eksterne test, der skal erstatte modellen med en faktisk måling.

## Status

**NOT RUN.** Der findes ingen levende klynge, lastgenerator, rigtige hosts eller
ekstern database i dette miljø. `make performance-live` afviser derfor med en
eksplicit begrundelse i stedet for at rapportere en falsk grøn måling.

## Sådan gennemføres testen

1. Provisionér mindst tre hosts i tre fejldomæner svarende til
   `performance/capacity-plan.json`.
2. Deployér platformen via GitOps og bekræft, at de genererede autoscalere er
   aktive (`gitops/manifests/performance/`).
3. Kør en lastgenerator mod de tre lastprofiler ved 1x, 2x og 5x i mindst
   30 minutter pr. trin, med en enkelt støjende tenant blandt de samtidige
   tenanter.
4. Mål throughput, p95/p99, fejlrate, køalder, replikeringslag og pris pr.
   måned pr. trin.
5. Tag én host ud og mål N+1-kapaciteten igen.
6. Opdatér `performance/capacity-plan.json`'s `capacityReport.measurement` med
   den målte sandhed **først** når en navngivet ejer har godkendt resultatet, og
   rapportér afvigelser mellem model og måling ærligt.

## Evidens

Den målte rapport skal arkiveres som en ekstern evidenspost (DKC-018) og kan
ikke erstattes af modellen. Indtil da er acceptance-kriteriet for den levende
måling **NOT RUN**.
