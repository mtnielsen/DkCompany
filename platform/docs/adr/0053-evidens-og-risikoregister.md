# ADR-0053 — Evidens- og risikoregister med menneskelige beslutninger

- **Status:** accepteret
- **Beslutningstagere:** Platform Owner, Security Owner, Data Protection Officer
- **Dato:** 2026-09-24
- **Beslutningsdrev:** DKC-022. ADR-0029 gav et dataregister, ADR-0034 skilte kontraktchecks og driftsbevis, ADR-0048/0049 gjorde beskyttelse og sletning fysisk, og ADR-0052 gjorde dedup målbar. Det mangler at knytte hvert krav til en faktisk kontrol, en ansvarlig person og verificeret evidens — og at gøre åbne juridiske beslutninger synlige i stedet for at antage dem.

## Kontekst og problemstilling

Platformen producerer mange artefakter: kontrolmapping, dataregister, konformansrapporter, evidensposter og risikovurderinger. De svarer hver især på et spørgsmål, men ingen af dem svarer samlet på:

- hvilke krav gælder, hvor de kommer fra, og hvem der er ansvarlig,
- om kravet er dækket af en faktisk kontrol og af hvilken evidens,
- om evidensen er frisk, bundet til det rigtige commit/image/miljø og ikke
  ændret manuelt,
- hvilke juridiske eller organisatoriske beslutninger der stadig er åbne, og
- om en pilot med persondata er blokeret.

Uden det kan en grøn konformansrapport forveksles med en certificering, og en
manglende DPIA kan forsvinde i prosa.

## Beslutningskriterier

- Hvert krav skal have kilde, dato, ansvarlig, status, kontrol og evidenslink.
- Automatiseret kontrolmapping må ikke beskrives som certificering.
- Forældet eller artefakt-mismatchet evidens skal afvises med en stabil årsag.
- Automatiseret evidens, manglende vurderinger og menneskelige beslutninger skal
  være tydeligt adskilte.
- En åben juridisk/organisatorisk beslutning skal have en ansvarlig person og
  skal kunne blokere en persondatapilot.
- En eksport må ikke automatisk erklære platformen compliant eller
  production-ready.
- Kun et verificeret menneske må acceptere et krav, og ikke sit eget.

## Overvejede muligheder

- **A: Prosa i `docs/compliance/`.** Let at læse, men kan ikke valideres, og en
  manglende beslutning forsvinder.
- **B: Genbrug af release-matricen alene.** Giver krav og checks, men ingen
  ejerbeslutninger, DPIA, overførselsvurdering eller exitprocedure.
- **C: Et struktureret evidens- og risikoregister plus en samlet evidenspakke og
  en autoriseret accepttjeneste.** Flere komponenter, men hvert
  acceptkriterium bliver efterprøveligt, og menneskelige beslutninger forbliver
  menneskelige.

## Beslutning

Vi vælger **C**. `compliance/assurance-register.json` er den kanoniske kilde, og
`compliance/src/assurance*.mjs` samt `conformance/src/assurance.mjs`
implementerer:

1. **Kravregister:** kilde, dato, ansvarlig, status, kontrolreference og
   evidenslinks; et krav uden evidens skal markeres `missing-evidence`.
2. **DPIA-screening, databehandleraftaler, underdatabehandlere og
   overførselsvurdering** med navngivne beslutningstagere; en udestående
   screening eller overførsel er eksplicit blokerende.
3. **AI Act-/NIS2-/GDPR-anvendelighed** efter brug, rolle og sektor, vurderet af
   et navngivet menneske.
4. **Incidentproces, adgangsrevision, informationspligt og exitprocedure** med
   navngivne ejere.
5. **Evidenspakken** (`assembleEvidencePackage`) genbruger
   `evidence-mode.mjs`: den afviser udløbet, forkert-bundet og manuelt ændret
   evidens og skelner automatiseret evidens fra menneskebeslutninger og
   manglende vurderinger.
6. **Ikke-certificering:** `notACertification: true`, `complianceStatus:
   not-certified`, og `productionReady` kræver produktionsevidence uden
   blokere. Hverken eksport eller badge ændrer det.
7. **Autoriseret accept** (`assurance-service.mjs`): default-deny, kun et
   verificeret menneske med accept-rolle, en begrundelse og et andet subject end
   kravets ejer. Hver accept bevares i en hash-kædet append-only journal
   (`assurance-ledger.mjs`).

En faktisk DPIA, en faktisk overførselsvurdering, en gennemført brudøvelse og
en målt produktionsevidence er **NOT RUN**; de kræver et navngivet menneske
eller et eksternt system.

## Konsekvenser

- En manglende beslutning er synlig som en blokerende post, ikke en antagelse.
- En grøn konformansrapport er ikke og kan ikke blive en certificering.
- Et krav kan accepteres uden at det ændrer pakkens compliance-status.
- Registeret krydsrefereres mod dataregister og kontrolmapping, så en
  uoverensstemmelse fanges.
