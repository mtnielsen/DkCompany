# DKC-027 — Integrér projektstyring (OpenProject)

Kumulativ overlay oven på stak-tippet DKC-058. Lægges med
`./apply.sh <checkout>/00-core`.

- **Reviewets base:** `5f9fa73457d22583b9948611d5cc3afffec4ae38` (`5f9fa73`)
- **Undersøgt checkout:** `83ad91a963d8055f77c29fb4361455689df95acb` (`83ad91a`)
- **Forudsætningskæde:** `dkc-058/apply.sh` → `dkc-054/apply.sh` →
  `dkc-046/apply.sh` → … → `dkc-001/apply.sh`. DKC-027 afhænger formelt af
  **DKC-016** (backup og gendannelse), **DKC-021** (sletning, legal hold og
  gendannelsesregler), **DKC-023** (fælles adapterværktøjer) og **DKC-025**
  (portal og kundelivscyklus). Alle er verificeret i den anvendte stak:
  `backup/`, `retention/`, `adapter-sdk/` og `portal/`
  (se `evidence/prerequisites.txt`).
- **Miljø:** Node v22.22.1. Ingen rigtig OpenProject, ingen Enterprise-SSO, ingen
  browser. De statisk fuldt gennemførlige dele er implementeret og efterprøvet;
  den rigtige upstream-integration er NOT RUN.

## Implementeret adfærd

1. **Projektstyringsmodul** (`modules/openproject-adapter/`): adapteren wrapper
   OpenProject uændret (projekter, arbejdspakker, relationer, medlemskaber,
   vedhæftninger og statushændelser) bag den fælles adapter-SDK (DKC-023). Auth,
   tenantudledning, fail-closed PDP, audit, idempotens, health og
   versionsforhandling genbruges 1:1.
2. **Default-deny projekttilgang** (`decideProjectAccess`): tenant-admin har
   adgang i sin egen tenant; alle andre skal have et dækkende medlemskab med den
   nødvendige rettighed. `projectRole` filtrerer medlemskaber på `projectId`, så
   et medlemskab i ét projekt ikke giver adgang til et andet. Fremmed tenant,
   deaktiverede konti og manglende medlemskab afvises før rettighedsvurdering.
3. **Projektgæst isoleret til eget projekt**: en `external-guest` får kun adgang
   med kundepolitikken `guestAccess: own-projects-only` og aldrig skrive- eller
   eksportrettigheder.
4. **Import og eksport** i kontrakten `ProjectBundle`
   (`contracts/project-export.schema.json`): stabil `externalId`, kanonisk
   importplan og idempotens ved retry. Et bundt med dubleret `externalId`, ukendt
   afhængighed, cyklus eller fremmed tenant afvises, før noget skrives.
5. **Rettighedsbevidst søgning og AI** (`buildPermissionProjection`,
   `isProjectionFresh`): hver medlemskabsændring skubber en ny versionsstyret
   projektion, og en retrieval med en forældet projektion afvises fail-closed
   (`stale_projection`). Dermed slår en permissionændring igennem, før søgning
   eller AI svarer.
6. **Editioner**: `openproject-community` frigiver projekt/opgave/medlemskab/
   filer/statushændelser, men **ikke** central OIDC/SAML-SSO;
   `openproject-enterprise` frigiver alle krævede features. `featureReport`
   registrerer hver manglende feature eksplicit som en afvigelse.
7. **Autoritative data**: OpenProject er system-of-record for projektindhold;
   tenantreference, audit, DSAR, søgeprojektion og sletterkvittering er
   autoritative i platformen (`AUTHORITATIVE_DATA`, `docs/spec/openproject-adapter.md`).
8. **Privacy-verber**: locate/export/erase er `partial` (backups, søgeindeks og
   revisionsspor kræver upstream-oprydning efter DKC-021); legal hold er
   `unsupported`; retention.policy er `partial`. Sletning blokeres af legal hold
   og retention og rapporterer de resterende kopier.
9. **Ærlig backup/opgradering**: backup/upgrade.dry-run/slo er `partial`;
   restore/verify-restore/upgrade/migrate/rollback er `unsupported`.
10. **Kontrakter, konformans og drift**: kandidat + releaseprofil i
    `adapter-sdk/registry.json`, semantiske validatorer i
    `conformance/src/projects.mjs`, Makefile-targets og baseline-checks,
    dataregisterpost, observability-regler, GitOps-manifester (dev), ADR-0061,
    spec/runbook/DPIA/SLO og 2 nye trusler (REQ-PROJECT-001, matrix 1.30.0).

## Ændrede filer

59 leverancefiler (36 nye, 23 ændrede, 0 slettede): se
`evidence/deliverable-files.txt`. De vigtigste:

- `modules/openproject-adapter/` — nyt modul: `module-manifest.json`,
  `service/package.json`, `service/src/{constants,openproject,mock-openproject,projects,server,auth,evidence,cli,pdp-client}.mjs`,
  `service/test/{adapter,projects}.test.mjs` og `conformance/` (bevis + events).
- `contracts/project-export.schema.json` + `contracts/examples/project-export.example.json`,
  `conformance/src/projects.mjs`,
  `conformance/test/openproject-adapter-conformance.test.mjs`,
  `conformance/src/{schemas.mjs,validate-schemas.mjs}`.
- `adapter-sdk/registry.json` og genereret
  `contracts/examples/{integration-candidate,upstream-release-profile}.openproject-adapter.example.json`
  + `docs/status/adapter-sdk.md`.
- `Makefile`, `tools/baseline/registry.mjs` (komponent `openproject-adapter` + 4
  checks), `release/matrix/{test-matrix,threats}.json` (REQ-PROJECT-001 + 2
  trusler, matrix 1.30.0).
- `containers/openproject-adapter/Dockerfile` + `containers/containers.json`, og
  regenereret `release/{sbom,artifacts}` + `docs/status/supply-chain.md`.
- `gitops/apps/openproject-adapter-application.json` +
  `gitops/manifests/dev/openproject-adapter-{deployment,service,serviceaccount}.json`,
  `infrastructure/src/{cli,plan}.mjs`, regenererede observability-regler.
- `compliance/data-register.json` + genereret `docs/compliance/data-register.md`.
- `docs/status/implementation-matrix.md`, `docs/testing/test-matrix.md`,
  `docs/security/threat-model.md` (regenereret pga. ny førstepartspakke og nye
  krav/trusler).
- Dokumentation: `docs/spec/openproject-adapter.md`,
  `docs/runbooks/project-management.md`,
  `docs/adr/0061-projektstyring-og-rettighedsbevidst-soegning.md`,
  `docs/dpia/openproject-adapter.md`, `docs/slo/openproject-adapter.md` samt
  opdaterede `docs/spec/README.md` og `docs/adr/README.md`.

## Testkommandoer og resultater

Kørt i den arbejdsklonede stak (stak-tip DKC-058 + DKC-027). Alle nedenstående
er PASS i `evidence/`-loggene:

| Kommando | Resultat | Log |
| --- | --- | --- |
| `make validate` | PASS (115 kontraktskemaer, 126 eksempler) | `evidence/validate.log` |
| `make lint` | PASS (646 JSON-filer) | `evidence/lint.log` |
| `make test` | PASS (372 tests) | `evidence/test.log` |
| `make openproject-adapter-test` | PASS (32 modul- + 9 konformanstests) | `evidence/openproject-adapter-test.log` |
| `make openproject-adapter-demo` | PASS (eksport/import, gæsteisolation, projektion, sletning) | `evidence/openproject-adapter-demo.log` |
| `make openproject-adapter-evidence` | PASS (3 full-verbums-beviser + partial) | `evidence/openproject-adapter-evidence.log` |
| `make adapter-sdk-check` / `-test` | PASS (5 adaptere; i trit) | `evidence/adapter-sdk-*.log` |
| `make release-check` / `-test` | PASS (53 krav, matrix 1.30.0) | `evidence/release-*.log` |
| `make supply-chain-check` | PASS | `evidence/supply-chain-check.log` |
| `make data-register-check` | PASS (9 poster, 0 aktive blockere) | `evidence/data-register-check.log` |
| `make observability-check` | PASS (regler matcher modulets SLO) | `evidence/observability-check.log` |
| `make gitops-verify` / `infrastructure-verify` | PASS (9/9 i dev/staging/prod) | `evidence/gitops-verify.log`, `evidence/infrastructure-verify.log` |
| `make conform-all` / `conform-negative` | PASS / forventet FAIL | `evidence/conform-*.log` |
| `make baseline` | 154 PASS, 1 FAIL, 44 NOT RUN af 199 | `evidence/baseline.log`, `evidence/baseline-summary.txt` |

### E2E på en frisk klon med kun pakkens `apply.sh`

| Kommando | Resultat | Log |
| --- | --- | --- |
| `./dkc-027/apply.sh <clone>/00-core` | PASS | `evidence/e2e-apply.log` |
| `make install` | PASS | `evidence/e2e-install.log` |
| fokuseret kontrol (`validate`, `lint`, `openproject-adapter-test`, `openproject-adapter-demo`, `adapter-sdk-check`, `release-check`, `supply-chain-check`, `test`) | PASS | `evidence/e2e-check.log` |
| træ-diff mod arbejdsklonen | byte-identisk (0 forskelle) | `evidence/e2e-tree-diff.txt` |

### Baseline

`make baseline` giver **154 PASS, 1 FAIL, 0 error, 44 NOT RUN af 199 checks**.
Den ene FAIL er den kendte, forudgående **`changelog-check`**: commits i
checkoutet mangler DCO sign-off (også `83ad91a`). Den er ikke "rettet" eller
skjult. De fire nye checks (`openproject-adapter-test`, `-evidence`, `-demo` og
`integration-openproject`) er henholdsvis PASS og NOT RUN med en præcis
begrundelse. Baseline muterer som vanligt sporede filer under
`modules/*/conformance`; snapshottet (65 filer) blev gendannet bagefter, og
`diff -rq` viste ingen afvigelser.

## Acceptkriterier

| # | Kriterium | Resultat | Evidens |
| --- | --- | --- | --- |
| 1 | Projekt med opgaver, ansvarlige og afhængigheder kan importeres og eksporteres | PASS | `ProjectBundle`-kontrakten, `exportProjectData`/`importProjectBundle`, `projectBundleProblems`, `topologicalOrder`, `service/test/{projects,adapter}.test.mjs`; idempotent ved retry |
| 2 | Projektgæst kan kun se sit projekt | PASS | `decideProjectAccess`, `projectRole` filtrerer pr. projekt, `visibleProjectIds`; HTTP-test 200 for eget / 403 for fremmed projekt |
| 3 | Permissionændringer slår igennem i søgning og AI-adgang | PASS | `buildPermissionProjection` + `isProjectionFresh`; `project.member.add` skubber ny version; retrieval på forældet projektion giver 409 `stale_projection` |
| 4 | Backup/restore og versionsopgradering består | PASS (mekanisme) / NOT RUN | `backupDeclaration` (backup/upgrade partial, restore unsupported), versionsforhandling `^14.0.0`; en faktisk gendannelse/opgradering mod en levende OpenProject er NOT RUN |
| — | SSO, projektrettigheder, opgaveimport/eksport, filer og status-events | PASS (mekanisme) | `module-manifest.json` (OIDC/SCIM/SPIFFE), rollematrix, `ProjectBundle`, `@example.org`-endpoints; rigtig Enterprise-SSO er NOT RUN |
| — | Verificér hvilke features der findes i Community/Enterprise | PASS (mekanisme) | `EDITION_COMBINATIONS`, `featureReport`, `assessEditionCombination`; Community mangler central SSO og rapporteres som afvigelse. Den endelige produktverifikation mod levende OpenProject er NOT RUN |
| — | Definér hvilke projektdata der er autoritative i upstream | PASS | `AUTHORITATIVE_DATA` + `docs/spec/openproject-adapter.md` |
| — | Tenantgrænse, verificeret identitet og fail-closed PDP | PASS | `service/test/adapter.test.mjs` (401/403/503), SDK-genbrug |

## Grænser og resterende arbejde

- Der findes ingen rigtig OpenProject-installation og ingen Enterprise-SSO i
  dette miljø. Al adfærd er efterprøvet mod `mock-openproject.mjs` og den
  rigtige PDP; en levende upstream er registreret som `integration-openproject`
  (NOT RUN).
- Kandidaten er bevidst **ikke** godkendt (`candidate_not_approved`), fordi en
  testet gendannelse mangler; releaseprofilens gate står som `blocked`.
- Vedhæftningsindhold og revisionshistorik eksporteres delvist; `subject.erase`
  efterlader backups, søgeindeks og revisionsspor, som kræver en
  upstream-oprydning (DKC-021).
- "Verificér hvilke features der findes i Community/Enterprise" er dokumenteret
  og kodet som en feature-matrix med kilder, men den endelige verifikation mod en
  levende OpenProject-version/edition er en menneskelig/ekstern opgave.
- `changelog-check` forbliver den ene kendte FAIL (manglende DCO sign-off).

## Verifikation

Manifestet er selvkonsistent: alle hashes i `OVERLAY-MANIFEST.txt` er
verificeret med `sha256sum -c` (se `evidence/manifest-verify.log`, der ikke
indeholder sin egen linje). `evidence/e2e-tree-diff.txt` viser, at en frisk
klon med kun denne pakkes `apply.sh` er byte-identisk med arbejdsklonen.
