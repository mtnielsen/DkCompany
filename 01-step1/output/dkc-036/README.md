# DKC-036 — Enterprise- og brancheprofiler

Kumulativ overlay oven på stak-tippet **DKC-035**. Lægges med
`./apply.sh <checkout>/00-core`.

- **Reviewets base:** `5f9fa73457d22583b9948611d5cc3afffec4ae38` (`5f9fa73`)
- **Undersøgt checkout:** `83ad91a963d8055f77c29fb4361455689df95acb` (`83ad91a`)
- **Forudsætningskæde:** `dkc-035/apply.sh` → `dkc-033/apply.sh` →
  `dkc-065/apply.sh` → … → `dkc-001/apply.sh`. DKC-036 afhænger formelt af
  **DKC-023, DKC-033, DKC-034 og DKC-035**; alle er verificeret i den anvendte
  stak (`evidence/prerequisites.txt`).
- **Miljø:** Node v22.22.1. Ingen underskrevet testkundeaftale, ingen bekræftet
  faglig/sektor-vurdering og ingen bekræftet højrisiko-AI-vurdering. Pakkerne,
  kapabilitetskravene, de fælles sikkerhedskontrakter, resolver-integrationen,
  prioriteringen, scaffolden og de fail-closed gates er efterprøvet
  deterministisk; den menneskelige aftale og vurdering er **NOT RUN**, og
  **ingen pakke er implementerbar**.

## Implementeret adfærd

1. **Fem sammensatte enterprise- og branchepakker** (`enterprise/packages.json`,
   `contracts/enterprise-package.schema.json`): `enterprise-core` (enterprise),
   `retail-commerce` (handel), `field-service` (feltservice), `manufacturing`
   (produktion) og `regulated-care` (regulerede brancher). Hver pakke bygger på
   en af de tre størrelsesprofiler og beskriver apps, kapabilitetskrav,
   dataejerskab, ekstra isolation, integrationer, faglige krav, sektorregler,
   højrisiko-AI, produktejer, testkunde, implementeringsstatus, TCO-reference og
   fravalg.
2. **Fælles sikkerhedskontrakter** (`securityContracts`): de tre
   størrelsesprofiler deler den samme `securityCore`, og pakkerne gentager de
   fire fælles obligatoriske gates (`security`, `privacy`, `restore`, `role`)
   fra `distribution/acceptance/gate-policy.json` med præcis de samme
   `requirementRefs`. `securityContractProblems` fejler, hvis profilerne ikke
   deler kerne, eller hvis en gate afviger. En pakke kan ikke forke
   kontrolplanet.
3. **Kapabilitetsregister** (`enterprise/capabilities.json`, kind
   `CapabilityCatalog`): det kanoniske register valideres mod de faktiske
   komponentmanifester. `controlPlane`-kapabiliteter skal udbydes udelukkende af
   sikkerhedskerne-komponenter.
4. **Resolver-integration** (`enterprise/src/resolver.mjs`): hver pakke løses
   gennem `distribution/src/resolver.mjs` mod sin størrelsesprofil. En påkrævet
   kapabilitet skal være til stede i closuren, en forbudt må ikke være det, og
   kontrolplans-kapabiliteter skal arves fra profilens kerne. `field-service`
   (`field-dispatch`, `offline-sync`) og `manufacturing` (`mes`, `plm`) er ærligt
   blokeret af kapabiliteter, kataloget endnu ikke udstiller.
5. **Fail-closed gate** (`enterprise/src/gate.mjs`): en pakke er ikke
   implementerbar uden en navngivet produktejer, en navngivet testkundekontakt,
   en underskrevet aftale, bekræftede faglige/sektor-/AI-vurderinger og en
   eksplicit menneskeligt godkendt ordre. `buildBacklog` er tom, indtil en
   sådan ordre findes: en katalogpost bliver ikke automatisk til en byggeopgave.
6. **Prioritering** (`enterprise/src/priority.mjs`): deterministisk rækkefølge
   efter efterspørgsel fra pilotvirksomhedsprofilerne (DKC-033) og den
   dokumenterede 12-måneders TCO (`metering/report/tco-comparison.json`,
   DKC-034). Prioriteringen erklærer `measured: false`.
7. **Scaffold og fixtures** (`enterprise/scaffold/package.template.json`,
   `enterprise/src/scaffold.mjs`, `enterprise/fixtures/`): en ny branchepakke
   kan oprettes med arvede sikkerhedskontrakter og valideres mod skema og model,
   før den skrives. Fixtures demonstrerer konflikterende krav, en
   ikke-understøttet kapabilitet, en manglende navngivet ejer og et forsøg på at
   gøre en katalogpost til en byggeopgave.
8. **Kontrakt og konformans** (`contracts/enterprise-package.schema.json`,
   `contracts/examples/enterprise-package.example.json`,
   `conformance/src/enterprise.mjs`,
   `conformance/test/enterprise-conformance.test.mjs`): skema + beslutningssemantik,
   wired ind i `validate-schemas.mjs` (afsnit 54) og i `SCHEMA_IDS`.
9. **Releasebinding**: nyt krav `REQ-ENTERPRISE-001` (controlRefs `cm-2`,
   `si-12`, `ai-act-art9`, `ai-act-art14`) og trussel `THREAT-ENTERPRISE-001`
   (grænsen `tenant-boundary`), matrixversion **1.46.0**. Registreret i
   `tools/baseline/registry.mjs` som komponenten `enterprise-profiles` med
   `enterprise-check/-test/-run/-report` og `integration-enterprise-live`
   (NOT RUN). ADR **0077**.
10. **Rapport**: `make enterprise-render` skriver den deterministiske rapport
    til `enterprise/report/enterprise-package-report.json` og
    `docs/enterprise/enterprise-package-report.md`;
    `make enterprise-check` afviser en rapport ude af trit med kilden.

## Ændrede og nye filer

Se `evidence/deliverable-files.txt` (44 filer, beregnet ved at diffe arbejdsklonen
mod en frisk klon med kun `dkc-035/apply.sh` anvendt, ekskl. `node_modules`,
`.conformance-out`, `.git`, `evidence/generated`, `migration/exports`).
Hovedgrupper:

- `enterprise/` — 2 kanoniske datafiler, scaffold-skabelon, 4 fixtures,
  8 kildemoduler, 5 testsuiter og rapporten.
- `contracts/enterprise-package.schema.json` + ét eksempel;
  `conformance/src/enterprise.mjs`,
  `conformance/test/enterprise-conformance.test.mjs`.
- `conformance/src/{schemas.mjs,validate-schemas.mjs}` (afsnit 54).
- `docs/spec/enterprise-profiles.md`, `docs/operations/enterprise-packages.md`,
  `docs/runbooks/enterprise-package-onboarding.md`,
  `docs/roadmap/enterprise-industry-program.md`,
  `docs/compliance/sector-and-ai-assessments.md`,
  `docs/enterprise/enterprise-package-report.md`,
  `docs/adr/0077-…`, `docs/adr/README.md`, `docs/spec/README.md`.
- `Makefile`, `tools/baseline/registry.mjs`,
  `release/matrix/{test-matrix,threats}.json`, genererede
  `docs/status/implementation-matrix.md`, `docs/testing/test-matrix.md`,
  `docs/security/threat-model.md`, `pilot/report/pilot-readiness-report.json`
  (matrixantal ændret fra 68 til 69 krav).

## Testkommandoer og resultater

| Kommando | Resultat |
| --- | --- |
| `make install` | OK (conformance-afhængigheder) |
| `make enterprise-check` | PASS (katalog, kapabiliteter, sikkerhedskontrakter og rapport i trit) |
| `make enterprise-test` | PASS (26 enhedstests + 8 konformanstests) |
| `make enterprise-run` | PASS (5 pakker, 0 implementerbare, 5 blokerede) |
| `make enterprise-render` | PASS (2 rapportfiler skrevet) |
| `make distribution-check` | PASS (18 komponenter, 3 profiler; alle pakker resolver) |
| `make release-check` | PASS (69 krav; matrixversion 1.46.0) |
| `make validate` | PASS (164 skemaer, eksempler, afsnit 54: 4 enterprise-kontrakter) |
| `make lint` | PASS (843 JSON-filer, 2177 filer) |
| `make test` | PASS (528 tests, 0 fejl) |
| `make pilot-check` | PASS (readiness `not-ready`) |
| `make baseline` | 279 checks: **218 PASS, 1 FAIL, 60 NOT RUN**. Det ene FAIL er det kendte, forudgående `changelog-check` (manglende DCO sign-off, også i `83ad91a`); det er ikke "rettet". |

E2e: pakkens `apply.sh` blev lagt på en frisk klon, `make install` kørt, og de
fokuserede checks passerer. Træet er byte-identisk med arbejdsklonen (0 diffs,
`evidence/e2e-tree-diff.log`).

## Acceptkriterier

| Kriterium | Status | Bevis |
| --- | --- | --- |
| Alle tre størrelsesprofiler deler de samme sikkerhedskontrakter | **PASS** | `enterprise/src/model.mjs#securityContractProblems`; `enterprise/packages.json#securityContracts` gentager de fire fælles gates; `make enterprise-check` fejler ved afvigelse. `make enterprise-run` viser `delte`. |
| Hver branchepakke har en navngivet produktejer og testkunde før implementering | **PASS** (kontrol) / **NOT RUN** (aftale) | Hver pakke har `productOwner` og `testCustomer.contact` som navngivne mennesker; `enterprise/src/gate.mjs` blokerer uden en underskrevet aftale. Aftalerne er **NOT RUN**. |
| Højrisiko-AI og sektorregler har særskilt vurdering | **PASS** (kontrol) / **NOT RUN** (vurdering) | `regulated-care` har `highRiskAi.applicable: true` og `sectorRules`; `evaluatePackageGate` blokerer, indtil et navngivet menneske bekræfter. Vurderingerne er **NOT RUN**. |
| Katalogposter bliver ikke automatisk til bestilte byggeopgaver | **PASS** | `deriveBuildBacklog` udleder kun byggeopgaver af en eksplicit ordre; `make enterprise-run` viser `buildBacklog` tom og `catalogOnlyNotBuildTasks` for hver pakke; `enterprise/fixtures/auto-build.package.json` afvises. |

### Øvrige krav fra opgavebeskrivelsen

| Krav | Status | Bevis |
| --- | --- | --- |
| Sammensatte enterprise-/brancheprofiler med kapabilitetskrav og validering gennem den eksisterende resolver | **PASS** | `enterprise/src/resolver.mjs` kalder `distribution/src/resolver.mjs#resolveDependencies` og kontrollerer kapabilitetskravene mod closuren. |
| Reusable module-/profile-scaffold og konformansfixtures uden at forke kontrolplanet | **PASS** | `enterprise/src/scaffold.mjs` + `enterprise/scaffold/package.template.json` + `enterprise/fixtures/`; scaffold-testen validerer outputtet. |
| Test konflikterende krav og ikke-understøttede kapabiliteter | **PASS** | `enterprise/test/{model,resolver}.test.mjs` tester både `både påkrævet og forbudt` og `UNSUPPORTED_CAPABILITY`. |
| Pakkeskabeloner til enterprise, handel, produktion, feltservice og regulerede brancher | **PASS** | De fem pakker i `enterprise/packages.json` + `docs/roadmap/enterprise-industry-program.md`. |
| Hver pakke beskriver apps, dataejerskab, ekstra isolation, integrationer og faglige krav | **PASS** | Skemaet kræver alle fem felter; rapporten gengiver dem pr. pakke. |
| Prioritér fra kataloget efter efterspørgsel og dokumenteret samlet omkostning | **PASS** | `enterprise/src/priority.mjs` bruger pilotprofilerne og `metering/report/tco-comparison.json`; rapportens `priority`-afsnit. |
| Specialistiske juridiske/sikkerhedsmæssige godkendelser er uafklarede input, ikke opdigtede standarder | **PASS** | Alle faglige/sektor-/AI-vurderinger står `unreviewed`/`pending`; `make enterprise-check` afviser en `confirmed` uden et navngivet menneske, et tidspunkt og et bevis. |

## Tilknyttede krav/checks og hvad der er NOT RUN

- `REQ-ENTERPRISE-001` binder `enterprise-check/test/run/report` og
  `integration-enterprise-live`; `THREAT-ENTERPRISE-001` (grænsen
  `tenant-boundary`) dækker en branchepakke der forker kontrolplanet eller
  aktiverer højrisiko-AI/sektorregler uden en særskilt vurdering.
- `integration-enterprise-live` er **NOT RUN**: der findes ingen underskrevet
  testkundeaftale og ingen bekræftet faglig/sektor-/AI-vurdering. Se
  `docs/spec/enterprise-profiles.md`.
- Alle fem pakker er `blocked`; `regulated-care` afventer en særskilt
  højrisiko-AI-vurdering, og `field-service`/`manufacturing` afventer
  kapabiliteter, kataloget endnu ikke udstiller.
- Rapporten erklærer `measured: false` og `implementable: false` for alle
  pakker.

## Gennemgå-identifikatorer

- Base: `5f9fa73457d22583b9948611d5cc3afffec4ae38`
- Checkout: `83ad91a963d8055f77c29fb4361455689df95acb`
- Stak-tip før dette overlay: `dkc-035/apply.sh`
- Denne ændring: denne pakkes `deliverable/` (44 filer) oven på stakken.
