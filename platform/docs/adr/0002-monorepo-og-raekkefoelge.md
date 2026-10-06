# ADR-0002: Monorepo og rækkefølgen kontrakt → test → modul

- **Status:** accepteret
- **Beslutningstagere:** Platformsejerskab
- **Dato:** 2025-09-01
- **Beslutningsdrev:** Vi skal kunne bevise kontrakten mod virkeligheden, før vi skalerer antallet af moduler.

## Kontekst og problemstilling

Kontrakter, konformanstest og moduler hænger uløseligt sammen. Hvis de lever i hvert sit repo, driver de fra hinanden, og conformance bliver en manuel eftersynkronisering. Samtidig frister det at bygge moduler først, fordi de giver synlig fremdrift — men et modul bygget uden en testbar kontrakt fastfryser tilfældige valg.

## Beslutningskriterier

- Kontraktændringer og konformanstest skal kunne ændres i samme commit.
- CI skal kunne afvise et modul, der bryder kontrakten, uden menneskelig fortolkning.
- Rækkefølgen skal kunne håndhæves af værktøj, ikke af disciplin alene.

## Overvejede muligheder

- **Polyrepo pr. modul.** Klar ejerskabsgrænse, men kontraktdrift og tung krydsrepo-CI.
- **Monorepo med moduler først.** Hurtig synlig fremdrift, men kontrakten bliver en efterrationalisering.
- **Monorepo med kontrakt → konformanstest → modul.** Moduler kan ikke merges uden at bestå suiten.

## Beslutning

Vi bruger ét monorepo med følgende topniveau:

- `/contracts` — JSON Schema-kontrakter og eksempler.
- `/conformance` — kørbar testsuite, der læser kontrakterne og dømmer moduler.
- `/modules` — reference- og adaptermoduler med `module-manifest.json`.
- `/policy` — policy-bundles (tomt i bølge 0; fyldes i bølge 1).
- `/docs/adr` — beslutningslog i MADR-format.
- `/docs/spec` — de fire planer i prosa.

Rækkefølgen håndhæves af CI: `make validate` og `make test` skal være grønne, før `make conform-all` overhovedet giver mening for et nyt modul.

## Konsekvenser

- **Positive:** En kontraktændring og den test, der bevogter den, lander atomisk. CI kan skelne mellem et gyldigt og et ugyldigt modul uden menneskelig vurdering.
- **Negative:** Monorepoet vokser, og alle moduler deler CI-tid. Vi accepterer det indtil videre og opsætter path-filtre, når antallet af moduler retfærdiggør det.
- **Neutrale:** Moduler committes som fixtures (`dummy-ok`, `dummy-broken`) og senere som rigtige adaptere.

## Mere information

- `Makefile` (`validate`, `lint`, `test`, `conform`, `conform-all`, `conform-negative`)
- `.github/workflows/ci.yml`
- `docs/spec/conformance-suite.md`
