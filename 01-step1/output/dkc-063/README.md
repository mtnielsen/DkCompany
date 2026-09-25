# DKC-063 — Testmatrix og CI-releasegates (leverance)

Implementering af **DKC-063** for `mtnielsen/DkCompany`. Bygger på
DKC-001 .. DKC-013, DKC-055, DKC-012, DKC-037 og DKC-053. `00-core/` er fortsat
**ikke ændret**; alt ligger under `01-step1/output/dkc-063/`.

## Forudsætninger og valg

DKC-063 afhænger formelt af **DKC-002** (arkitektur- og deployment-kontrakter).
Overlayen lægges oven på hele den nuværende stak via `dkc-053/apply.sh`, som
kæder `dkc-037/apply.sh` og dermed DKC-001 .. DKC-013 + DKC-055 + DKC-012.
**DKC-053 er valgt som forudsætning, fordi den er den aktuelle stak-top.**
DKC-053's platformmatrix genbruges som `supportedEnvironments`.

## Hvad der er implementeret

1. **Fem nye versionerede kontrakter.**
   - `contracts/test-matrix.schema.json` — `kind: TestMatrix` med krav, ejere,
     testtyper, checks, frister, uafhængige vurderinger, CI-trin, platforme og
     ejergodkendte tærskler.
   - `contracts/release-gate-result.schema.json` — `kind: ReleaseGateResult` med
     distinkte statusser og evidensbinding.
   - `contracts/threat-register.schema.json` — `kind: ThreatRegister` bundet til
     de syv testede grænser.
   - `contracts/risk-exception.schema.json` — `kind: RiskExceptions`,
     tidsbegrænsede og menneskeejede.
   - `contracts/independent-assessment.schema.json` — `kind:
     IndependentAssessment` for penetrationstest, levende måling og ekstern
     revision.
2. **Matrix og registre.** `release/matrix/test-matrix.json` mapper **23 krav**
   til navngivne, kørebare checks eller til en eksplicit uafhængig vurdering;
   `threats.json` dækker de syv grænser med 8 trusler; `exceptions.json` og
   `assessments.json` er tomme som standard. Hvert krav har en navngivet
   menneskelig ejer, kontrolreferencer mod `compliance/control-mapping.json` og
   en evidensfrist.
3. **Semantisk validator.** `conformance/src/release.mjs` afviser bl.a.
   manglende ejere, testtyper uden en check, manglende frist, trusselmodeller
   uden de syv grænser, undtagelser uden udløb eller kompenserende kontroller,
   og gate-resultater der tæller andet end `passed` som bestået.
4. **Den rene release-gate.** `release/src/gate.mjs` oversætter
   baseline-status til `passed`, `failed`, `skipped`, `not-run`, `unsupported`,
   `stale`, `wrong-artifact`, `missing`, `pending-independent-assessment` eller
   `excepted`. Kun `passed` tæller som bestået. Hvert check-resultat binder
   commit, artefakt-digest (`sha256:`), profil, miljø, producent, kommando og
   tidsstempler. En commit-mismatch giver `wrong-artifact`; evidens ældre end
   kravets frist giver `stale`.
5. **Producent-adskillelse.** Et krav med en uafhængig vurdering kan ikke
   opfyldes af en implementørkørsel. En gyldig vurdering kræver en
   ikke-implementør, et navngivet menneske, et udløbstidspunkt og et
   `targetCommit` der matcher release-målet.
6. **Tærskler og undtagelser.** Tærsklerne har en navngivet menneskelig accept.
   En risikoundtagelse skal have ejer, udløbsdato og kompenserende kontroller,
   må ikke dække et `nonExcepted`-krav og gælder ikke efter udløb.
7. **Trusselmodel og dokumenter.** `docs/security/threat-model.md` og
   `docs/testing/test-matrix.md` genereres fra de kanoniske data og kontrolleres
   for sync. `docs/status/release-gate.md` er gate-resultatet for den faktiske
   baselinekørsel.
8. **CI-trin.** `Makefile` får `release-check`, `release-test`, `release-write`,
   `release-gate` og `release`; `release-check` og `release-test` indgår i
   `make ci`. `.github/workflows/release-gate.yml` koder CI-trinnene og kører
   baseline + gate (Actions er slået fra i dette miljø, så det er konfiguration
   og dokumentation, der kan køres lokalt).
9. **16 kritiske gate-fixtures.** `release/test/fixtures/gate-cases.json` beviser
   at `failed`, `skipped`, `not-run`, `unsupported`, `stale`, `wrong-artifact`,
   `missing`, et grønt resumé over en fejlende check, en udløbet undtagelse og et
   forsøg på at undtage et `nonExcepted`-krav alle blokerer.

## Ændrede/nye filer (overlay, relativt til `00-core/`)

```
Makefile                                             (+ release-check/-test/-write/-gate/-release, + i ci)
.github/workflows/release-gate.yml                   (ny: CI-trin og release-gate)
conformance/src/release.mjs                          (ny: semantisk validator)
conformance/src/schemas.mjs                          (+ 5 skema-id'er)
conformance/src/validate-schemas.mjs                 (+ releasevalidering)
conformance/test/release-conformance.test.mjs        (ny: 5 accepttests)
contracts/{test-matrix,release-gate-result,threat-register,risk-exception,independent-assessment}.schema.json (ny)
contracts/examples/*.example.json                    (ny: 5 eksempler)
release/package.json                                 (ny)
release/matrix/{test-matrix,threats,exceptions,assessments}.json (ny)
release/src/{load,gate,render,check,cli}.mjs         (ny)
release/test/{gate,matrix}.test.mjs                  (ny)
release/test/fixtures/gate-cases.json                (ny: 16 fixtures)
docs/adr/0028-testmatrix-og-releasegates.md          (ny ADR)
docs/spec/release-gates.md                           (ny spec)
docs/testing/test-matrix.md                          (genereret)
docs/security/threat-model.md                        (genereret)
docs/status/release-gate.md                          (genereret gate-resultat)
docs/status/implementation-matrix.md                 (regenereret)
docs/adr/README.md, docs/spec/README.md              (opdateret)
tools/baseline/registry.mjs                          (+ release-gates-komponent og 2 checks)
```

## Testkommandoer og resultater (checkout `83ad91a` + DKC-001..013 + DKC-055 + DKC-012 + DKC-037 + DKC-053, Node v22.22.1)

| Kommando | Resultat |
| --- | --- |
| `make release-check` | **OK** (23 krav, 23 obligatoriske, 3 med uafhængig vurdering; dokumenter i sync) |
| `make release-test` | **32 pass / 0 fail** (27 gate/matrix + 5 konformans-accepttests) |
| `make validate` | **42 skemaer / 41 eksempler** + 5 release-eksempler (skema + semantik) |
| `make lint` | **OK** (254 JSON-filer, 618 filer) |
| `make test` (conformance) | **115 pass / 0 fail** |
| `make architecture-test` / `continuity-test` / `distribution-test` | 10 / 27 / 42 pass |
| `make baseline-test` | **8 pass / 0 fail** |
| `make baseline` | **67 pass, 1 fail (DCO), 0 error, 10 not run af 78**; `release-check` og `release-test` **PASS** |
| `make release-gate` | **BLOCKED (19/23 krav pass, 4 blokerende)** — 3 `pending-independent-assessment` + `REQ-GITOPS-001` (`changelog-check` mangler DCO) |

`make baseline`'s ene fejl er DKC-001's kendte `changelog-check` (4 commits
mangler DCO sign-off). Den slår igennem som en ægte blokering i
`REQ-GITOPS-001`. Baselinekørslen ændrede committede fixture-filer under
`modules/*/conformance`; de er nulstillet med
`git checkout -- modules/*/conformance` fra `00-core/`. Evidens:
`evidence/logs/*.log`, `evidence/baseline/latest.json`,
`evidence/baseline/runs/`, `evidence/baseline/logs/`,
`evidence/baseline/artifacts/`.

## Acceptkriterier

| Krav | Status | Bevis |
| --- | --- | --- |
| Hvert obligatorisk krav mapper til en navngivet, kørebar check eller en eksplicit udestående uafhængig vurdering | **PASS** | `release/matrix/test-matrix.json` (23 krav), `release-check`, `release/test/matrix.test.mjs`; `REQ-PERFORMANCE-001`/`REQ-CONTINUITY-001`/`REQ-SECURITY-001` har `independentAssessment.required` |
| Failed, skipped, not-run, unsupported og stale er distinkte; ingen tæller som bestået | **PASS** | `release/src/gate.mjs` + 16 fixtures i `release/test/fixtures/gate-cases.json`; `conformance/src/release.mjs` tæller kun `passed` |
| Evidens binder commit, artefakt-digest, konfiguration/profil, miljø, producent, kommando og tidsstempler | **PASS** | `gate.mjs` sætter `commit`, `artifactDigest`, `profile`, `environment`, `producer`, `command`, `startedAt`/`finishedAt`, `ageDays`; `release-gate-result.schema.json`; fixturen `wrong-artifact` |
| Implementørchecks kan ikke udgive sig for uafhængig verifikation; tests deaktiveres ikke for at bestå en gate | **PASS** | `gate.mjs` `pending-independent-assessment` + fixturen `pending-independent`; `inflated-green`-fixturen beviser at et grønt resumé ikke overskriver en fejlende check; gaten læser status pr. check |
| Succesfulde enhedstests alene giver aldrig produktions-, HA- eller compliance-status | **PASS** | Testen "kun 'passed' tæller som bestået" (0 pass ved tom evidens), `pending-independent`-fixturen, og `docs/status/release-gate.md` der er BLOCKED på trods af 67 grønne checks |

## Resterende begrænsninger

- **Release-gaten er med vilje BLOCKED lokalt.** Tre krav kræver uafhængig
  vurdering (levende recovery-måling, performance, sikkerhedsscanning), og
  `REQ-GITOPS-001` fejler på den kendte DCO-mangel. Det er det korrekte
  fail-closed-resultat, ikke en defekt.
- **Ingen levende performance-/recovery-/scanningskørsel.** De er registreret som
  uafhængige vurderinger og blokerer, indtil de foreligger.
- **GitHub Actions er slået fra.** Workflowet er konfiguration og kan køres
  lokalt; `integration-github-actions` forbliver `NOT RUN`.
- **Severity-/afhjælpningsreglerne er foreslåede.** De kræver Platform Owners
  accept (matrixens `thresholds`) før de er bindende.
- **Independence er et menneskeligt forhold.** Gaten håndhæver adskillelsen
  mekanisk; kvaliteten af en uafhængig vurdering er en menneskelig opgave.
- **DKC-001's `changelog-check`-fejl består** (4 commits mangler DCO sign-off).
- Overlay, ikke committed kode: `00-core/` er urørt.

## Til uafhængig gennemgang

- **Reviewets base:** `5f9fa73457d22583b9948611d5cc3afffec4ae38` (5f9fa73).
- **Undersøgt checkout:** `83ad91a`.
- **Forudsætnings-overlays:** DKC-001 .. DKC-013, DKC-055, DKC-012, DKC-037 og
  DKC-053 (lægges via `apply.sh`, som kæder `dkc-053/apply.sh`).
- **Denne leverance:** `01-step1/output/dkc-063/` (38 filer i `deliverable/`,
  SHA256 i `OVERLAY-MANIFEST.txt`; 14 evidenslogger og baselinekørsel).
- Uafhængig verifikation, faktisk produktion, levende performance-/recovery-/
  scanningskørsel og menneskelig release-godkendelse er separate handlinger og
  er **ikke** udført her.
