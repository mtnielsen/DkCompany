# Bølge 6: enterprise- og branchepakker

Denne bølge sammensætter de forretningsmoduler, DKC-035 registrerede, til
pakker for enterprise, handel, produktion, feltservice og regulerede brancher.
Den bygger på `BACKLOG.md`, på pilotbehovene fra DKC-033, på
omkostningsmodellen fra DKC-034 og på modulregistreringen fra DKC-035.
**Ingen adapter bygges i denne bølge** — pakkerne gør dem klar til særskilte,
afgrænsede opgaver.

## De fem pakker

| # | Pakke | Segment | Basisprofil | Status | Næste skridt |
| --- | --- | --- | --- | --- | --- |
| 1 | `enterprise-core` | enterprise | `enterprise-dedicated` | `blocked` | Dansk bogføring, moms, e-faktura og løn skal afklares af navngivne fagpersoner. |
| 2 | `retail-commerce` | handel | `ha-cluster` | `blocked` | Forbrugerjura, moms og en godkendt betalingstjeneste. |
| 3 | `field-service` | feltservice | `ha-cluster` | `blocked` | `field-dispatch` og `offline-sync` findes endnu ikke i kataloget; arbejdsmiljø- og persondatavurderinger mangler. |
| 4 | `manufacturing` | produktion | `enterprise-dedicated` | `blocked` | `mes` og `plm` findes endnu ikke i kataloget; produkt- og maskinsikkerhed mangler. |
| 5 | `regulated-care` | reguleret | `enterprise-dedicated` | `blocked` | Sektorregler og den særskilte højrisiko-AI-vurdering mangler. |

Prioriteringsrækkefølgen kommer fra `enterprise/src/priority.mjs`: efterspørgsel
fra pilotvirksomhedsprofilerne og den dokumenterede 12-måneders TCO. Den er en
planlægningsrækkefølge, ikke en bestilling.

## Fælles sikkerhedskontrakter

Alle tre størrelsesprofiler deler de samme fire obligatoriske gates —
`security`, `privacy`, `restore` og `role` — og den samme sikkerhedskerne.
En pakke arver dem og kan ikke forke kontrolplanet. Det håndhæves af
`enterprise-check` og af konformanstesten.

## Fra katalogpost til bestilt byggeopgave

En pakke er en katalogpost. Den bliver kun en byggeopgave, når:

1. testkundens aftale er underskrevet,
2. alle blokerende faglige, sektor- og højrisiko-AI-vurderinger er bekræftet af
   navngivne mennesker, og
3. pakken er eksplicit godkendt med en ordre og et navngivet menneske.

Indtil da er `buildBacklog` tom, og en `catalog-only` komponent forbliver en
katalogpost.

## Ikke mål i denne bølge

- Faktiske adaptere og produktionsdata.
- En underskrevet testkundeaftale eller en bekræftet faglig afgørelse.
- Nye MES-, PLM-, dispatch- eller offline-synkroniseringskomponenter.

Alle tre er NOT RUN og kræver et navngivet menneske eller en ekstern kilde.

## Fravalg

| Fravalg | Begrundelse |
| --- | --- |
| Egen kontrolplan pr. branche | Ville forke sikkerhedskontrakterne; pakkerne arver dem i stedet. |
| Automatisk byggeopgave fra en katalogpost | En branchepakke er en plan — ikke en bestilling. |
| Universel branchedækning | `field-service` og `manufacturing` blokeres ærligt af kapabiliteter, kataloget endnu ikke udstiller. |
| AI uden særskilt vurdering | Højrisiko-AI kræver en særskilt, menneskelig vurdering. |
