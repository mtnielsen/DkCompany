# DKC-045 — Menneskestyret change og runbookgodkendelse

Overlay til `00-core/` oven på stak-tip **DKC-044**. Implementerer
forhåndsgodkendt selvreparation, så den er lige så præcist autoriseret som en
enkelt ændring: en versioneret og signeret runbook, tre change-flows, en
change-kalender med konflikter/vedligeholdelsesvinduer/låse, og en
server-side resolver i runtimen.

- **Review-base:** `5f9fa73`
- **Checkout:** `83ad91a`
- **Forudsætninger:** DKC-004, DKC-005, DKC-014, DKC-044, DKC-055 (se
  `evidence/prerequisites.txt`)
- **Stak-kæde:** `dkc-044/apply.sh` → `dkc-026/apply.sh` → … → `dkc-001/apply.sh`

## Implementeret adfærd

### 1. Versioneret og signeret runbook

`approvals/src/runbook.mjs` + `contracts/runbook.schema.json`. En runbook bærer
lukket scope (verber/mål/miljøer/kunder), lukket parameterskema og -grænser,
forudsætninger, maksimal påvirkning, udløb, forsøgsgrænse, testet rollback og
postchecks. Signaturen er HMAC-SHA256 over hele det kanoniske indhold undtagen
signaturfeltet. En manglende, ukendt eller tilbagekaldt nøgle afvises, og
`runbookProblems` afviser bl.a. utestet rollback, åbent parameterskema og udløb
i fortiden. Eksempel: `contracts/examples/runbook.example.json`, katalog:
`runbooks/registry.json`, signeringsværktøj: `runbooks/sign.mjs`.

### 2. Tre change-flows

`approvals/src/change-service.mjs`:

- **standard** — en menneskelig pre-approval, der er bundet til den eksakte
  runbook-digest (`approveRunbook`). Kun en `approved`, mergeable
  godkendelsesanmodning kan blive en pre-approval.
- **normal** — ingen gyldig pre-approval ⇒ en konkret godkendelse pr. mutation.
- **emergency** — en særskilt, tidsbegrænset menneskelig autorisation
  (`runbook.emergency`), forbruges pr. mutation.

Change-request-kontrakten er `contracts/change-request.schema.json` med
flow-/autorisationssemantik i `conformance/src/runbook.mjs`.

### 3. Change-kalender, konflikter, vedligeholdelsesvinduer, inaktivering

`approvals/src/change-calendar.mjs`: vedligeholdelsesvinduer,
konfliktregistrering og en atomisk lås pr. mål (hukommelse eller filbaseret
`wx`). En udløbet eller ugyldig runbook/pre-approval falder automatisk tilbage
til godkendelse pr. mutation; en uopfyldt forudsætning eller udløbet godkendelse
stopper runbooken.

### 4. Server-side resolver

`runtime/src/runtime.mjs` kalder en injiceret `runbookResolver`, før
godkendelseskravet afgøres. Resolveren slår den signerede version op,
håndhæver scope/parametre/forudsætninger/udløb/forsøg, sætter **digesten
server-side** (enhver klientmedsendt `runbookDigest` overskrives), tager låsen
for normal/emergency efter godkendelsen og kører postchecks + rollback ved
afslutning. A4-klassifikationen og beskyttelsesguarden kører uafhængigt **før**
resolveren.

## Ændrede filer

31 filer under `00-core/` (alle i `deliverable/`) plus denne `README.md` og
`apply.sh` i pakken:

| Område | Filer |
| --- | --- |
| Kerne | `approvals/src/runbook.mjs`, `approvals/src/change-service.mjs`, `approvals/src/change-calendar.mjs` |
| Runtime | `runtime/src/runtime.mjs`, `runtime/test/runbook-runtime.test.mjs` |
| Kontrakter | `contracts/runbook.schema.json`, `contracts/change-request.schema.json`, `contracts/examples/runbook.example.json`, `contracts/examples/change-request.example.json` |
| Konformans | `conformance/src/runbook.mjs`, `conformance/src/runbook-check.mjs`, `conformance/src/schemas.mjs`, `conformance/src/validate-schemas.mjs`, `conformance/test/runbook-conformance.test.mjs` |
| Runbook-katalog | `runbooks/README.md`, `runbooks/registry.json`, `runbooks/dev-keyring.json`, `runbooks/sign.mjs` |
| Tests | `approvals/test/runbook.test.mjs` |
| Register/Make | `Makefile`, `tools/baseline/registry.mjs` |
| Docs | `docs/adr/0057-…`, `docs/spec/change-and-runbooks.md`, `docs/spec/README.md`, `docs/adr/README.md`, `docs/runbooks/runbook-approval.md`, `docs/testing/test-matrix.md`, `docs/security/threat-model.md`, `release/matrix/test-matrix.json`, `release/matrix/threats.json`, `docs/status/implementation-matrix.md` |

## Testkommandoer og -resultater

Alle kørt i work-clonen (`/tmp/dkc-045/00-core`, commit `83ad91a` + DKC-001…044 +
denne overlay). Logs i `evidence/`.

| Kommando | Resultat |
| --- | --- |
| `make install` | OK |
| `make validate` | PASS (kontraktskemaer + runbook/change-eksempler) |
| `make lint` | PASS (595 JSON-filer, 1541 filer) |
| `make runbook-check` | PASS (1 runbook, 1 change, katalog-digest) |
| `make runbook-test` | PASS (19 approver + 7 runtime + 16 konformans) |
| `make approval-test` | PASS |
| `make runtime-test` | PASS (104 tests) |
| `make boundary-test` | PASS |
| `make release-check` | PASS (49 krav, matrixversion 1.26.0) |
| `make release-test` | PASS |
| `make evidence-mode-check` | PASS |
| `make data-register-check` | PASS (8 poster) |
| `make observability-check` | PASS |
| `make baseline-test` | PASS |
| `make baseline` | **141 PASS, 1 FAIL, 41 NOT RUN af 183** |

Den ene FAIL er den kendte, præeksisterende `changelog-check` (manglende DCO
sign-off, inkl. `83ad91a`) og er hverken forårsaget af eller "rettet" af denne
opgave. Fixtures under `modules/*/conformance` blev snapshotter før `make
baseline` og gendannet bagefter (`diff -rq` ren).

## Acceptkriterier

| # | Kriterium | Status | Bevis |
| --- | --- | --- | --- |
| 1 | Ingen forhåndsgodkendelse betyder menneskelig godkendelse pr. mutation | **PASS** | `runbook.test.mjs` "accept 1/1b", `runbook-conformance.test.mjs` accept 1 |
| 2 | Ny runbookversion eller større scope kræver ny godkendelse | **PASS** | `runbook.test.mjs` "accept 2", pre-approval bundet til digest |
| 3 | Timeout, manglende svar eller no-objection er aldrig approval | **PASS** | `runbook.test.mjs` "accept 3/3b" (pending/udløbet/enkelt godkendelse afvises) |
| 4 | Emergency kan ikke ophæve A4 eller AI-immutable | **PASS** | `runbook-conformance.test.mjs` accept 4 (emergency kræver autorisation), `runbook-runtime.test.mjs` A4-test, `changeRequestProblems` afviser `a4Override` |
| 5 | To samtidige ændringer på samme ressource koordineres og kan ikke omgå låse | **PASS** | `runbook.test.mjs` "accept 5/5b", `runbook-conformance.test.mjs` accept 5, filbaseret lås i `change-calendar.mjs` |

### Coding-deliverables

| # | Leverance | Status |
| --- | --- | --- |
| 1 | Signeret runbook med scope, parametergrænser, forudsætninger, maks. påvirkning, udløb, forsøg, rollback og postchecks | **PASS** |
| 2 | Tre flows: standard (pre-approval), normal (godkendelse pr. mutation), emergency (særskilt autorisation) | **PASS** |
| 3 | Change-kalender, konflikter, vedligeholdelsesvindue og inaktivering ved ugyldig evidens | **PASS** |
| 4 | Runtime-resolver af godkendt runbookversion server-side | **PASS** |

## Ærlige begrænsninger / NOT RUN

- **KMS/HSM-signeringsnøgle.** Signaturen er reel HMAC-SHA256, men nøglen
  leveres i test af `runbooks/dev-keyring.json` (syntetisk, aldrig produktion).
  En rigtig KMS/HSM-nøgle og nøglerotation er en ekstern integration (NOT RUN).
- **Fler-node låsetjeneste.** Den filbaserede lås giver gensidig udelukkelse
  mellem processer på samme host; en distribueret låsetjeneste på tværs af
  noder er en ekstern integration (NOT RUN).
- **Emergency-rollepolitik.** `runbook.emergency`-autorisationen verificeres mod
  den rigtige approval-service, men et levende IdP med
  incident-commander-gruppen er ikke koblet på (NOT RUN).
- **Live GLPI/ITSM og PDP.** Uændret fra DKC-044; runbook-resolveren erstatter
  ikke PDP'en, som fortsat kører som fail-closed kontrol.
- **Produktionsaktivering.** Ingen deployment, signering eller release til
  produktion er udført eller godkendt her.

## Verifikation

`OVERLAY-MANIFEST.txt` indeholder SHA256 for alle pakkefiler (pakke-relative,
ekskl. manifestet selv) og er verificeret med `sha256sum -c`
(`evidence/manifest-verify.log`). Overlayen er anvendt på en frisk klon af
`83ad91a` og giver et byte-identisk træ med work-clonen.
