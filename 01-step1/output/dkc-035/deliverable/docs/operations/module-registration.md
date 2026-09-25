# Drift: modulregistrering og dansk lokalisering (DKC-035)

## Kommandoer

| Kommando | Formål |
| --- | --- |
| `make localization-check` | Validér familier, lokaliseringskrav, adaptergrænseflader, komponenternes `localization`-blok og rapportens synkronisering. |
| `make localization-test` | Kør model-, kandidat-, dæknings-, gate-, resolver- og konformanstestene. |
| `make localization-run` | Kør den deterministiske gate-kontrol og vis hver families afventende gates. |
| `make localization-render` | Skriv `localization/report/localization-report.json` og `docs/localization/module-registration-report.md`. |
| `make localization-report` | Vis rapporten på stdout. |
| `make localization-live` | NOT RUN — kræver en faktisk adapter og en faglig afgørelse. |

## Hvad driften skal se på

1. **Ingen danskklar familie.** Rapporten skal vise `danishReady: false` for
   alle familier, indtil de blokerende lokaliseringskrav er bekræftet af et
   navngivet menneske. En `danishReady: true` med afventende gates er en fejl.
2. **Betaling er `pending`.** `payment-bank` må ikke have en
   `approvedExternalServiceRef`, og ingen scope må matche `bank:full-access`
   eller `cards:`.
3. **Rækkefølgen.** Familierne registreres i rækkefølgen økonomi → fakturering
   → HR → tid → handel. En ændring kræver en ny version af
   `localization/families.json` og en ny begrundelse.
4. **Resolverbarhed.** Hver familie skal kunne løses gennem
   `distribution/src/resolver.mjs` mod sin profil. Et katalogmanifest uden
   provider eller med en ugyldig afhængighed fejler i `make distribution-check`.

## Ændring af et lokaliseringskrav

Et krav må kun gå fra `unreviewed`/`pending` til `confirmed`, når:

- `reviewedBy` er et navngivet menneske (`oidc|navn`),
- `reviewedAt` er sat,
- `evidence` henviser til et konkret dokument, og
- rapporten er regenereret med `make localization-render`.

Kravet ændres i `localization/locale-requirements.json`; familiens udledte
status følger automatisk. Kør herefter `make localization-check`,
`make localization-test`, `make localization-render` og `make validate`.

## Fejlsøgning

- `INSUFFICIENT_RESOURCES` i `make distribution-check`: en familie er tilføjet
  en profil, der ikke har kapacitet. Fjern den fra profilens
  `optionalApplications`, eller vælg en større profil.
- `localization/report/localization-report.json er ude af trit`: kør
  `make localization-render`.
- `kandidatfilen ... findes ikke`: kandidatreferencen i
  `localization/families.json` eller komponentens `localization.candidateRef`
  peger på en fil, der ikke ligger i `contracts/examples/`.
