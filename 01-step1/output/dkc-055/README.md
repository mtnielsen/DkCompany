# DKC-055 — Håndhæv præcis én rolle pr. agent (leverance)

Implementering af **DKC-055** for `mtnielsen/DkCompany`. Bygger på DKC-001 ..
DKC-008. `00-core/` er fortsat **ikke ændret**; alt ligger under
`01-step1/output/dkc-055/`.

## Hvad der er implementeret

1. **Én uforanderlig rolle pr. agentidentitet.**
   `agent-registry/src/roles.mjs` definerer de seks roller — observer, planner,
   implementer, verifier, executor, auditor — og hvilke verber, tools og
   artefakter hver rolle må have. `contracts/agent-manifest.schema.json` kræver
   nu `role`, og `runtime/src/boundary.mjs` afviser et manifest med flere roller,
   en ukendt rolle eller en godkender-/administratorrolle for en AI.

2. **Rollebaseret register og menneskekontrolleret oprettelse.**
   `agent-registry/src/registry.mjs` opretter agenter udelukkende på vegne af et
   verificeret menneske med rollen `platform-admin`, `agent-owner` eller
   `security-officer`. Rollen er uforanderlig; en rolleændring kræver
   `retire` + `reprovision` til en **ny** identitet (den gamle bærer
   `previousIdentity`). Et agentnavn kan ikke genbruges som alias. Hver agent
   får separate, per-opgave credentials — der findes ingen fælles token.

3. **Asymmetrisk handoff og uafhængig verifikation.**
   `agent-registry/src/handoff.mjs` tillader kun plan (planner→implementer),
   diff (implementer→verifier), runbook (implementer→verifier/executor) og
   verification (verifier→executor). En overdragelse bærer change-ID,
   inputdigest, den rolle bundne producent, den tilladte modtager og et
   selvstændigt digest. `assertIndependentVerification` afviser samme identitet,
   samme rolle eller **samme model** som producenten.

4. **Menneskelig godkendelse binder plan/diff/runbook.**
   `approvals/src/binding.mjs` binder nu også `change.plan`, `change.runbook`
   og den rollebundne `change.producer`. En ændret plan/diff/runbook eller en
   anden producent ugyldiggør godkendelsen, og executoren kan kun eksekvere den
   godkendte digest/parametre.

5. **Scheduler uden alle credentials.**
   `agent-registry/src/scheduler.mjs` router en opgave til én rolle og udsteder
   kun den valgte agents credential. `allCredentials()` kaster bevidst — en
   scheduler kan ikke samle alle agenters credentials.

6. **Rollegrænse ved runtime og i revieweren.**
   `runtime/src/runtime.mjs` kalder `guardRoleAction` før hver handling:
   planner/observer/auditor kan ikke eksekvere, implementøren kan ikke ændre et
   godkendt scope eller godkende, og executoren kan ikke generere ny plan/kode
   ved fejl. `reviewer/src/reviewer.mjs` kræver `verifier`-rollen og en anden
   model end forfatteren.

7. **Kontrakter, kontrol og docs.**
   `contracts/agent-registration.schema.json` og
   `contracts/agent-handoff.schema.json` formaliserer register- og
   handoff-poster. `make agent-registry-test` og `make agent-registry-check` er
   nye og registreret i `tools/baseline/registry.mjs` (komponent
   `agent-registry`). `conformance/test/role-conformance.test.mjs` spejler de
   syv acceptkriterier i `make test`. ADR-0020 og
   `docs/spec/agent-registry.md` dokumenterer beslutningen.

## Ændrede/nye filer (overlay, relativt til `00-core/`)

```
agent-registry/src/roles.mjs              (ny: rolle-, verbum-, tool- og handoff-politik)
agent-registry/src/registry.mjs           (ny: uforanderligt register + credentials)
agent-registry/src/handoff.mjs            (ny: handoff, uafhængig verifikation, approval-binding)
agent-registry/src/scheduler.mjs          (ny: routing uden alle credentials)
agent-registry/src/runtime-role-guard.mjs (ny: rollegrænse ved runtime)
agent-registry/src/check.mjs              (ny: kontrol af agent-manifester)
agent-registry/src/index.mjs              (ny: samlet indgang)
agent-registry/test/*.test.mjs            (ny: 6 testfiler, 33 tests)
agent-registry/fixtures/manifests.mjs     (ny: syntetiske rollemanifester)
agent-registry/package.json               (ny)
contracts/agent-manifest.schema.json      (+ påkrævet role; afviser godkenderroller)
contracts/agent-registration.schema.json  (ny kontrakt)
contracts/agent-handoff.schema.json       (ny kontrakt)
contracts/approval-request.schema.json    (+ change.plan/runbook/producer)
contracts/examples/agent-manifest.example.json  (+ role: executor)
contracts/examples/agent-registration.example.json (ny)
contracts/examples/agent-handoff.example.json      (ny)
contracts/examples/approval-request.example.json   (binding inkl. plan/runbook/producer)
modules/dummy-ok/agents/backup-agent.json (+ role: executor)
runtime/src/boundary.mjs                  (validateManifest kalder validateRoleManifest)
runtime/src/runtime.mjs                   (+ guardRoleAction, role i policy-input, plan/runbook/producer)
approvals/src/binding.mjs                 (+ plan/runbook/producer i bindingen)
approvals/src/approval-service.mjs        (+ plan/runbook/producer i authorizeExecution)
reviewer/src/reviewer.mjs                 (+ verifier-rolle og modeluafhængighed)
conformance/src/validate-schemas.mjs      (+ nye kontrakter)
conformance/test/role-conformance.test.mjs (ny: 7 accept-tests)
tools/baseline/registry.mjs               (+ agent-registry-test/-check, komponent)
Makefile                                  (+ agent-registry-test/-check, + i ci)
docs/adr/0020-en-rolle-pr-agent.md        (ny ADR)
docs/spec/agent-registry.md               (ny spec)
docs/adr/README.md, docs/spec/README.md   (indeks)
docs/status/implementation-matrix.md      (regenereret)
```

## Testkommandoer og resultater (checkout `83ad91a` + DKC-001..008, Node v22.22.1)

| Kommando | Resultat |
| --- | --- |
| `make agent-registry-test` | **33 pass / 0 fail** (roller, register, handoff, scheduler, runtime-vagt, approval-binding) |
| `make agent-registry-check` | **OK** (2 agent-manifester, 6 roller, ingen AI-godkender) |
| `make runtime-test` | **46 pass / 0 fail** |
| `make approval-test` | **11 pass / 0 fail** + **20 pass / 0 fail** |
| `make agent-conformance-test` | **10 pass / 0 fail** |
| `make reviewer-test` | **3 pass / 0 fail** |
| `make test` (conformance) | **69 pass / 0 fail** (inkl. 7 nye rolle-tests) |
| `make validate` | 25 skemaer, 24 eksempler, 5 arkitektur/identitet, 1 godkendelse, 1 tenant |
| `make boundary-test` | **21 pass / 0 fail** |
| `make policy-test` | **13 pass / 0 fail** |
| `make architecture-test` | **10 pass / 0 fail** |
| `make tenant-test` | 20/0 + 8/0 + 13/0 + 26/0 + 8/0 + 8/0 + 11/0 |
| `make baseline-test` | **8 pass / 0 fail** |
| `make lint` | OK |
| `make baseline` | 58 checks: **48 pass, 1 fail, 0 error, 9 NOT RUN**; `agent-registry-test` og `agent-registry-check` **PASS** |

Evidens: `evidence/logs/*.log` og `evidence/baseline/` (JSON + log). Den ene
baseline-fejl er fortsat `changelog-check` (manglende DCO sign-off, DKC-001-fundet).
Baselinekørslen ændrede de sporede `modules/*/conformance`-fixtures
(ikke-idempotente `*-evidence`-generatorer); de er nulstillet efter kørslen.

## Acceptkriterier

| Kriterium | Status | Bevis |
| --- | --- | --- |
| Manifest med flere roller eller en godkenderrolle for AI afvises | **PASS** | `agent-registry/test/roles.test.mjs` (`roles`-felt, rolleliste, `approver`/`admin`/`human-approver`), `role-conformance.test.mjs`, skemaets `role`-enum |
| Planner kan ikke skrive implementeringsartefakt eller deploye; implementer kan ikke ændre godkendt scope eller godkende | **PASS** | `roles.test.mjs` (`roleMayProduce("planner","implementation")===false`, `roleAllowsVerb("planner","upgrade.patch")===false`), `runtime-role-guard.test.mjs` (scopeChange, approves) |
| Implementer kan køre egne tests, men ikke udstede det uafhængige verifier-resultat | **PASS** | `roles.test.mjs` (`upgrade.dry-run` tilladt, `roleMayProduce("implementer","verification")===false`), `runtime-role-guard.test.mjs` (kun `verifier` må producere `verification`) |
| Executor kører kun godkendt digest/parametre og kan ikke generere ny plan eller kode ved fejl | **PASS** | `approval-plan-binding.test.mjs` (forkert plan/producent → afvist, rigtig → ok), `runtime-role-guard.test.mjs` (`onFailure: "propose"` afvises), `roleAllowsVerb("executor","propose")===false` |
| Selvoprettet agent, shared token, impersonation og delegation kan ikke omgå rollegrænsen | **PASS** | `registry.test.mjs` (kun menneske med platformrolle, rolle uforanderlig, alias-genbrug, retire/reprovision, separate credentials, agent kan ikke administrere), `scheduler.test.mjs` (`allCredentials` kaster) |
| Genbrug af godkendelse efter ændret plan/diff afvises | **PASS** | `handoff.test.mjs` (`verifyChangeApprovalBinding` for plan/diff/runbook), `approval-plan-binding.test.mjs` (executor afvises ved ændret plan), `role-conformance.test.mjs` |
| Samme model i to isolerede identiteter tæller ikke som bevis for uafhængig modelkvalitet | **PASS** | `handoff.test.mjs` (`assertIndependentVerification` → `same_model`), `runtime-role-guard.test.mjs`, `reviewer/src/reviewer.mjs` (samme model som forfatteren afvises) |

## Resterende begrænsninger

- **Registret er in-memory i denne leverance.** I drift skal det ligge i den
  holdbare database fra DKC-008; `AgentRegistration`-kontrakten og
  lifecycle-reglerne er de samme.
- **Ekstern IAM-udstedelse er ikke koblet på.** Registeret udsteder rollebundne
  scopes; en SPIFFE-/OIDC-adapter, der oversætter dem til faktiske credentials,
  er en integration (NOT RUN).
- **Subagent-delegation** håndhæves ved at kun registret udsteder credentials;
  en subagent skal registreres som sin egen identitet med sin egen rolle. Der
  findes ingen dynamisk delegation.
- **En rolleændring kræver ny identitet** — bevidst, men operationelt tungt for
  legitime forfremmelser; det er dækket af retire + reprovision.
- **DKC-001's `changelog-check`-fejl består** (4 commits mangler DCO sign-off).
- Overlay, ikke committed kode: `00-core/` er urørt.

## Til uafhængig gennemgang

- **Reviewets base:** `5f9fa73457d22583b9948611d5cc3afffec4ae38` (5f9fa73).
- **Undersøgt checkout:** `83ad91a`.
- **Forudsætnings-overlays:** DKC-001 .. DKC-008 (lægges via `apply.sh`, som
  kæder `dkc-008/apply.sh`).
- **Denne leverance:** `01-step1/output/dkc-055/` (38 filer i `deliverable/`,
  SHA256 i `OVERLAY-MANIFEST.txt`).
- Uafhængig verifikation, live-integrationer (rigtig IAM/SPIFFE) og menneskelig
  release-godkendelse er separate handlinger og er **ikke** udført her.

## Næste skridt

DKC-055 var den udestående blokering for DKC-005's rolle-separationsscope og
låser nu DKC-010, DKC-045, DKC-046, DKC-058, DKC-060, DKC-062, DKC-064 og
DKC-066 op. Næste fase-1 P0-kandidater efterhånden: **DKC-009** (audit holdbar,
afhænger af DKC-007/008) og **DKC-010** (afhænger af DKC-003/007/055).
