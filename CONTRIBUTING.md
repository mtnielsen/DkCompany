# Bidrag

## Før du begynder

Læs [BACKLOG.md](BACKLOG.md) og vælg et punkt. Et punkt er ikke færdigt, før dets konformanstest er grøn i CI — ikke når koden er skrevet.

Rækkefølgen er ikke til forhandling:

```
kontrakt → konformanstest → modul
```

En ændring i `/contracts` skal ledsages af den check i `/conformance`, der bevogter den, i samme commit.

## DCO / sign-off

Alle commits skal være signeret:

```bash
git commit -s -m "kontrakt: tilføj verifikation af trust domain"
```

`-s` tilføjer en `Signed-off-by`-linje, der bekræfter [DCO](DCO). CI afviser pull requests uden sign-off.

## Lokalt løb

```bash
make install      # npm ci i conformance/
make ci           # validate + lint + test + conform-all + conform-negative
```

Kør ét modul:

```bash
make conform MODULE=m dit-modul
```

## Nyt modul

1. Opret `modules/<navn>/module-manifest.json` med udgangspunkt i `contracts/examples/module-manifest.example.json`.
2. Erklær **alle** ops- og privacy-verber — også dem du ikke understøtter. Vær ærlig: brug `partial`/`unsupported` med en rigtig begrundelse frem for at påstå `full`.
3. Læg `fixture`-beviser i `modules/<navn>/conformance/evidence/<verbum>.json` for hvert `full`-verbum.
4. Læg CloudEvent-eksempler i `modules/<navn>/conformance/events/`.
5. Kør `make conform MODULE=<navn>` indtil den er grøn.

## Retningslinjer

- **Vær ærlig i manifestet.** Et `partial` med en klar begrundelse er mere værd end et `full`, der fejler i produktion. Se [ADR-0003](docs/adr/0003-partial-conformance.md).
- **Ingen lokal brugerdatabase.** Identitet kommer fra OIDC. Se [identitetsplanen](docs/spec/identity-plan.md).
- **Evidens er maskinproduceret.** En agent eller et menneske skriver ikke bevis; beviset kommer fra tests, policy, dry-run og diff.
- **Arkitekturvalg kræver en ADR.** Kopiér [docs/adr/template.md](docs/adr/template.md).
- **Alt går gennem git.** Ingen manuelle ændringer i produktion — heller ikke af agenter.

## Fejlfinding

```bash
make validate   # skemaer og eksempler
make lint       # JSON og whitespace
make test       # suitens egne tests
make conform MODULE=x        # ét modul
make conform-negative        # bekræft at den brudte fixture stadig fejler
```
