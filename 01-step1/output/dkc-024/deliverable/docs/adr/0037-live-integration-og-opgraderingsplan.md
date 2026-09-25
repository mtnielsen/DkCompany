# Live integration og opgraderingsplan for adaptere

- **Status:** accepteret
- **Beslutningstagere:** Platform Owner, Solution Architect
- **Dato:** 2026-09-23
- **Beslutningsdrev:** DKC-023 godkendte adaptere pr. eksakt upstream-version/edition, men der fandtes ingen måde at binde godkendelsen til en konkret live-integration eller til en kontrolleret opgradering/rollback.

## Kontekst og problemstilling

Adapterne var kun efterprøvet mod mock-instanser. En releaseprofil lovede en
verbumskontrakt, men ingen miljøbinding, ingen live-prøve og ingen plan for,
hvordan versionen opgraderes eller rulles tilbage. Uden det kan en mock-test
forveksles med drift, og en opgradering kan gennemføres uden frisk backup eller
verificeret gendannelse.

## Beslutningskriterier

- Live-drift må ikke kunne påstås fra en konfigurationsfil eller et mock-pass.
- Den pinnede version/edition skal matche den menneskeligt godkendte releaseprofil.
- En demo-identitet må aldrig give produktionsadgang, heller ikke gennem en
  fejlkonfigureret authenticator.
- En opgradering skal have obligatorisk backup, verificeret rollback og et
  eksplicit nedetidsbudget.
- Restdata (sletning/hold) skal rapporteres ærligt, også efter en rollback.

## Overvejede muligheder

- **A:** Lade live-integration være en manuel, udokumenteret øvelse.
- **B:** Genbruge DKC-018-proberne direkte og lade dem kalde adapterne.
- **C:** En adapter-specifik live-kører med pinnede mål, en obligatorisk
  opgraderings-/rollbackplan og et uafhængigt demo-værn.

## Beslutning

Vi indfører en adapter-specifik live-kører (`adapter-sdk/src/live.mjs`) og en
opgraderings-/rollbackplan (`adapter-sdk/src/upgrade.mjs`), begge udledt af
`adapter-sdk/live-targets.json` og de godkendte releaseprofiler. Et live-mål
pinner eksakt version/edition, kræver miljøbindinger og beskriver scope, rate
limits og restdata. Hvert privacy-verbum med et endpoint skal have en prøve, og
et `partial`-verbum må ikke prøves som `full`. Demo-principaler afvises i
verbumskæden uden for testprofilen (`adapter-sdk/src/guards.mjs`). Manglende
bindinger giver `not-run`, aldrig `pass`.

### Konsekvenser

- **Positive:** Live-drift, demo-værn, partial-ærlighed og opgradering/rollback
  bliver maskinelt håndhævede og kan ikke forveksles med mock-test.
- **Negative:** Rigtige instanser og credentials er stadig nødvendige for det
  fulde driftsbevis; DKC-024's to live-acceptkriterier forbliver NOT RUN uden dem.
- **Neutrale:** Releaseprofilernes `partial`-verber bærer ikke endpoint; derfor
  læses endpointet fra modulmanifestet i live-validatoren.

## Fordele og ulemper ved mulighederne

| Mulighed | Fordele | Ulemper |
| --- | --- | --- |
| A | Ingen ny kode | Kan ikke skelne mock fra drift; ingen rollback-garanti |
| B | Genbruger prober | Prober er komponentrettede, ikke adapter/verbumsrettede; ingen pinning eller plan |
| C | Pinning, ærlighed og gated opgradering | Kræver rigtige instanser for fuldt driftsbevis |

## Mere information

- `docs/spec/adapter-live-integration.md`
- `docs/runbooks/upstream-upgrade-rollback.md`
- `adapter-sdk/live-targets.json`, `adapter-sdk/src/live.mjs`, `adapter-sdk/src/upgrade.mjs`, `adapter-sdk/src/guards.mjs`
- `contracts/upstream-upgrade-plan.schema.json`
- ADR-0036 (fælles adapter-SDK), ADR-0034 (evidensmodes)
