# DKC-026 — Integrér filer og kontorsamarbejde (arbejdspladsmodul)

Kumulativ overlay oven på stak-tippet DKC-025. Lægges med
`./apply.sh <checkout>/00-core`.

- **Reviewets base:** `5f9fa73457d22583b9948611d5cc3afffec4ae38` (`5f9fa73`)
- **Undersøgt checkout:** `83ad91a963d8055f77c29fb4361455689df95acb` (`83ad91a`)
- **Forudsætningskæde:** `dkc-025/apply.sh` → `dkc-022/apply.sh` →
  `dkc-043/apply.sh` → … → `dkc-001/apply.sh`. DKC-026 afhænger formelt af
  **DKC-016** (backup og gendannelse), **DKC-021** (sletning, legal hold og
  gendannelsesregler), **DKC-023** (fælles adapterværktøjer) og **DKC-025**
  (portal og kundelivscyklus). Alle er verificeret i den anvendte stak:
  `backup/`, `retention/`, `adapter-sdk/` og `portal/`.
- **Miljø:** Node v22.22.1. Ingen rigtig Nextcloud, ingen WOPI-kontoredaktør, ingen
  browser. De statisk fuldt gennemførlige dele er implementeret og efterprøvet;
  den rigtige upstream-integration er NOT RUN.

## Implementeret adfærd

1. **Første brede arbejdspladsmodul** (`modules/nextcloud-adapter/`): adapteren
   wrapper Nextcloud uændret (filer, deling, kalender) og en kontoredaktør bag
   den fælles adapter-SDK (DKC-023). Auth, tenantudledning, fail-closed PDP,
   audit, idempotens, health og versionsforhandling genbruges 1:1.
2. **Én dokumenteret editionkombination**
   (`service/src/constants.mjs`): `nextcloud-hub-onlyoffice` frigiver alle fire
   delmoduler; `nextcloud-hub-collabora` frigiver fil/deling/kalender, men **ikke**
   editoren, fordi driftsprofilen mangler backup. `assessEditionCombination`
   frigiver hvert delmodul for sig.
3. **Default-deny delingsbeslutning** (`decideFileAccess`): ejer har altid
   adgang; en bruger- eller gruppedeling giver kun adgang med den nødvendige
   rettighedsbit; fremmed tenant og deaktiverede konti afvises. Beslutningen
   læses af både læsning, redigering og deling.
4. **Kundepolitik** for ekstern deling (`disabled`/`domain-restricted`/
   `allowed` + domæne-allowlist), offentlige links (adgangskode, udløb,
   maksimal levetid, uploadforbud), offboarding og sletning. Hver afvisning
   audits med en begrundelse.
5. **Identitetslivscyklus og eksterne gæster**: invitation, suspension (luk
   sessioner + deaktivér) og fjernelse (tilbagekald delinger + slet bruger).
6. **Offboarding**: lukker sessioner, tilbagekalder alle delinger ejet af
   subjektet og overfører eller sletter subjektets filer efter politik;
   kvitteringen indeholder tællere, ikke indhold.
7. **Privacy-verber**: locate og export er `full`; erase er `partial`
   (filer/delinger/sessioner slettes, men backups, versions-/papirkurvshistorik
   og søgeindeks kræver upstream-oprydning); legal hold er `unsupported`;
   retention.policy er `partial`.
8. **Ærlig backup/restore**: backup `partial`, restore/verify-restore
   `unsupported` — volume-adgang ligger uden for API'et.
9. **Kontrakter, konformans og drift**: kandidat + releaseprofil i
   `adapter-sdk/registry.json`, semantiske validatorer i
   `conformance/src/workspace.mjs`, Makefile-targets og baseline-checks,
   dataregisterpost, observability-regler, GitOps-manifester (dev), ADR-0055,
   spec/runbook/DPIA/SLO og 2 nye trusler (REQ-WORKSPACE-001, matrix 1.24.0).
10. **Én rettelse i den delte SDK** (`adapter-sdk/src/errors.mjs`):
    `classifyUpstreamError` bevarer nu en allerede klassificeret `AdapterError`,
    så en adapter kan svare 403/404/409 i stedet for at pakke den ind som en
    generisk 502.

## Ændrede filer

56 leverancefiler (34 nye, 22 ændrede, 0 slettede): se
`evidence/deliverable-files.txt`. De vigtigste:

- `modules/nextcloud-adapter/` — nyt modul: `module-manifest.json`,
  `service/package.json`, `service/src/{constants,nextcloud,mock-nextcloud,workspace,server,auth,evidence,cli,pdp-client}.mjs`,
  `service/test/{adapter,workspace}.test.mjs` og `conformance/` (bevis + events).
- `conformance/src/workspace.mjs`,
  `conformance/test/nextcloud-adapter-conformance.test.mjs`.
- `adapter-sdk/registry.json`, `adapter-sdk/src/errors.mjs`, og genereret
  `contracts/examples/{integration-candidate,upstream-release-profile}.nextcloud-adapter.example.json`
  + `docs/status/adapter-sdk.md`.
- `Makefile`, `tools/baseline/registry.mjs` (komponent `nextcloud-adapter` + 4
  checks), `release/matrix/{test-matrix,threats}.json` (REQ-WORKSPACE-001 + 2
  trusler, matrix 1.24.0).
- `containers/nextcloud-adapter/Dockerfile` + `containers/containers.json`, og
  regenereret `release/{sbom,artifacts}` + `docs/status/supply-chain.md`.
- `gitops/apps/nextcloud-adapter-application.json` +
  `gitops/manifests/dev/nextcloud-adapter-{deployment,service,serviceaccount}.json`,
  `infrastructure/src/{cli,plan}.mjs`, regenererede observability-regler.
- `compliance/data-register.json` + genereret `docs/compliance/data-register.md`.
- `release/sbom/platform-sbom.cdx.json`, `release/artifacts.json`,
  `docs/status/{supply-chain,implementation-matrix}.md`,
  `docs/testing/test-matrix.md`, `docs/security/threat-model.md`
  (regenereret pga. ny førstepartspakke og nye krav/trusler).
- Dokumentation: `docs/spec/nextcloud-adapter.md`,
  `docs/runbooks/workspace-collaboration.md`,
  `docs/adr/0055-arbejdspladsmodul-og-editionkombination.md`,
  `docs/dpia/nextcloud-adapter.md`, `docs/slo/nextcloud-adapter.md` samt
  opdaterede `docs/spec/README.md` og `docs/adr/README.md`.

## Testkommandoer og resultater

Kørt i den arbejdsklonede stak (stak-tip DKC-025 + DKC-026). Alle nedenstående
er PASS i `evidence/`-loggene:

| Kommando | Resultat | Log |
| --- | --- | --- |
| `make validate` | PASS (99 kontraktskemaer, 106 eksempler) | `evidence/validate.log` |
| `make lint` | PASS (567 JSON-filer) | `evidence/lint.log` |
| `make test` | PASS (298 tests) | `evidence/test.log` |
| `make nextcloud-adapter-test` | PASS (32 modul- + 7 konformanstests) | `evidence/nextcloud-adapter-test.log` |
| `make nextcloud-adapter-demo` | PASS (deling, redigering, tredje bruger afvist, offboarding, sletning) | `evidence/nextcloud-adapter-demo.log` |
| `make nextcloud-adapter-evidence` | PASS (3 full-verbums-beviser + partial) | `evidence/nextcloud-adapter-evidence.log` |
| `make adapter-sdk-check` / `-test` | PASS (3 adaptere; 44 tests) | `evidence/adapter-sdk-*.log` |
| `make adapter-test` / `iam-adapter-test` | PASS (uændret) | `evidence/*-adapter-test.log` |
| `make persistence-check` / `-test` | PASS (13 migrationer, 40 tenant-views) | `evidence/persistence-*.log` |
| `make release-check` / `-test` | PASS (47 krav, matrix 1.24.0) | `evidence/release-*.log` |
| `make supply-chain-check` | PASS (SBOM med 47 komponenter, 8 containere) | `evidence/supply-chain-check.log` |
| `make evidence-mode-check` | PASS | `evidence/evidence-mode-check.log` |
| `make data-register-check` | PASS (7 poster, 0 aktive blockere) | `evidence/data-register-check.log` |
| `make observability-check` | PASS (regler matcher modulets SLO) | `evidence/observability-check.log` |
| `make gitops-verify` / `infrastructure-verify` | PASS (9/9 i dev/staging/prod) | `evidence/gitops-verify.log`, `evidence/infrastructure-verify.log` |
| `make conform-all` / `conform-negative` | PASS / forventet FAIL | `evidence/conform-*.log` |
| `make baseline` | 136 PASS, 1 FAIL, 40 NOT RUN af 177 | `evidence/baseline.log`, `evidence/baseline-summary.txt` |

### E2E på en frisk klon med kun pakkens `apply.sh`

| Kommando | Resultat | Log |
| --- | --- | --- |
| `./dkc-026/apply.sh <clone>/00-core` | PASS | `evidence/e2e-apply.log` |
| `make install` | PASS | `evidence/e2e-install.log` |
| fokuseret kontrol (`validate`, `lint`, `nextcloud-adapter-test`, `nextcloud-adapter-demo`, `adapter-sdk-check`, `release-check`, `supply-chain-check`, `test`) | PASS | `evidence/e2e-check.log` |
| træ-diff mod arbejdsklonen | byte-identisk (0 forskelle) | `evidence/e2e-tree-diff.txt` |

### Baseline

`make baseline` giver **136 PASS, 1 FAIL, 0 error, 40 NOT RUN af 177 checks**.
Den ene FAIL er den kendte, forudgående **`changelog-check`**: commits i
checkoutet mangler DCO sign-off (også `83ad91a`). Den er ikke "rettet" eller
skjult. De fire nye checks (`nextcloud-adapter-test`, `-evidence`, `-demo` og
`integration-nextcloud`) er henholdsvis PASS og NOT RUN med en præcis
begrundelse. Baseline muterer som vanligt sporede filer under
`modules/*/conformance`; snapshottet (53 filer) blev gendannet bagefter, og
`diff -rq` viste ingen afvigelser.

## Acceptkriterier

| # | Kriterium | Resultat | Evidens |
| --- | --- | --- | --- |
| 1 | To brugere kan dele og redigere; en tredje uden adgang afvises | PASS | `service/test/adapter.test.mjs`, `service/test/workspace.test.mjs`, `make nextcloud-adapter-demo`; HTTP 403 `access_denied` |
| 2 | Offboarding lukker sessions og delinger efter politik | PASS | `service/test/workspace.test.mjs` (`closedSessions`, `revokedShares`, `transferredTo`), `make nextcloud-adapter-demo` |
| 3 | Officeformater fra pilotkunder testes og afvigelser registreres | PASS (mekanisme) | `officeFormatReport` + `conformance/test/nextcloud-adapter-conformance.test.mjs`; en faktisk WOPI-redigering er NOT RUN |
| 4 | Frigiv kun de delmoduler hvis licens, API og driftsprofil er valideret | PASS | `assessEditionCombination`, `conformance/src/workspace.mjs`; Collabora frigiver ikke editoren |
| — | Filer, deling, kalender og kontoredaktør via én dokumenteret editionkombination | PASS | `EDITION_COMBINATIONS`, releaseprofil, ADR-0055 |
| — | Ekstern gæst og offentligt link følger kundepolitikken | PASS | `publicLinkProblems`, `externalShareProblems`, `service/test/{workspace,adapter}.test.mjs` |
| — | Rigtig backup/restore, eksport og slettebegrænsninger | PASS (ærligt) | `backupDeclaration` (partial/unsupported), `subject.export` (full), `requestDeletion` med legal hold/retention; rigtig Nextcloud-restore er NOT RUN |
| — | Tenantgrænse, verificeret identitet og fail-closed PDP | PASS | `service/test/adapter.test.mjs` (401/403/503 uden deling), SDK-genbrug |

## Leverancer (formelle)

1. **Filer, deling, kalender og valgt kontoreditor via én dokumenteret
   editionkombination** — implementeret (`constants.mjs`, `nextcloud.mjs`,
   `workspace.mjs`, `server.mjs`).
2. **Identity lifecycle, eksterne gæster og offentlige delingslinks med
   kundepolitik** — implementeret (`inviteGuest`, `suspendGuest`, `removeGuest`,
   `createPublicLink`, `externalShareProblems`, `publicLinkProblems`).
3. **Rigtig backup/restore, eksport og slettebegrænsninger** — eksport er `full`;
   backup/restore er ærligt `partial`/`unsupported`; sletning blokereres af legal
   hold/retention og rapporterer resterende kopier.

## Grænser og resterende arbejde

- Der findes ingen rigtig Nextcloud-installation i dette miljø. Al adfærd er
  efterprøvet mod `mock-nextcloud.mjs` og den rigtige PDP; en levende upstream er
  registreret som `integration-nextcloud` (NOT RUN).
- Kontoredaktøren er kun valideret gennem editionkombinationens licens-, API- og
  driftsprofil. En faktisk WOPI-redigering mod ONLYOFFICE/Collabora er NOT RUN.
- Kandidaten er bevidst **ikke** godkendt (`candidate_not_approved`), fordi en
  testet gendannelse af Nextcloud mangler; releaseprofilens gate står som
  `blocked` i stedet for at pynte på den.
- `subject.erase` er `partial`: backups, versions-/papirkurvshistorik og
  søgeindeks kræver en upstream-oprydning (DKC-021).
- `changelog-check` forbliver den ene kendte FAIL (manglende DCO sign-off).

## Verifikation

Manifestet er selvkonsistent: alle hashes i `OVERLAY-MANIFEST.txt` er
verificeret med `sha256sum -c` (se `evidence/manifest-verify.log`, der ikke
indeholder sin egen linje). `evidence/e2e-tree-diff.txt` viser, at en frisk
klon med kun denne pakkes `apply.sh` er byte-identisk med arbejdsklonen.
