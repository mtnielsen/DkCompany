# DKC-032 — AI i skyggetilstand og begrænset autonomi

Kumulativ overlay oven på stak-tippet DKC-051. Lægges med
`./apply.sh <checkout>/00-core`.

- **Reviewets base:** `5f9fa73457d22583b9948611d5cc3afffec4ae38` (`5f9fa73`)
- **Undersøgt checkout:** `83ad91a963d8055f77c29fb4361455689df95acb` (`83ad91a`)
- **Forudsætningskæde:** `dkc-051/apply.sh` → `dkc-050/apply.sh` →
  `dkc-027/apply.sh` → `dkc-058/apply.sh` → … → `dkc-001/apply.sh`. DKC-032
  afhænger formelt af **DKC-005** (runtime verificerer godkendelser), **DKC-010**
  (JIT-credentials og nødstop), **DKC-011** (værktøjsgrænse og injection),
  **DKC-012** (modelgateway og bindende budgetter), **DKC-013** (genoptagelig og
  idempotent eksekvering), **DKC-017** (reel overvågning), **DKC-024**
  (Keycloak/Mattermost), **DKC-046** (begrænset selvreparation) og **DKC-049**
  (komplet logging). Den genbruger desuden **DKC-045** (runbooks/change-flow).
  Alle er verificeret i den anvendte stak (se `evidence/prerequisites.txt`).
- **Miljø:** Node v22.22.1. Ingen levende model, ingen isoleret stagingklynge,
  ingen menneskelige godkendere. Replayet er en **deterministisk model**
  (`measured: false`); en målt kørsel er NOT RUN og beskrevet i
  `docs/ai-operations/shadow-live.md`.

## Implementeret adfærd

1. **Autonomistige og versionsstyret ejerbeslutning** (`shadow/autonomy-policy.json`,
   `contracts/autonomy-grant.schema.json`): `observe → propose → shadow →
   limited-autonomy`. Bevillingen er bundet til et model-/
   promptfingeraftryk (`digest(modelRef, promptDigest)`), et sæt
   forhåndsgodkendte runbooks, tærskler og mindst `minEvaluationRuns` beståede
   evalueringer. Semantikken i `shadow/src/policy.mjs` kræver et navngivet
   menneske, staging-only og reversibilitet for begrænset autonomi, ingen
   irreversible verber i scopet og en versionshistorik.
2. **Skygge- og autonomimotor** (`shadow/src/shadow.mjs`): replay af historiske
   hændelser (læsning, diagnosticering, forslag), logning af den menneskelige
   beslutning og måling af **falske alarmer, fejl, eskalationer, omkostning og
   reviewerens ekstra fund**. En `shadow`-kørsel sætter aldrig `executed: true`
   og holder `mutationCount = 0`. I `limited-autonomy` udføres kun
   forhåndsgodkendte, reversible runbooks i staging.
3. **Kobling til den rigtige kode** (`shadow/src/runner.mjs`): runbook-scope og
   -parametre valideres med `approvals/src/runbook.mjs` (DKC-045), den rigtige
   nødstopsklient bruges (`credentials/src/kill-switch.mjs`, DKC-010), og
   reversibilitet/reviewer genbruger `runtime/src/remediation.mjs` og
   `runtime/src/classification.mjs`. Governance er en eksplicit probe;
   et aktivt nødstop eller et governance-nedbrud stopper kørslen før den første
   muterende handling.
4. **Gentaget evaluering** (`createAutonomyRegister`): et nyt fingeraftryk
   afviser `assertAllowed`, indtil `evaluate()` har set mindst
   `minEvaluationRuns` beståede kørsler på samme fingeraftryk. `expand()` er en
   versionsstyret ejerbeslutning: den kræver et navngivet menneske, en
   change-reference og gentaget evidens, og returnerer en ny version.
5. **Konformans og gate** (`shadow/src/check.mjs`, `conformance/src/shadow.mjs`):
   skema + beslutningssemantik for bevilling og kørsel, en deterministisk
   genkørsel af rapporten og en negativ kontrol, der afviser en mutation i en
   skyggekørsel.
6. **Releasebinding**: nyt krav `REQ-SHADOW-001` og trussel
   `THREAT-SHADOW-001` i release-matricen (matrixversion **1.33.0**), registreret
   i `tools/baseline/registry.mjs` som komponenten `shadow-autonomy` med
   checkene `shadow-check`, `shadow-test`, `shadow-run`, `shadow-report` og
   `integration-ai-shadow` (sidstnævnte NOT RUN).

## Ændrede og nye filer

Se `deliverable/`. Filerne er beregnet ved at diffe arbejdsklonen mod en frisk
klon med kun `dkc-051/apply.sh` anvendt (34 filer, ekskl.
`node_modules`, `.conformance-out`, `.git`, `evidence/generated`). De vigtigste:

- Nye: `shadow/` (motor, policy, datasæt, rapport, tests), `conformance/src/shadow.mjs`,
  `conformance/test/shadow-conformance.test.mjs`, `contracts/autonomy-grant.schema.json`,
  `contracts/shadow-run.schema.json` + eksempler, `docs/spec/shadow-autonomy.md`,
  `docs/runbooks/shadow-autonomy.md`, `docs/ai-operations/`, ADR-0064.
- Ændrede: `Makefile` (5 targets + `ci`), `conformance/src/schemas.mjs`,
  `conformance/src/validate-schemas.mjs`, `tools/baseline/registry.mjs`,
  `release/matrix/{test-matrix,threats}.json`, genererede
  `docs/status/implementation-matrix.md`, `docs/status/supply-chain.md`,
  `docs/testing/test-matrix.md`, `docs/security/threat-model.md`,
  `release/sbom/platform-sbom.cdx.json`, `release/artifacts.json`.

## Testkommandoer og resultater

| Kommando | Resultat |
| --- | --- |
| `make validate` | PASS (670 JSON-filer; 2 nye kontrakter valideret) |
| `make lint` | PASS (1729 filer) |
| `make shadow-check` | PASS (bevilling, datasæt og rapport konsistente) |
| `make shadow-test` | PASS (9 enhedstests + 6 konformanstests) |
| `make shadow-run` | PASS (48 replay-hændelser; skyggemutationer 0; 23 godkendte staging-handlinger) |
| `make release-check` | PASS (56 krav; matrixversion 1.33.0) |
| `make release-test` | PASS (5) |
| `make supply-chain-check` | PASS (SBOM regenereret efter `shadow/package.json`) |
| `make test` | PASS (388 konformanstests) |
| `make conform-all` | PASS |
| `make baseline-test` | PASS (8) |
| `make baseline` | 214 checks: **166 PASS, 1 FAIL, 47 NOT RUN**. Det ene FAIL er det kendte, forudgående `changelog-check` (manglende DCO sign-off, også i `83ad91a`); det er ikke "rettet". |
| `make dr-check`, `dedup-check`, `remediation-check`, `ha-check`, `db-ha-check`, `storage-check`, `observability-check`, `data-register-check`, `gitops-verify`, `infrastructure-verify`, `monitoring-check`, `distribution-check`, `portal-check`, `configuration-check`, `continuity-check` | PASS |

Replayet er deterministisk og kan gentages byte-identisk med `make shadow-run` /
`make shadow-check`.

## Acceptkriterier

| Kriterium | Status | Bevis |
| --- | --- | --- |
| Skyggetilstand udfører nul muterende handlinger | **PASS** | `shadow/src/shadow.mjs`; test 1; `shadow.report.shadow.mutationCount = 0`; `shadowRunProblems` afviser en mutation (negativ kontrol) |
| Replay af historiske hændelser giver målbare resultater | **PASS** | `shadow/replay-dataset.json` (48 anonymiserede hændelser); `shadow/report/shadow-report.json` metrics; test 2 |
| Model- eller promptskifte kræver gentaget evaluering | **PASS** | `createAutonomyRegister.assertAllowed`/`evaluate`; test 3; `autonomyPolicyProblems` |
| Nødstop og governance-nedbrud stopper handlinger | **PASS** | `killSwitch.assertAllowed` + governance-probe før mutation; test 4a/4b |
| Udvidelse af autonomi er en versionsstyret ejerbeslutning med evidens | **PASS** | `expand()` + `AutonomyGrant`-historik; test 5; ADR-0064 |

## Tilknyttede krav/checks og hvad der er NOT RUN

- `REQ-SHADOW-001` binder `shadow-check`, `shadow-test`, `shadow-run` og
  `integration-ai-shadow`; `THREAT-SHADOW-001` (agent-handoff/privilege
  escalation) er tilføjet.
- **NOT RUN:** `integration-ai-shadow` (`make shadow-live`) — kræver en levende
  model, en isoleret stagingklynge og menneskelige godkendere. Selve
  staging-effekten er simuleret (`simulated: true`); beslutningen og
  autorisationen er den rigtige kode. Se `docs/ai-operations/shadow-live.md`.

## Resterende begrænsninger

- Den målte effekt af en levende model (falske alarmer, omkostning, faktisk
  handling) er ikke observeret; kun den deterministiske model og den rigtige
  autorisationskæde er efterprøvet.
- Datasættet er syntetisk/anonymiseret og skal vedligeholdes, når signaler eller
  runbooks ændres.
- Bevillingshistorikken er filbaseret og versionsstyret i git; en ekstern
  WORM-arkivering af den målte kørsel mangler.

## Godkendelse

Implementeringen er ikke produktionsklar, og agenten godkender ikke sin egen
indsats. Uafhængig verifikation og menneskelig release-godkendelse er separate
skridt.
