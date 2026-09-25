# DKC-004 — Autentiske, ændringsbundne godkendelser (leverance)

Implementering af **DKC-004** for `mtnielsen/DkCompany`. Bygger på DKC-001,
DKC-002 og DKC-003. `00-core/` er fortsat **ikke ændret**; alt ligger under
`01-step1/output/dkc-004/`.

## Hvad der er implementeret

1. **Serverstyret pending-state og træningsopslag.** `create()` afviser enhver
   payload, der påstår en anden tilstand end `pending`, eller som medsender
   godkendelser. Serveren sætter `pending`, rydder `approvals` og udleder
   politik (grupper, træningsmoduler, antal godkendere, udløb og
   tilbagekaldelsesroller) fra ændringen via `approvals/src/approval-policy.mjs`.
   `decide()` læser udelukkende træning fra `trainingRegistry(subject)` og
   grupper fra den verificerede identitet — klientens `groups` og
   `completedTrainingModules` ignoreres.
2. **Binding til ændringen.** `approvals/src/binding.mjs` har en kanonisk
   SHA-256 over kunde (`tenantId`), miljø, verbum, mål, diff-digest,
   parameter-digest, policy-version og udløb. Digesten gemmes i
   `decision.binding` og på hver `approval.bindingDigest`. `amend()` genberegner
   bindingen og rydder godkendelser ved enhver ændring af et bundet felt.
   `decide()` afviser en forkert `changeDigest` og enhver binding-drift.
3. **Unikke godkendere, selv-godkendelse og tilbagekaldelse.** Samme `subject`
   kan ikke godkende to gange. `decision.requestedBy` (verificeret skaber) kan
   ikke godkende egen ændring. Kun politikudpegede roller må `revoke()`.
   State machine: `pending → approved | rejected | expired | withdrawn |
   revoked`, `approved → expired | revoked`; terminale tilstande kan ikke
   genbruges. `merge-check` lister begrundelserne og er kun `mergeable` ved
   intakt binding og nok unikke godkendere.
4. **Persistence og beskyttet audit.** `approvals/src/store.mjs` lægger
   tilstanden i et filbaseret lager med **atomisk** skrivning (temp + rename), så
   en afvist/tilbagekaldt beslutning ikke forsvinder ved genstart, og et ændret
   binding på disken opdages. `approvals/src/ledger.mjs` skriver en append-only,
   hash-kædet (HMAC-valgfri) audit-log over hver beslutning; en brudt kæde
   afvises ved start (`AUDIT_CHAIN_BROKEN`, fail-closed). `approvals/src/cli.mjs`
   starter tjenesten med begge dele (`make approval-run`).
5. **Kontraktudvidelse.** `contracts/approval-request.schema.json` får
   `tenantId`, `change.parameters`, `decision.binding`, `decision.requestedBy`,
   `decision.revoked*`/`invalidated*`/`expiredAt`/`withdrawn*` og
   `approvals[].bindingDigest`/`actorKind`; `revoked` føjes til state-enum.
   Eksemplet er opdateret med en korrekt, server-beregnet digest.
6. **Konformans og CI.** `conformance/src/approval.mjs` validerer skema + binding
   + state-konsistens; `make approval-check` kører den. `make approval-test`
   kører 6 persistence-/audit-tests + 19 konformanstests. Begge er lagt i `ci` og
   i baseline-registeret.
7. **Identitetsintegration.** Beslutninger over HTTP kræver en konfigureret
   `authenticator` (DKC-003); uden den svarer servicen `503`. Test 7 opretter og
   godkender med rigtige RS256-signerede OIDC-tokens gennem
   `createPlatformAuthenticator`.

## Ændrede/nye filer (overlay, relativt til `00-core/`)

```
approvals/src/approval-service.mjs          (serverstyret state machine + binding + lager/audit)
approvals/src/binding.mjs                   (kanonisk binding-digest)
approvals/src/approval-policy.mjs           (serverstyret politik)
approvals/src/store.mjs                     (filbaseret, atomisk lager)
approvals/src/ledger.mjs                    (append-only, hash-kædet audit-log)
approvals/src/cli.mjs                       (drift: lager + audit + authenticator)
approvals/test/persistence.test.mjs         (6 tests: genstart, tamper, sti-sikkerhed)
contracts/approval-request.schema.json      (+ tenantId, parameters, binding, state machine)
contracts/examples/approval-request.example.json (opdateret med tenant, parametre, binding)
conformance/src/approval.mjs                (semantisk validator)
conformance/src/approval-check.mjs          (check-CLI)
conformance/src/validate-schemas.mjs        (+ godkendelsesvalidering)
conformance/test/approval-conformance.test.mjs (19 accepttests)
conformance/test/agent-conformance.test.mjs (omlagt til verificerede principaler)
curriculum/test/curriculum.test.mjs         (omlagt til verificeret principal)
Makefile                                    (+ approval-check, approval-test, approval-run, i ci)
tools/baseline/registry.mjs                 (+ 2 checks, opdateret komponent)
docs/spec/approval-service.md               (udvidet med DKC-004 + persistence/audit)
docs/spec/README.md                         (indeks)
docs/adr/0015-autentiske-godkendelser.md    (ny ADR)
docs/adr/README.md                          (indeks)
docs/status/implementation-matrix.md        (regenereret)
```

## Testkommandoer og resultater (checkout `83ad91a` + DKC-001/002/003, Node v22.22.1)

| Kommando | Resultat |
| --- | --- |
| `make approval-test` | **6 pass / 0 fail** (persistence/audit) + **19 pass / 0 fail** (konformans) |
| `make approval-check` | **1** godkendelseseksempel valideret (skema + binding + state machine) |
| `make validate` | 22 skemaer, 21 eksempler, 5 arkitektur/identitet, **1 godkendelse** — exit 0 |
| `make test` | **49 pass / 0 fail** |
| `make agent-conformance-test` | **10 pass / 0 fail** |
| `make curriculum-test` | **5 pass / 0 fail** |
| `make identity-test` | **32 pass / 0 fail** |
| `make runtime-test` | 10 pass / 0 fail |
| `make evidence-test` | 5 pass / 0 fail |
| `make architecture-test` | 10 pass / 0 fail |
| `make baseline-test` | 8 pass / 0 fail |
| `make approval-run` (smoke) | starter med fillager + audit-log; `GET /v1/approvals` svarer |
| `make baseline` | 51 checks: **41 pass, 1 fail, 0 error, 9 NOT RUN**; `approval-test` og `approval-check` PASS |

Evidens: `evidence/logs/*.log` og `evidence/baseline/` (JSON + logs). Den ene
baseline-fejl er fortsat `changelog-check` (manglende DCO sign-off, DKC-001-fundet).
Baselinekørslen ændrede 30 sporede fixture-filer (ikke-idempotente
`*-evidence`-generatorer, også et DKC-001-fund); de er nulstillet efter kørslen,
og matrixafsnittet om reproducerbarhed dokumenterer det.

## Acceptkriterier

| Kriterium | Status | Bevis |
| --- | --- | --- |
| Oprettelse med approved-state afvises | **PASS** | `approval-conformance.test.mjs` tests 1, 1b, 1c; `create()` kaster `400` |
| Samme person kan ikke tælle som to godkendere | **PASS** | test 2 — anden godkendelse fra samme `subject` giver `409`, og `merge-check` forbliver `false` |
| Forfalskede grupper og kursusbeviser afvises | **PASS** | tests 3, 3b, 3c, 7; `conformance/test/agent-conformance.test.mjs` 2b/2c |
| Ændret diff, tenant, mål eller parametre ugyldiggør godkendelsen | **PASS** | tests 4, 4b, 4c, 4d, 4e, 4f og `persistence.test.mjs` (ændret binding på disken) |
| Afvist, udløbet eller tilbagekaldt beslutning kan ikke anvendes | **PASS** | tests 5a, 5b, 5c, 5d, 6 og `persistence.test.mjs` (afvist overlever genstart) |
| Selv-godkendelse forbydes efter rollepolitik | **PASS** | test 6 — `requestedBy` kan ikke godkende egen ændring (`403`) |
| Godkendelsestilstand er persistent og audit er tamper-evident | **PASS** | `approvals/test/persistence.test.mjs` — genstart, brudt kæde afvises, HMAC uden nøgle afvises, sti-sikkerhed |

## Resterende begrænsninger

- **Ingen rigtig IdP/SPIRE i drift.** OIDC- og workload-identitet er testet med
  genererede nøgler/certifikater, ikke mod en levende udbyder (NOT RUN,
  DKC-024/DKC-003-opfølgning). Den eksterne integration `integration-oidc`
  forbliver NOT RUN.
- **`verifyJwt` HS256-stien er defekt:** den kalder `crypto.verify` med en
  secret key i stedet for HMAC-sammenligning. DKC-003's egen suite dækkede ikke
  HS256-verifikation. DKC-004 bruger RS256 (produktionsrealistisk) og undgår
  den defekte sti; rettelsen bør ske separat i DKC-003-koden.
- **Ingen delt/HA-persistence.** Lageret er lokale filer på én node; et delt,
  transaktionelt lager (fx en database) er en senere opgave. Audit-loggen er
  tamper-evident, ikke tamper-proof mod en aktør med både skriveadgang og nøglen.
- **Politik er kode** (`defaultApprovalPolicy`), ikke en ekstern PDP-beslutning.
  En installation kan overskrive den, men der er ingen versioneret
  politik-kilde i repoet.
- **HTTP-laget er ikke pakket i DKC-003's fulde pipeline** (rate limit, CSRF,
  body-grænse). Beslutninger kræver en `authenticator`, men selve serveren bør i
  drift stå bag `identity/src/server.mjs`.
- **DKC-001's `changelog-check`-fejl består** (DCO sign-off).
- Overlay, ikke committed kode: `00-core/` er urørt.

## Til uafhængig gennemgang

- **Reviewets base-commit:** `5f9fa73457d22583b9948611d5cc3afffec4ae38`.
- **Undersøgt checkout:** `83ad91a963d8055f77c29fb4361455689df95acb`.
- **Forudsætninger:** `01-step1/output/` (DKC-001), `01-step1/output/dkc-002/` og
  `01-step1/output/dkc-003/`. `apply.sh` kæder dem.
- **Ændringen:** `01-step1/output/dkc-004/deliverable/` (22 filer) plus evidens i
  `01-step1/output/dkc-004/evidence/`. SHA256 i `OVERLAY-MANIFEST.txt`.
