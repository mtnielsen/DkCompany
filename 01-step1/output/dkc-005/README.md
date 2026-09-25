# DKC-005 — Luk runtime-bypass af godkendelser (leverance)

Implementering af **DKC-005** for `mtnielsen/DkCompany`. Bygger på DKC-001,
DKC-002, DKC-003 og DKC-004. `00-core/` er fortsat **ikke ændret**; alt ligger
under `01-step1/output/dkc-005/`.

## Hvad der er implementeret

1. **Ingen tillid til `action.approvals`.** Feltet er **fjernet** fra
   `agent-task`-kontrakten. En A3-handling (eller `allow-with-approval`) skal i
   stedet bære `approvalId`, `executionId`, `changeDigest`, `parameters` og
   `policyBundleVersion`; opgaven bærer `tenantId`. Runtimen ignorerer enhver
   `approvals`-påstand og kræver et approval-ID.
2. **Serververificeret beslutning, revalideret lige før handling.**
   `approvalVerifier.authorizeExecution(...)` kaldes **efter** evidens-, budget-
   og executor-kontrollerne og **umiddelbart før** eksekveringen. Servicen
   genberegner den kanoniske binding (kunde, miljø, verbum, mål, diff-digest,
   parametre, policy-version, udløb) og sammenligner med den godkendte
   beslutning. Mangler `approvalId`, eller er tjenesten ikke konfigureret eller
   utilgængelig, stoppes handlingen (fail-closed).
3. **Atomisk forbrug og replay-beskyttelse.** `approvals/src/store.mjs` får en
   atomisk `claim`: en claim-post oprettes med `wx`-flag (eller et in-memory-
   claim), så to samtidige workers ikke kan forbruge samme godkendelse.
   `authorizeExecution` skriver `decision.consumed` og et `approval.consumed`-
   auditevent. Et mislykket bindings-tjek forbruger intet.
4. **Client.** `runtime/src/clients.mjs` får `createApprovalClient` (in-process
   service eller HTTP-endpoint) og `ApprovalUnavailable`. Runtimens CLI får
   `--approval <url>`.
5. **Kontrakt og migration.** `contracts/agent-task.schema.json` + eksempel er
   opdateret; `contracts/approval-request.schema.json` får `decision.consumed`,
   og den semantiske validator tjekker forbrugs-konsistens. ADR-0016 og
   opdateret runtime-/approval-spec dokumenterer beslutningen.

## Ændrede/nye filer (overlay, relativt til `00-core/`)

```
runtime/src/runtime.mjs                    (verificér+forbrug i stedet for action.approvals)
runtime/src/clients.mjs                    (+ createApprovalClient, ApprovalUnavailable)
runtime/src/cli.mjs                        (+ --approval)
runtime/test/runtime.test.mjs              (A3-test omlagt; bypass-regression)
runtime/test/approval-runtime.test.mjs     (ny: 11 DKC-005-accepttests mod rigtig service)
contracts/agent-task.schema.json           (− approvals; + tenantId/approvalId/executionId/…)
contracts/examples/agent-task.example.json (opdateret til approvalId + binding)
contracts/approval-request.schema.json     (+ decision.consumed)
conformance/src/approval.mjs               (+ forbrugs-konsistens)
approvals/src/approval-service.mjs         (+ authorizeExecution, atomisk forbrug)
approvals/src/store.mjs                    (+ atomisk claim)
docs/spec/agent-runtime.md                 (DKC-005-afsnit)
docs/spec/approval-service.md              (autorisation/forbrug)
docs/spec/README.md                        (indeks)
docs/adr/0016-runtime-verificerer-godkendelser.md (ny ADR)
docs/adr/README.md                         (indeks)
tools/baseline/registry.mjs                (runtime-test-evidens + agent-runtime-doc)
docs/status/implementation-matrix.md       (regenereret)
```

## Testkommandoer og resultater (checkout `83ad91a` + DKC-001..004, Node v22.22.1)

| Kommando | Resultat |
| --- | --- |
| `make runtime-test` | **21 pass / 0 fail** (heraf 11 nye DKC-005-tests) |
| `make approval-test` | **6 pass / 0 fail** (persistence/audit) + **19 pass / 0 fail** (konformans) |
| `make approval-check` | 1 eksempel valideret (skema + binding + state machine) |
| `make validate` | 22 skemaer, 21 eksempler, 5 arkitektur/identitet, 1 godkendelse |
| `make test` | **49 pass / 0 fail** |
| `make agent-conformance-test` | 10 pass / 0 fail |
| `make curriculum-test` | 5 pass / 0 fail |
| `make baseline-test` | 8 pass / 0 fail |
| `make baseline` | 51 checks: **41 pass, 1 fail, 0 error, 9 NOT RUN**; `runtime-test` PASS |

Evidens: `evidence/logs/*.log` og `evidence/baseline/` (JSON + logs). Den ene
baseline-fejl er fortsat `changelog-check` (manglende DCO sign-off, DKC-001-fundet).
Baselinekørslen ændrede 30 sporede fixture-filer (ikke-idempotente
`*-evidence`-generatorer); de er nulstillet efter kørslen.

## Acceptkriterier

| Kriterium | Status | Bevis |
| --- | --- | --- |
| To indsendte objekter med `verdict=approve` udfører nul handlinger | **PASS** | `runtime/test/runtime.test.mjs` (DKC-005 regression) — `record === []`, status `escalated` |
| Utilgængelig approval-service stopper A3 | **PASS** | `runtime/test/approval-runtime.test.mjs` — `halted`, `/approval-service utilgængelig/`, nul executor-kald |
| Godkendelse til anden handling, anden kunde eller tidligere diff afvises | **PASS** | `approval-runtime.test.mjs` — tre tests, alle `escalated` med binding-begrundelse og nul handlinger |
| To samtidige workers kan ikke udføre samme godkendte ændring to gange | **PASS** | `approval-runtime.test.mjs` — `Promise.all` giver præcis én `completed` og ét executor-kald; `approvals/src/store.mjs` claim-test |
| Gyldig godkendelse virker gennem den rigtige service | **PASS** | `approval-runtime.test.mjs` — rigtig `createApprovalService`, to godkendere, `completed`, `decision.consumed` sat |

## Prerequisite-blokering: DKC-055

DKC-005 opgiver `depends_on: [DKC-004, DKC-055]`. **DKC-055 er ikke
implementeret**, og den afhænger selv af DKC-007 (heller ikke implementeret).
Derfor er følgende dele af den samlede målbeskrivelse **ikke** dækket her:

- én uforanderlig rolle pr. agentidentitet (observer/planner/implementer/
  verifier/executor/auditor) og isoleret runtime;
- separate credentials/tools/kontrakter pr. rolle og handoff med rollebundet
  producent/modtager;
- afvisning af flerrolle-manifester, shared token, impersonation/delegation og
  genbrug af godkendelse efter ændret plan/diff (sidstnævnte er dog dækket for
  runtime-godkendelser her);
- menneskekontrolleret agentoprettelse og retire/reprovision ved rolleændring.

DKC-005's egne fem acceptkriterier er alle implementeret og testet; de kræver
ikke DKC-055's rolleadskillelse. Blokeringen bør lukkes ved at køre DKC-007 og
DKC-055, hvorefter runtime-testene kan udvides med rolle-/handoff-kontroller.

## Resterende begrænsninger

- **Ingen rigtig IdP/SPIRE eller deployed approval-service i drift.** Den
  in-process service og HTTP-klienten er testet med syntetiske data; en levende
  idriftsættelse er en integration (NOT RUN).
- **Kontraktbrud:** `agent-task` fjerner `approvals`. Eksisterende opgaver skal
  omlægges til `approvalId` + binding; en versionsmigration/kompatibilitetslag
  er ikke leveret.
- **Delt/HA-forbrug:** claim-mekanismen er atomisk pr. lager. På et delt
  filsystem eller en database skal claimet tilsvarende være transaktionelt.
- **`verifyJwt` HS256-stien er defekt** (DKC-003-fund); testene bruger RS256.
- **DKC-001's `changelog-check`-fejl består** (DCO sign-off).
- Overlay, ikke committed kode: `00-core/` er urørt.

## Til uafhængig gennemgang

- **Reviewets base-commit:** `5f9fa73457d22583b9948611d5cc3afffec4ae38`.
- **Undersøgt checkout:** `83ad91a963d8055f77c29fb4361455689df95acb`.
- **Forudsætninger:** `01-step1/output/` (DKC-001), `01-step1/output/dkc-002/`,
  `01-step1/output/dkc-003/` og `01-step1/output/dkc-004/`. `apply.sh` kæder dem.
- **Ændringen:** `01-step1/output/dkc-005/deliverable/` (18 filer) plus evidens i
  `01-step1/output/dkc-005/evidence/`. SHA256 i `OVERLAY-MANIFEST.txt`.
