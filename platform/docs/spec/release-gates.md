# Testmatrix og release-gates (DKC-063)

**Kode:** [`release/`](../../release)
**Kontrakter:** [`test-matrix.schema.json`](../../contracts/test-matrix.schema.json), [`release-gate-result.schema.json`](../../contracts/release-gate-result.schema.json), [`threat-register.schema.json`](../../contracts/threat-register.schema.json), [`risk-exception.schema.json`](../../contracts/risk-exception.schema.json), [`independent-assessment.schema.json`](../../contracts/independent-assessment.schema.json)
**Dokumenter:** [`docs/testing/test-matrix.md`](../testing/test-matrix.md), [`docs/security/threat-model.md`](../security/threat-model.md)
**ADR:** [ADR-0028](../adr/0028-testmatrix-og-releasegates.md)

## Formål

Softwarens korrekthed, sikkerhed og recovery skal være **testbar mod hver
eksakt release og hver produktprofil**. Matrixen kobler hvert krav til navngivne
checks eller til en eksplicit udestående uafhængig vurdering, og release-gaten
afgør om en konkret baselinekørsel kan bære en release. En grøn enhedstest er
ikke produktions-, HA- eller compliance-status.

## Testmatrixen

`release/matrix/test-matrix.json` (`kind: TestMatrix`) indeholder:

| Felt | Betydning |
| --- | --- |
| `matrixVersion` | Separat version for matrixindholdet |
| `supportedEnvironments` | Platforme fra [`catalog/platforms.json`](../../catalog/platforms.json) (DKC-053) |
| `freshnessPolicy` | Standard- og maksfrist for evidens |
| `thresholds` | Ejergodkendte tærskler: alle obligatoriske skal bestå, maks åbne undtagelser, om implementørevidens må bruges til release |
| `stages` | CI-trin med blokerende kommandoer |
| `requirements` | Krav med ejer, testtyper, checks, frist og eventuel uafhængig vurdering |

Testtyperne er `unit`, `contract`, `integration`, `end-to-end`,
`authorization`, `installation`, `migration`, `performance` og `recovery`. Et
obligatorisk krav uden checks **skal** have en uafhængig vurdering.

## Distinkte statusser

| Status | Betydning | Tæller som bestået |
| --- | --- | --- |
| `passed` | Checken er kørt, bestået og frisk | **ja** |
| `failed` | Checken fejlede | nej |
| `skipped` | Checken blev sprunget over | nej |
| `not-run` | Checken er ikke kørt (fx ekstern) | nej |
| `unsupported` | Checken er ikke understøttet i miljøet | nej |
| `stale` | Evidensen er ældre end kravets frist | nej |
| `wrong-artifact` | Evidensen er bundet til et andet commit/artefakt | nej |
| `missing` | Checken eller en testtype findes ikke i matrixen/evidensen | nej |
| `pending-independent-assessment` | Kræver en gyldig uafhængig vurdering | nej |
| `excepted` | Dækket af en gyldig, tidsbegrænset risikoundtagelse | nej |

Gaten fejler lukket: `failed`, `skipped`, `not-run`, `unsupported`, `stale`,
`wrong-artifact`, `missing` og `pending-independent-assessment` blokerer en
release. `excepted` giver `eligible-with-exceptions` og kan kun opstå med en
gyldig undtagelse på et ikke-`nonExcepted` krav.

## Evidensbinding

Hvert check-resultat bærer:

- commit og artefakt-digest (`sha256:` over baselinekørslen),
- konfiguration/profil (`profile`),
- miljø (Node, platform, arkitektur) og producent,
- kommando og evidenssti,
- `startedAt`/`finishedAt` og alder i dage.

En baselinekørsel fra `tools/baseline/` er den kanoniske evidens. Gaten
accepterer ikke et grønt resumé der modsiger en fejlende check.

## Producent-adskillelse

`release/matrix/assessments.json` (`kind: IndependentAssessment`) indeholder
uafhængige vurderinger (penetrationstest, levende måling, ekstern revision)
udført af et navngivet menneske. En vurdering accepteres kun for et krav når:

- producenten ikke er implementøren (`--producer-type independent-verifier`),
  eller tærsklen `allowImplementerEvidenceForRelease` er sand,
- vurderingen ikke er udløbet, og
- dens `targetCommit` matcher release-målet.

Uden dette forbliver kravet `pending-independent-assessment`. Det er med vilje:
en implementør kan ikke udgive sig for en uafhængig verifikator.

## Risikoundtagelser

`release/matrix/exceptions.json` (`kind: RiskExceptions`) indeholder
tidsbegrænsede undtagelser med navngivet ejer, udløbsdato, afgrænsning og
kompenserende kontroller. En undtagelse:

- må ikke dække et krav med `nonExcepted: true`,
- skal udløbe inden for `thresholds.maxExceptionDays`,
- accepteres kun op til `thresholds.maxOpenExceptions`.

En udløbet undtagelse er ikke en undtagelse.

## Trusselmodellen

`release/matrix/threats.json` (`kind: ThreatRegister`) dækker præcis de syv
testede grænser:

1. tenantgrænser, 2. identiteter, 3. agent-handoffs, 4. privilegerede
host-operationer, 5. uforanderligt lager, 6. telemetri, 7. eksterne kilder.

Hver trussel har en ejer, en resterende risiko og en liste af krav der
efterprøver den. `docs/security/threat-model.md` genereres herfra.

## Kommandoer

```bash
make release-check                       # validér matrix, registre, krydsreferencer og dokumenter
make release-write                       # genskab docs/testing/test-matrix.md og docs/security/threat-model.md
make release-test                        # kør gate-fixtures (failed/skipped/not-run/stale/wrong-artifact/missing)
make release-gate                        # evaluér seneste baseline og skriv docs/status/release-gate.md
make release                             # baseline + release-gate
```

`make release-gate` læser `.conformance-out/baseline/latest.json`. Uden friske
uafhængige vurderinger bliver beslutningen `blocked`, og det er det korrekte
resultat — ikke en fejl i gaten.

## Ærlige grænser

- Der findes endnu ingen levende performance-, recovery- eller
  sikkerhedsscanning i repoet. De pågældende krav er markeret med en uafhængig
  vurdering og blokerer release, indtil den foreligger.
- Gaten beviser ikke at en check er sand; den beviser at den er kørt, frisk og
  bundet til det rigtige artefakt. Selve sandheden ligger i checken.
- Independence er et menneskeligt forhold. Gaten håndhæver adskillelsen
  mekanisk, men den uafhængige vurderings kvalitet er en menneskelig opgave.

## Foreslåede severity- og afhjælpningsregler

Disse regler er **foreslåede** og kræver Platform Owners accept (registreret i
matrixens `thresholds.acceptedBy`/`acceptedAt`) før de er bindende.

| Alvor | Release-effekt | Undtagelse | Afhjælpning |
| --- | --- | --- | --- |
| Kritisk | Blokerer ubetinget | Ikke tilladt (`nonExcepted: true`) | Navngivet ejer retter fejlen og genkører checken inden release |
| Høj | Blokerer | Kun med Platform Owner, udløb ≤ 30 dage og kompenserende kontrol | Ejer med deadline; verifikation med den samme check |
| Mellem | Blokerer den berørte produktprofil | Udløb ≤ 90 dage og kompenserende kontrol | Ejer med deadline; gate genkøres |
| Lav | Blokerer ikke | Ikke nødvendig | Dokumenteres og følges op i næste release |

- En afhjælpning er først lukket når den oprindelige check er `passed` igen —
  ikke når en undtagelse er oprettet.
- En undtagelse erstatter aldrig et krav; den udskyder det. Derfor tæller
  `excepted` ikke som `passed`, og beslutningen bliver `eligible-with-exceptions`.
- Manglende beslutning (fx en uafklaret resterende risiko) behandles som
  `unassessed` og blokerer, indtil et navngivet menneske har vurderet den.
