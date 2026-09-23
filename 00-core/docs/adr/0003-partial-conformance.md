# ADR-0003: Partial conformance frem for binær

- **Status:** accepteret
- **Beslutningstagere:** Platformsejerskab
- **Dato:** 2025-09-01
- **Beslutningsdrev:** Uden et ærligt "partial" vil alle manifester lyve, og kontrakten bliver ubrugelig.

## Kontekst og problemstilling

Virkelige systemer kan sjældent alt. En upstream-tjeneste kan måske eksportere persondata, men ikke slette dem, fordi en ekstern opbevaringspligt forhindrer det. Hvis kontrakten kun kender `supported`/`unsupported`, tvinges modulet til enten at overdrive (sige ja til noget det ikke kan) eller underdrive (sige nej til noget det faktisk kan). Begge gør konformansrapporten værdiløs som beslutningsgrundlag.

## Beslutningskriterier

- Et manifest skal kunne beskrive delvis evne uden at skjule begrænsningen.
- Konformanssuiten skal kunne skelne "kan ikke" fra "kan delvist" fra "kan fuldt".
- En `full`-erklæring skal kræve deterministisk bevis, ikke en påstand.
- Manglende begrundelse skal være en hård fejl, ikke en advarsel.

## Overvejede muligheder

- **Binær (supported/unsupported).** Enkel, men tvinger løgn eller underdrivelse.
- **Fri tekst pr. verbum.** Fleksibel, men umulig at aggregere maskinelt.
- **Tre niveauer med obligatorisk begrundelse.** `full` / `partial` / `unsupported`.

## Beslutning

Hvert verbum erklæres med `conformance`:

- `full` — virker end-to-end og kræver `endpoint` samt `evidence` af typen `fixture` eller `probe`. `declared` accepteres ikke.
- `partial` — virker delvist og kræver en `reason` på mindst 10 tegn, der forklarer hvad der ikke kan lade sig gøre.
- `unsupported` — kan ikke lade sig gøre og kræver ligeledes en `reason`.

Reglen håndhæves to steder: i `module-manifest.schema.json` (så ugyldige manifester ikke kan committes) og i konformanssuiten (så en kortfattet eller meningsløs begrundelse rapporteres som fejl).

## Konsekvenser

- **Positive:** En adapter mod en stædig upstream kan erklære `partial` på `subject.erase` og blive accepteret som ærlig, ikke dumpet som fejl. Det er forudsætningen for, at DSAR-orkestratoren kan rapportere et samlet resultat med per-modul status.
- **Negative:** Flere felter at vedligeholde, og risikoen for at `partial` bruges som undskyldning. Derfor kræver `full` bevis, og en placeholder-begrundelse afvises.
- **Neutrale:** Conformance-niveauet følger verbet, ikke modulet — samme modul kan være `full` på backup og `partial` på erase.

## Mere information

- `contracts/module-manifest.schema.json` (`$defs.verbSupport`, `$defs.evidenceRef`)
- `contracts/privacy-response.schema.json` (per-modul status)
- `conformance/src/checks/honesty.mjs`
