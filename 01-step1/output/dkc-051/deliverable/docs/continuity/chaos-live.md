# Levende fejl- og katastrofeøvelse (NOT RUN)

DKC-051's matrix kører deterministisk på syntetiske data og bærer
`measured: false`. Denne fil beskriver den eksterne øvelse i en isoleret,
levende stagingklynge, der skal erstatte modellen med en faktisk måling.

## Status

**NOT RUN.** Der findes ingen isoleret stagingklynge, lastgenerator, levende
hosts eller ekstern KMS i dette miljø. `make chaos-live` afviser derfor med en
eksplicit begrundelse i stedet for at rapportere en falsk grøn øvelse.

## Sådan gennemføres øvelsen

1. Provisionér en isoleret stagingklynge med mindst tre hosts i tre
   fejldomæner, svarende til `infrastructure/ha-plan.json`.
2. Deployér platformen via GitOps. Bekræft at audit, PDP og approval er
   tilgængelige, og at immutable-låsene er aktive.
3. For hvert scenarie i `chaos/failure-matrix.json`: fremkald fejlen, mål
   dataudfald, RPO/RTO, split-brain og om en støjende agent blev stoppet af
   det fælles healingbudget.
4. Bekræft at alle immutable-bypassforsøg afvises og skrives i audit.
5. Gentag øvelsen fra en ren installation uden kundedata.
6. Opdatér `chaos/failure-matrix.json`'s `measurement` med den målte sandhed
   **først** når en navngivet ejer har godkendt resultatet, og rapportér
   afvigelser mellem model og måling ærligt.

## Evidens

Den målte øvelse skal arkiveres som en ekstern evidenspost (DKC-018) og kan ikke
erstattes af modellen. Indtil da er acceptance-kriteriet for den levende øvelse
**NOT RUN**.
