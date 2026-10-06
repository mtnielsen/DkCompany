# ADR-0028: Krav-til-test-matrix og en fail-closed release-gate

- **Status:** accepteret
- **Beslutningstagere:** Anna Andersen (Platform Owner), med Bo Bertelsen som stedfortræder
- **Dato:** 2026-09-23
- **Beslutningsdrev:** DKC-063. Platformen har mange checks, men ingen maskinlæsbar kobling mellem et krav og den check der beviser det, og ingen gate der skelner mellem bestået, sprunget over, ikke-kørt, ikke-understøttet, forældet og bundet til et forkert artefakt. Uden det kan en grøn enhedstest fejlagtigt læses som produktions-, HA- eller compliance-status, og en implementør kan komme til at fremstå som uafhængig verifikator.

## Kontekst og problemstilling

- **En grøn check er ikke et krav opfyldt.** Uden en kobling ved ingen hvilke krav en check dækker, og hvilke testtyper der mangler.
- **Statusforskelle forsvinder.** Et `NOT RUN`, et `FAIL` og et `PASS` bliver let til "ikke grøn", men de er ikke det samme, og et forældet eller forkert bundet resultat er heller ikke et bestået resultat.
- **Evidens skal kunne spores.** Et resultat uden commit, artefakt-digest, miljø, producent, kommando og tidsstempel kan ikke bruges til en release.
- **Implementør og uafhængig verifikator er ikke det samme.** En lokal kørsel kan ikke erstatte en penetrationstest, en levende måling eller en ekstern revision.
- **Undtagelser skal udløbe.** En mundtlig undtagelse uden ejer og udløbsdato er en permanent svækkelse.

## Beslutningskriterier

- Versioneret testmatrix der mapper krav til unit-, kontrakt-, integrations-, end-to-end-, autorisations-, installations-, migrations-, performance- og recovery-checks.
- En resultatkontrakt og en eksekverbar validator/aggregator integreret med den eksisterende CI.
- Distinkte statusser; kun `passed` tæller som bestået.
- Evidens binder commit, artefakt-digest, konfiguration/profil, miljø, producent, kommando og tidsstempler.
- Implementørevidens kan ikke opfylde et uafhængigt vurderingskrav.
- Konfigurerbare, ejergodkendte tærskler og tidsbegrænsede, menneskeejede risikoundtagelser.
- En trusselmodel bundet til de testede grænser.

## Overvejede muligheder

- **Kun prosadokumenteret teststrategi.** Let at skrive, men ikke efterprøveligt, og det ændrer sig ikke når koden gør.
- **Genbrug implementation-matrix.md som gate.** Den viser modenhed pr. komponent, men kobler ikke krav til checks, tæller ikke freshness/wrong-artifact og har ingen producent-adskillelse.
- **En maskinlæsbar matrix + en ren gate-evaluator oven på baseline-evidensen.** Kræver vedligeholdelse, men gør hvert krav efterprøveligt og hver undtagelse synlig og tidsbegrænset.

## Beslutning

Vi indfører en versioneret testmatrix og en fail-closed release-gate, håndhævet i
`contracts/test-matrix.schema.json`,
`contracts/threat-register.schema.json`,
`contracts/risk-exception.schema.json`,
`contracts/independent-assessment.schema.json`,
`contracts/release-gate-result.schema.json`, `conformance/src/release.mjs` og
`release/`:

1. **Matrixen** (`kind: TestMatrix`) mapper hvert krav til navngivne checks med
   testtyper og til en valgfri uafhængig vurdering. Et obligatorisk krav uden
   checks SKAL have en uafhængig vurdering.
2. **Trusselmodellen** (`kind: ThreatRegister`) dækker præcis de syv testede
   grænser: tenantgrænser, identiteter, agent-handoffs, privilegerede
   host-operationer, uforanderligt lager, telemetri og eksterne kilder. Hver
   trussel peger på de krav der efterprøver den.
3. **Gaten** (`release/src/gate.mjs`) er en ren funktion. Den oversætter
   baseline-status til `passed`, `failed`, `skipped`, `not-run`, `unsupported`,
   `stale`, `wrong-artifact`, `missing`, `pending-independent-assessment` eller
   `excepted`. Kun `passed` tæller som bestået.
4. **Evidensbindingen.** Hvert check-resultat bærer commit, artefakt-digest,
   profil, miljø, producent, kommando, tidsstempler og evidenssti. En
   commit-mismatch giver `wrong-artifact`, og evidens ældre end kravets frist
   giver `stale`.
5. **Producent-adskillelse.** Uafhængige vurderinger accepteres kun fra en
   ikke-implementør, med et navngivet menneske og et udløbstidspunkt. En lokal
   implementørkørsel giver `pending-independent-assessment`.
6. **Tærskler og undtagelser.** Tærsklerne har en navngivet menneskelig accept.
   En risikoundtagelse skal have ejer, udløbsdato og kompenserende kontroller,
   må ikke dække et `nonExcepted`-krav, og et udløbet undtagelse gælder ikke.
7. **Dokumenterne genereres** fra de kanoniske data (`docs/testing/test-matrix.md`
   og `docs/security/threat-model.md`) og kontrolleres for sync i
   `make release-check`.

Resultatet valideres i `make validate`, `make release-check`,
`make release-test` og `make release-gate`.

## Konsekvenser

- **Positive:** Hvert krav er efterprøveligt, statusser kan ikke smelte sammen, og
  en implementør kan ikke udgive sig for en uafhængig verifikator. Undtagelser er
  synlige og udløber.
- **Negative:** Matrixen og registrene skal vedligeholdes, og en release kan ikke
  erklæres grøn alene på lokale enhedstests.
- **Neutrale:** Gaten læser den eksisterende baseline-evidens; den indfører ikke
  endnu en testrunner.

## Fordele og ulemper ved mulighederne

| Mulighed | Fordele | Ulemper |
| --- | --- | --- |
| Prosa-teststrategi | Hurtig at skrive | Ikke efterprøvelig; ingen freshness eller producent-adskillelse |
| Genbrug implementation-matrix som gate | Ingen ny data | Kobler ikke krav til checks; ingen wrong-artifact/stale |
| Matrix + ren gate-evaluator | Efterprøveligt, fail-closed, sporbart | Kræver vedligeholdelse og ejeraccept |

## Mere information

- [`docs/spec/release-gates.md`](../spec/release-gates.md)
- [`docs/testing/test-matrix.md`](../testing/test-matrix.md)
- [`docs/security/threat-model.md`](../security/threat-model.md)
- [`contracts/test-matrix.schema.json`](../../contracts/test-matrix.schema.json),
  [`contracts/release-gate-result.schema.json`](../../contracts/release-gate-result.schema.json)
- [`release/src/gate.mjs`](../../release/src/gate.mjs),
  [`conformance/src/release.mjs`](../../conformance/src/release.mjs)
- [ADR-0007](0007-evidens-og-prosa-adskilt.md), [ADR-0008](0008-oscal-evidensprofil.md)
