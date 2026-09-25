# DKC-046 — Begrænset selvreparation med sikker fallback

Overlay til `00-core/` oven på stak-tip **DKC-045**. Implementerer en
deterministisk selvreparations-orkestrator, der kun udfører en godkendt runbook
med verificerede parametergrænser, koordinerer ressourcer via lease/cooldown og
et fælles budget, observerer brugerflow ved forværring og stopper sikkert ved
usikkerhed.

- **Review-base:** `5f9fa73`
- **Checkout:** `83ad91a`
- **Forudsætninger:** DKC-010, DKC-011, DKC-013, DKC-017, DKC-038, DKC-045,
  DKC-048, DKC-055 (se `evidence/prerequisites.txt`)
- **Stak-kæde:** `dkc-045/apply.sh` → `dkc-044/apply.sh` → … → `dkc-001/apply.sh`

## Implementeret adfærd

### 1. State machine

`runtime/src/remediation.mjs` driver `detect → correlate → diagnose → propose →
policy/approval → durable intent → execute → verify → recovered | rolled_back |
escalate | halt`. Overgangene er eksplicitte (`allowedRemediationTransition`),
og en ulovlig overgang afvises.

### 2. To initiale runbooks

Kun `stateless-restart@1.0.0` (verbum `restart`) og `bounded-scale@1.0.0`
(verbum `scale`) er aktiveret; begge er signerede, versionsstyrede runbooks i
`runbooks/`. Enhver anden handling kræver **særskilt evidens** og afvises ellers.

### 3. Ressourcelease, cooldown og budget

`createResourceLease` giver en atomisk lease pr. ressource med monotonisk
fencing-token og cooldown (hukommelse eller filbaseret `wx`).
`createRemediationBudget` deler forsøg, fejl og ændringer mellem alle agenter pr.
ressource. En udførende agent verificerer sit token, før den muterer.

### 4. Healthchecks af brugerflow og observationstid

`observeHealth` sampler et brugerflows-healthcheck over et observationsvindue. En
måling under `baseline − tolerance` (eller en falsk boolsk check) gør
observationen degraderet og stopper forløbet; der rulles kun tilbage, hvis
handlingen er reversibel og rollbacken er autoriseret.

### 5. Foruddefinerede fallback-handlinger

`createSafeFallback` kører kun `pause`, `read-only` og `isolation` — handlinger
der reducerer adgang. De er valgt på forhånd af et navnigt menneske og kræver
hverken model eller live PDP.

### 6. Rolleadskillelse

`assertRoleSeparation` kræver, at detector, planner, executor og verifier er
adskilte identiteter; verifikationen må ikke udføres af producenten eller
eksekvereren. Orkestratoren er en deterministisk koordinator, ikke én
flerrolleagent.

### 7. Fail-closed og reversibilitet

Tab af audit/PDP/approval stopper nye agentmutationer; modeludfald stopper
AI-ændringer (`aiChangesStopped`) og kører en sikker fallback.
`describeReversibility` gør `migrate`, `migrate.schema` og `restore` til
irreversible handlinger uden kompensation (`stop-and-escalate`).

## Ændrede filer

30 filer under `00-core/` (alle i `deliverable/`) plus denne `README.md` og
`apply.sh` i pakken:

| Område | Filer |
| --- | --- |
| Kerne | `runtime/src/remediation.mjs`, `runtime/src/runtime.mjs` (eksponerer `manifest`) |
| Runbooks | `runbooks/stateless-restart.runbook.json`, `runbooks/bounded-scale.runbook.json`, `runbooks/registry.json`, `runbooks/README.md` |
| Kontrakter | `contracts/remediation-plan.schema.json`, `contracts/resource-lease.schema.json`, `contracts/health-observation.schema.json` + 3 eksempler |
| Konformans | `conformance/src/remediation.mjs`, `conformance/src/remediation-check.mjs`, `conformance/src/schemas.mjs`, `conformance/src/validate-schemas.mjs`, `conformance/test/remediation-conformance.test.mjs` |
| Test | `runtime/test/remediation.test.mjs` |
| Register/Make | `Makefile`, `tools/baseline/registry.mjs` |
| Docs | `docs/adr/0058-…`, `docs/adr/README.md`, `docs/spec/remediation.md`, `docs/spec/README.md`, `docs/runbooks/self-remediation.md`, `docs/testing/test-matrix.md`, `docs/security/threat-model.md`, `release/matrix/test-matrix.json`, `release/matrix/threats.json`, `docs/status/implementation-matrix.md` |

## Testkommandoer og -resultater

Alle kørt i work-clonen (`/tmp/dkc-046/00-core`, commit `83ad91a` + DKC-001…045 +
denne overlay). Logs i `evidence/`.

| Kommando | Resultat |
| --- | --- |
| `make install` | OK |
| `make validate` | PASS (603 JSON-skemaer inkl. remediation-kontrakter) |
| `make lint` | PASS (603 JSON-filer, 1557 filer) |
| `make remediation-check` | PASS (1 plan, 1 lease, 1 health, 2 signerede runbooks) |
| `make remediation-test` | PASS (18 orkestrator + 13 konformans) |
| `make runbook-check` | PASS (3 katalog-digests) |
| `make runbook-test` | PASS |
| `make approval-test` | PASS |
| `make runtime-test` | PASS |
| `make boundary-test` | PASS |
| `make release-check` | PASS (50 krav, matrixversion 1.27.0) |
| `make release-test` | PASS |
| `make evidence-mode-check` | PASS |
| `make data-register-check` | PASS (8 poster) |
| `make observability-check` | PASS |
| `make baseline-test` | PASS |
| `make baseline` | **143 PASS, 1 FAIL, 41 NOT RUN af 185** |

Den ene FAIL er den kendte, præeksisterende `changelog-check` (manglende DCO
sign-off, inkl. `83ad91a`) og er hverken forårsaget af eller "rettet" af denne
opgave. Fixtures under `modules/*/conformance` blev snapshotter før `make
baseline` og gendannet bagefter (`diff -rq` ren).

## Acceptkriterier

| # | Kriterium | Status | Bevis |
| --- | --- | --- | --- |
| 1 | Agent udfører kun godkendt runbook med verificerede parametergrænser | **PASS** | `remediation.test.mjs` accept 1/1b/1c; runbook-resolver i runtimen; `parameterProblems` |
| 2 | To agenter kan ikke reparere samme ressource samtidigt | **PASS** | `remediation.test.mjs` accept 2/2b/2c; filbaseret lease |
| 3 | Fejlet postcheck udløser kun autoriseret rollback; ellers stop og menneske | **PASS** | `remediation.test.mjs` accept 3/3c; `describeReversibility` |
| 4 | Audit/PDP/approval-tab stopper nye agentmutationer | **PASS** | `remediation.test.mjs` accept 4/4b; fail-closed `record`/PDP |
| 5 | Irreversibel migration eller restore beskrives ikke som generelt reversibel | **PASS** | `remediation.test.mjs` accept 5; `remediation-conformance.test.mjs`; `remediationPlanProblems` |
| 6 | Modeludfald stopper AI-ændringer, mens uafhængige godkendte infrastrukturfunktioner fortsætter | **PASS** | `remediation.test.mjs` accept 6 (modeludfald → `halted` + `safeFallback`) |

### Coding-deliverables

| # | Leverance | Status |
| --- | --- | --- |
| 1 | State machine: detect, correlate, diagnose, propose, policy/approval, durable intent, execute, verify, rollback/fallback, escalate | **PASS** |
| 2 | Start med én stateless-restart og én bounded scale-runbook; øvrige handlinger kræver særskilte beviser | **PASS** |
| 3 | Ressourcelease, cooldown, max forsøg og samlet fejl-/ændringsbudget på tværs af agenter | **PASS** |
| 4 | Healthchecks af brugerflow, observationstid og automatisk stop ved forværring | **PASS** |
| 5 | Foruddefineret pause, read-only eller isolation hvor det er autoriseret | **PASS** |
| 6 | Fordel detect, plan, implementering, uafhængig verifikation, menneskelig approval og eksekvering mellem adskilte roller | **PASS** |

## Ærlige begrænsninger / NOT RUN

- **Distribueret låsetjeneste.** Den filbaserede lease giver gensidig udelukkelse
  mellem processer på samme host; på tværs af noder kræves en delt låsetjeneste
  (ekstern integration, NOT RUN).
- **Rigtig model og health-probe.** Tests bruger injicerede diagnose-/propose-
  funktioner og health-stubs; en rigtig model-gateway og en rigtig
  brugerflow-probe er separate integrationer (NOT RUN).
- **Aktivering i drift.** Ingen deployment eller produktionsevaluering er
  udført her. Orkestratoren er deterministisk og udfører ikke selv en shell.
- **Produktionsgodkendelse.** En menneskelig release-godkendelse og en
  uafhængig verifikation er fortsat separate handlinger.

## Verifikation

`OVERLAY-MANIFEST.txt` indeholder SHA256 for alle pakkefiler (pakke-relative,
ekskl. manifestet selv) og er verificeret med `sha256sum -c`
(`evidence/manifest-verify.log`). Overlayen er anvendt på en frisk klon af
`83ad91a` og giver et byte-identisk træ med work-clonen.

### Infrastruktur-reparation af stak-kæden

Under arbejdet blev DKC-001-pakken flyttet fra `01-step1/output/` (rod) til
`01-step1/output/dkc-001/`. Den daværende kæde i `dkc-002/apply.sh` pegede på
den nu forsvundne `$ROOT/apply.sh`. Kæden er repareret backward-compatible:
`dkc-002/apply.sh` bruger `$ROOT/apply.sh`, hvis den findes, og ellers
`$ROOT/dkc-001/apply.sh`. Det er en ren sti-reparation uden for `00-core/`;
DKC-002's manifest omfatter ikke `apply.sh`.
