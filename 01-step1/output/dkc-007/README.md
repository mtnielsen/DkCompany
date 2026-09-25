# DKC-007 — Stram policy-, scope- og evidenskontrol (leverance)

Implementering af **DKC-007** for `mtnielsen/DkCompany`. Bygger på DKC-001,
DKC-002, DKC-003, DKC-004, DKC-005 og DKC-006. `00-core/` er fortsat **ikke
ændret**; alt ligger under `01-step1/output/dkc-007/`.

## Hvad der er implementeret

1. **Grænsevalidering af manifest, task og PDP-svar.**
   - `runtime/src/boundary.mjs`: `validateManifest` (SPIFFE-ID, JIT-credential,
     ikke-tomt `ownedComponents`/`environments`, A4 må ikke deklareres),
     `validateTaskShape` (apiVersion/kind/taskId/tenantId/agentRef/objective,
     actions, evidens- og datakategori-form) og `validateActionBoundary`
     (miljø, ownedComponents, ensrettet target-scope, datakategori).
   - `validatePolicyDecision`: et svar accepteres kun med kendt `decision`
     (`allow`/`allow-with-approval`/`deny`), `pdp`-felter, `matchedRules` og en
     `inputSha256` der matcher `digestOf(input)`. Tomme, ukendte eller
     ikke-bundne svar stopper handlingen (fail-closed). `runtime/src/digest.mjs`
     er kanonisk identisk med PDP'ens.

2. **Fælles klassifikation af muterende verber og beskyttede A4-ressourcer.**
   `runtime/src/classification.mjs` er den ene kilde for både runtimen,
   conformance-suiten og policy-checken:
   - `isMutatingVerb` er **default-muterende** (kun en udtømmende læseliste er
     ikke-muterende), så et nyt verbum som `upgrade.hotfix` klassificeres rigtigt.
   - `isProtectedResource`/`isA4Violation` normaliserer mål (NFKC, gentagen
     procent-decode, `\`→`/`, separator-kollaps, `.`/`..`, case og aliaser), så
     `POLICY/Bundles`, `policy%2Fbundles`, `policy/./bundles`, `audit_service`
     og `res://acme/policy/7` alle rammer A4.
   - `withinScope` er **ensrettet**: et capability-scope dækker sig selv og sine
     børn, aldrig sine forældre.

3. **Miljø, ownedComponents, datakategori og ensrettet scope.** Pr. handling
   kræver runtimen at `action.environment` ligger i `manifest.scope.environments`,
   at capability-scope og target ligger inden for `ownedComponents`, og at
   `action.dataCategories ⊆ manifest.scope.dataCategories`.

4. **Evidens slås op og bindes til digest/commit.** `runtime/src/evidence.mjs`
   kræver en `evidenceIndex`-reference `{ uri, sha256, commit?, digest?, status? }`.
   Runtimen læser artefaktet, genberegner SHA-256 og kræver match; `tests-pass`
   kræver `status: "pass"`. `policy-allow` er intrinsisk (den validerede
   PDP-beslutning). En bar `"tests-pass"`-streng uden reference afvises. De
   verificerede digester følger med i policy-inputtet (`context.evidenceSha256`).

5. **Kontrakt, CLI, conformance og docs.** `contracts/agent-task.schema.json`
   får `evidenceIndex`, `action.dataCategories` og `action.evidenceIndex`;
   `contracts/policy-input.schema.json` får `evidenceSha256`; eksemplet er
   opdateret. `runtime/src/cli.mjs` får `--evidence-index` og `--evidence-base`.
   `conformance/src/checks/agents.mjs` (A-002) og `checks/policy.mjs` (C-009)
   bruger nu den fælles klassifikation. `make boundary-test` er nyt og
   registreret i `tools/baseline/registry.mjs`. ADR-0018 og
   `docs/spec/policy-boundary.md` dokumenterer beslutningen.

## Ændrede/nye filer (overlay, relativt til `00-core/`)

```
runtime/src/boundary.mjs                 (ny: manifest/task/PDP-grænsevalidering)
runtime/src/classification.mjs           (ny: muterende verber + A4-ressourcer, scope)
runtime/src/evidence.mjs                 (ny: digest-/commit-bundet evidens)
runtime/src/digest.mjs                   (ny: kanonisk digest, identisk med PDP'ens)
runtime/src/runtime.mjs                  (bruger grænsevalidering, klassifikation, evidens)
runtime/src/cli.mjs                      (+ --evidence-index/--evidence-base)
runtime/test/policy-boundary.test.mjs    (ny: DKC-007-accepttests)
runtime/test/classification.test.mjs     (ny)
runtime/test/evidence-fixtures.mjs       (ny: syntetiske, digest-bundne beviser)
runtime/test/pdp-fixtures.mjs            (ny: velformede, input-bundne PDP-svar)
runtime/test/runtime.test.mjs            (+ bundet evidens/PDP i stubber)
runtime/test/approval-runtime.test.mjs   (+ bundet evidens/PDP)
runtime/test/tenant-runtime.test.mjs     (+ bundet evidens/PDP)
contracts/agent-task.schema.json         (+ evidenceIndex, dataCategories, action.evidenceIndex)
contracts/examples/agent-task.example.json (+ evidenceIndex + dataCategories)
contracts/policy-input.schema.json       (+ context.evidenceSha256)
conformance/src/checks/agents.mjs        (A-002: fælles klassifikation + ensrettet scope)
conformance/src/checks/policy.mjs        (C-009: fælles muterende klassifikation)
conformance/test/agent-conformance.test.mjs (+ bundet evidens/PDP i stubber)
tools/baseline/registry.mjs              (+ boundary-test, opdateret agent-runtime)
Makefile                                 (+ boundary-test, + i ci)
docs/adr/0018-stram-policy-scope-og-evidenkontrol.md (ny ADR)
docs/adr/README.md, docs/spec/README.md  (indeks)
docs/spec/policy-boundary.md             (ny spec)
docs/status/implementation-matrix.md     (regenereret)
```

## Testkommandoer og resultater (checkout `83ad91a` + DKC-001..006, Node v22.22.1)

| Kommando | Resultat |
| --- | --- |
| `make boundary-test` | **21 pass / 0 fail** (15 grænse + 6 klassifikation) |
| `make runtime-test` | **46 pass / 0 fail** |
| `make agent-conformance-test` | **10 pass / 0 fail** |
| `make validate` | 23 skemaer, 22 eksempler, 5 arkitektur/identitet, 1 godkendelse, 1 tenant |
| `make policy-test` | **13 pass / 0 fail** |
| `make policy-verify` | 1 signeret bundle verificeret |
| `make policy-decide` | eksempelbeslutning (upgrade i staging) |
| `make tenant-test` | **94 pass / 0 fail** |
| `make approval-test` | **11 pass / 0 fail** + **20 pass / 0 fail** |
| `make gateway-test` | **13 pass / 0 fail** |
| `make audit-service-test` | **26 pass / 0 fail** |
| `make adapter-test` | **8 pass / 0 fail** |
| `make iam-adapter-test` | **8 pass / 0 fail** |
| `make architecture-test` | **10 pass / 0 fail** |
| `make identity-test` | **52 pass / 0 fail** |
| `make test` | **58 pass / 0 fail** |
| `make curriculum-test` | **5 pass / 0 fail** |
| `make baseline-test` | **8 pass / 0 fail** |
| `make baseline` | 54 checks: **44 pass, 1 fail, 0 error, 9 NOT RUN**; `boundary-test` og `runtime-test` **PASS** |

Evidens: `evidence/logs/*.log` og `evidence/baseline/` (JSON + logs). Den ene
baseline-fejl er fortsat `changelog-check` (manglende DCO sign-off, DKC-001-fundet).
Baselinekørslen ændrede de sporede `modules/*/conformance`-fixtures
(ikke-idempotente `*-evidence`-generatorer); de er nulstillet efter kørslen.

## Acceptkriterier

| Kriterium | Status | Bevis |
| --- | --- | --- |
| Ukendt eller tom PDP-beslutning afvises | **PASS** | `runtime/test/policy-boundary.test.mjs`: tomt svar, `decision: "maybe"` og et svar med forkert `inputSha256` giver alle `halted` og nul executor-kald; `boundary.test` for den rigtige PDP bekræfter digest-bindingen |
| Capability til module/child giver ikke adgang til module | **PASS** | `policy-boundary.test.mjs` (capability `dummy-ok/child`, handling `dummy-ok` → `refused`), `classification.test.mjs` (`withinScope("dummy-ok","dummy-ok/child") === false`) |
| Staging-agent kan ikke operere i prod | **PASS** | `policy-boundary.test.mjs` (manifest `["staging"]`, handling `prod` → `refused`, nul executor-kald) |
| Aliaser, case, encoding og nye muterende verber kan ikke omgå A4 | **PASS** | `policy-boundary.test.mjs` (7 bypass-mål + `upgrade.hotfix` → `refused` med A4), `classification.test.mjs` (normalisering/aliaser/default-muterende), A-002 i `conformance/src/checks/agents.mjs` |
| En tests-pass-streng uden verificerbart testresultat accepteres ikke | **PASS** | `policy-boundary.test.mjs`: bar `"tests-pass"` → `refused`; `evidenceIndex` med matchende digest → `completed`; forkert digest → `refused` |

## Prerequisite-blokering: DKC-055

- **DKC-055** ("én rolle pr. agent") er fortsat **ikke** implementeret. Den
  afhænger af DKC-007 (nu leveret) og kan tages som næste skridt. DKC-007's
  egne fem acceptkriterier kræver ikke DKC-055 og er dækket.

## Resterende begrænsninger

- **Klassifikationen er konservativ, ikke semantisk.** Alle verber uden for en
  fast læseliste regnes som muterende. Det er fail-safe, men et nyt læsende
  verbum skal tilføjes til listen for ikke at blive gated.
- **Bevisindekset leveres af kalderen/operatøren.** Runtimen verificerer
  digesten mod det faktiske artefakt, men hvem der må publicere indekset er en
  IAM-/CI-kontrol uden for denne opgave (jf. DKC-008/DKC-055).
- **Ingen levende PDP/model i dette miljø.** Digest-bindingen er testet mod den
  rigtige in-repo PDP (`policy/pdp`), men en deployeret PDP og rigtige
  testartefakter er integrationer (NOT RUN).
- **Kontraktbrud:** `agent-task` får `evidenceIndex`/`dataCategories`, og
  eksisterende opgaver skal levere digest-bundne beviser. En
  versionsmigration/kompatibilitetslag er ikke leveret.
- **DKC-001's `changelog-check`-fejl består** (4 commits mangler DCO sign-off).
- Overlay, ikke committed kode: `00-core/` er urørt.

## Til uafhængig gennemgang

- **Reviewets base:** `5f9fa73457d22583b9948611d5cc3afffec4ae38` (5f9fa73).
- **Undersøgt checkout:** `83ad91a`.
- **Forudsætnings-overlays:** DKC-001, DKC-002, DKC-003, DKC-004, DKC-005,
  DKC-006 (lægges via `apply.sh`, som kæder `dkc-006/apply.sh`).
- **Denne leverance:** `01-step1/output/dkc-007/` (26 filer i `deliverable/`,
  SHA256 i `OVERLAY-MANIFEST.txt`).
- Uafhængig verifikation, live-integrationer og menneskelig release-godkendelse
  er separate handlinger og er **ikke** udført her.
