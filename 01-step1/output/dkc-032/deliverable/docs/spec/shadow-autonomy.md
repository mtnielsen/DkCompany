# AI i skyggetilstand og begrænset autonomi (DKC-032)

Formålet er at måle AI-beslutninger, **før** den får ret til at ændre kundernes
systemer. Modulet `shadow/` driver en eksplicit autonomistige og en
deterministisk replay af historiske hændelser. Det er ikke en ny agent: det er
en orkestrator, der genbruger runtime-, runbook- og nødstopkoden.

## Autonomistigen

| Niveau | Læs | Diagnosticér | Foreslå | Udfør |
| --- | --- | --- | --- | --- |
| `observe` | ja | ja | nej | nej |
| `propose` | ja | ja | ja (logges) | nej |
| `shadow` | ja | ja | ja (logges) | nej — `mutationCount = 0` |
| `limited-autonomy` | ja | ja | ja | kun forhåndsgodkendte, reversible runbooks i staging |

Stigen er ensrettet. `assertAllowed` afviser alt, der overstiger bevillingens
niveau, og begrænset autonomi afvises uden for staging.

## Kontrakter

- `contracts/autonomy-grant.schema.json` (`AutonomyGrant`) — den versionsstyrede
  ejerbeslutning: et navngivet menneske, et model-/promptfingeraftryk, et sæt
  forhåndsgodkendte runbooks, tærskler, mindst `minEvaluationRuns` beståede
  evalueringer, en change-reference og en historik.
- `contracts/shadow-run.schema.json` (`ShadowRun`) — resultatet af en replay:
  hver hændelses læsning, diagnose, forslag, menneskelige beslutning,
  reviewerfund og udførelse, plus metrics og sikkerhedsinvarianter.

Skemaet håndhæver formen; semantikken ligger i `shadow/src/policy.mjs`
(`autonomyPolicyProblems`, `replayDatasetProblems`, `shadowRunProblems`) og er
fælles med konformansvalidatoren i `conformance/src/shadow.mjs`.

## Nøgleinvarianter

- **Nul mutation i skygge.** `shadowRunProblems` afviser en `shadow`-kørsel med
  `mutationCount > 0` eller en udført beslutning. Motoren sætter aldrig
  `executed: true` på `shadow`-niveau.
- **Kun godkendte runbooks.** I begrænset autonomi kontrolleres
  `register.assertAllowed` for runbook, verbum, miljø og fingeraftryk, før
  `createStagingExecutor` verificerer scope og parametre mod den kanoniske
  runbook (`approvals/src/runbook.mjs`).
- **Reversibilitet.** Irreversible verber (`migrate`, `restore`, …) afvises altid
  og eskalerer til et menneske. Klassifikationen kommer fra
  `runtime/src/classification.mjs`.
- **Nødstop og governance.** Et aktivt nødstop eller et governance-nedbrud
  stopper kørslen før den første muterende handling, og `mutationCount` forbliver 0.
- **Gentaget evaluering.** Et nyt model-/promptfingeraftryk afviser
  `assertAllowed`, indtil mindst `minEvaluationRuns` beståede evalueringer på det
  nye fingeraftryk foreligger.
- **Versionsstyret udvidelse.** `createAutonomyRegister().expand(...)` kræver et
  navngivet menneske, en change-reference og gentaget evidens; den returnerer en
  ny version med en udvidet historik.

## Målte effekter

Replayet opgør falske alarmer, fejl (forkert handling), eskalationer, omkostning
og reviewerens ekstra fund. Tallene sammenlignes med bevillingens tærskler i
`evaluateThresholds`, og gaten blokerer, hvis en tærskel overskrides.

## Genbrug

- Runbooks: `approvals/src/runbook.mjs` (`scopeCovers`, `parameterProblems`).
- Nødstop: `credentials/src/kill-switch.mjs`.
- Reversibilitet og fallback: `runtime/src/remediation.mjs`, `runtime/src/classification.mjs`.
- Reviewer: `reviewer/src/reviewer.mjs` (adversariel, anden leverandør, kan kun
  flagge eller afvise).
- Observability: rapporterne lægger sig under `docs/ai-operations/`.

## Hvad er ikke dækket her

Replayet er en deterministisk model (`measured: false`). Der er ingen levende
model, ingen isoleret stagingklynge og ingen menneskelige godkendere i dette
miljø, så den målte kørsel er `make shadow-live` og er NOT RUN. Selve
staging-effekten er simuleret og bærer det eksplicit; beslutningen og
autorisationen er derimod den rigtige kode.

## Kommandoer

```sh
make shadow-run     # replay i skyggetilstand og simuleret staging
make shadow-check   # validerer bevilling, datasæt og renderede artefakter
make shadow-test    # enheds- og konformanstests
make shadow-report  # skriv den kørte rapport til stdout
make shadow-live    # målt kørsel mod levende model/staging (NOT RUN)
```
