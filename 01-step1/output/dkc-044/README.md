# DKC-044 — Etabler sammenhængende ITSM med menneskelige ejere (leverance)

Kumulativ overlay oven på stak-tippet DKC-026. Lægges med
`./apply.sh <checkout>/00-core`.

- **Reviewets base:** `5f9fa73457d22583b9948611d5cc3afffec4ae38` (`5f9fa73`)
- **Undersøgt checkout:** `83ad91a963d8055f77c29fb4361455689df95acb` (`83ad91a`)
- **Forudsætningskæde:** `dkc-026/apply.sh` → `dkc-025/apply.sh` →
  `dkc-022/apply.sh` → … → `dkc-001/apply.sh`. DKC-044 afhænger formelt af
  **DKC-017** (overvågning og hændelseshåndtering), **DKC-025** (portal og
  kundelivscyklus) og **DKC-037** (serviceklasser og recoverymål). Alle er
  verificeret i den anvendte stak: `observability/`, `portal/` og `continuity/`.
- **Miljø:** Node v22.22.1. Ingen rigtig GLPI-installation. De statisk fuldt
  gennemførlige dele er implementeret og efterprøvet; den rigtige
  upstream-integration er NOT RUN.

## Implementeret adfærd

1. **Nyt ITSM-modul** (`modules/itsm-adapter/`): adapteren wrapper GLPI uændret
   og oversætter platformens serviceproces (alarmer, incidents, major
   incidents, requests, problemer, kendte fejl, changes, CI-relationer og
   vidensartikler) bag den fælles adapter-SDK (DKC-023). Auth,
   tenantudledning, fail-closed PDP, audit, idempotens, health og
   versionsforhandling genbruges 1:1.
2. **Autoritativt servicekatalog og on-call** (`service-registry/`):
   `services.json` giver hver tjeneste et navngivet menneske som ejer, en
   on-call-rotation, en kommunikationskanal uden for platformen, en runbook, en
   fuld SLA (sev1–sev4), en OLA, CI-relationer og vidensartikler.
   `oncall.json` giver primær/sekundær/manager og en strengt stigende
   eskalationskæde. En AI er aldrig vagthavende eller eskalationspunkt.
3. **Én alarm → én incident** (`correlateAlarm`): idempotent pr. `alertId`, og
   to alarmer med samme `serviceId` + `ruleId` + `signal` lægges på samme åbne
   incident. Incidenten får den vagthavende som ejer og de **transitive**
   berørte tjenester. En `sev1`-alarm giver en major incident.
4. **Menneskelig kvittering, eskalation og stop** (`acknowledgementState`,
   `riskyActionAllowed`): fristen kommer fra SLA'ens svartid. Manglende
   kvittering peger på næste menneske i eskalationskæden og **stopper
   risikofyldt handling**, indtil et menneske har kvitteret.
5. **Problem og kendt fejl med menneskelig validering** (`problemCandidate`,
   `createProblem`): gentagne incidents (≥ 3) foreslås som et problem, men
   oprettes kun efter en navngiven menneskelig validering; en AI afvises.
6. **Change kobler kæden sammen** (`createChange`): incident, tjeneste, runbook,
   godkendelse og audit-ID. Et change uden runbook, menneskelig godkendelse
   eller incidentkobling afvises.
7. **Major incident-beskyttelse** (`majorIncidentCloseProblems`): en AI kan ikke
   lukke en major incident, heller ikke på et grønt healthcheck. Lukning kræver
   menneskelig kvittering og en navngiven menneskelig godkendelse.
8. **Enkeltroller i serviceprocessen** (`serviceProcessProblems`): en proces må
   bruge flere agenter, men en agent med flere roller, en rolle der ikke matcher
   agentens manifest, eller en forbudt AI-rolle (ejer/godkender/on-call)
   afvises.
9. **Kundevisning er default-deny** (`customerCases`): kunden ser kun egne
   sager; ejeridentitet, interne felter og AI-handlinger er skjult, med mindre
   politikken eksplicit tillader dem.
10. **Én dokumenteret editionkombination** (`assessEditionCombination`):
    `glpi-network` frigiver alle delmoduler (inkl. SLA/OLA);
    `glpi-community` frigiver alle undtagen SLA. Et delmodul frigives kun, hvis
    licens, REST-API og driftsprofil er valideret.
11. **Kontrakter, konformans og drift**: 3 nye kontrakter
    (`service-catalog`, `on-call-rotation`, `itsm-record`) med eksempler,
    semantiske validatorer i `conformance/src/itsm.mjs`, Makefile-targets og
    baseline-checks, dataregisterpost, observability-regler, serviceklasse,
    GitOps-manifester (dev), ADR-0056, spec/runbook/DPIA/SLO og
    2 nye trusler (REQ-ITSM-001, matrix 1.25.0).

## Ændrede filer

68 leverancefiler (46 nye, 22 ændrede, 0 slettede): se
`evidence/deliverable-files.txt`. De vigtigste:

- `modules/itsm-adapter/` — nyt modul: `module-manifest.json`,
  `service/package.json`,
  `service/src/{constants,itsm,mock-itsm,serviceregistry,server,auth,pdp-client,evidence,cli}.mjs`,
  `service/test/{adapter,serviceregistry}.test.mjs` og `conformance/` (bevis +
  events).
- `service-registry/` — `services.json`, `oncall.json`, `src/catalog.mjs`,
  `test/catalog.test.mjs`, `README.md`.
- `conformance/src/itsm.mjs`, `conformance/test/itsm-conformance.test.mjs`,
  `conformance/src/schemas.mjs`, `conformance/src/validate-schemas.mjs`.
- `contracts/{service-catalog,on-call-rotation,itsm-record}.schema.json` +
  4 eksempler, `adapter-sdk/registry.json` og genereret
  `contracts/examples/upstream-release-profile.itsm-adapter.example.json` +
  `docs/status/adapter-sdk.md`.
- `Makefile`, `tools/baseline/registry.mjs` (komponent `itsm-adapter` + 4
  checks), `release/matrix/{test-matrix,threats}.json` (REQ-ITSM-001 + 2
  trusler, matrix 1.25.0).
- `containers/itsm-adapter/Dockerfile` + `containers/containers.json`, og
  regenereret `release/{sbom,artifacts}` + `docs/status/supply-chain.md`.
- `gitops/apps/itsm-adapter-application.json` +
  `gitops/manifests/dev/itsm-adapter-{deployment,service,serviceaccount}.json`,
  `infrastructure/src/{cli,plan}.mjs`, regenererede observability-regler.
- `continuity/service-classes/itsm-adapter.service-class.json`.
- `compliance/data-register.json` + genereret `docs/compliance/data-register.md`.
- `release/sbom/platform-sbom.cdx.json`, `release/artifacts.json`,
  `docs/status/{supply-chain,implementation-matrix}.md`,
  `docs/testing/test-matrix.md`, `docs/security/threat-model.md`
  (regenereret pga. ny førstepartspakke og nye krav/trusler).
- Dokumentation: `docs/spec/itsm.md`,
  `docs/runbooks/itsm-incident-response.md`,
  `docs/adr/0056-itsm-og-menneskelige-ejere.md`,
  `docs/dpia/itsm-adapter.md`, `docs/slo/itsm-adapter.md` samt opdaterede
  `docs/spec/README.md` og `docs/adr/README.md`.

## Testkommandoer og resultater

Kørt i den arbejdsklonede stak (stak-tip DKC-026 + DKC-044). Alle nedenstående
er PASS i `evidence/`-loggene:

| Kommando | Resultat | Log |
| --- | --- | --- |
| `make validate` | PASS (102 kontraktskemaer, 111 eksempler) | `evidence/validate.log` |
| `make lint` | PASS (590 JSON-filer) | `evidence/lint.log` |
| `make test` | PASS (312 tests) | `evidence/test.log` |
| `make itsm-adapter-test` | PASS (25 modul- + 14 konformans- + 6 katalogtests) | `evidence/itsm-adapter-test.log` |
| `make itsm-adapter-demo` | PASS (alarm→incident, kvittering, AI-lukning nægtet, change, problem, kundevisning) | `evidence/itsm-adapter-demo.log` |
| `make itsm-adapter-evidence` | PASS (3 beviser + partial-erkendelse) | `evidence/itsm-adapter-evidence.log` |
| `make adapter-sdk-check` / `-test` | PASS (4 adaptere; 44 tests) | `evidence/adapter-sdk-*.log` |
| `make adapter-test` / `iam-adapter-test` / `nextcloud-adapter-test` | PASS (uændret) | `evidence/*-adapter-test.log` |
| `make continuity-check` / `-test` | PASS (6 serviceklasser) | `evidence/continuity-*.log` |
| `make release-check` / `-test` | PASS (48 krav, matrix 1.25.0) | `evidence/release-*.log` |
| `make supply-chain-check` | PASS (SBOM med 48 komponenter) | `evidence/supply-chain-check.log` |
| `make evidence-mode-check` | PASS | `evidence/evidence-mode-check.log` |
| `make data-register-check` | PASS (8 poster, 0 aktive blockere) | `evidence/data-register-check.log` |
| `make observability-check` | PASS (regler matcher modulets SLO) | `evidence/observability-check.log` |
| `make gitops-verify` / `infrastructure-verify` | PASS (9/9 i dev/staging/prod) | `evidence/gitops-verify.log`, `evidence/infrastructure-verify.log` |
| `make conform-all` / `conform-negative` | PASS / forventet FAIL | `evidence/conform-*.log` |
| `make baseline` | 139 PASS, 1 FAIL, 41 NOT RUN af 181 | `evidence/baseline.log`, `evidence/baseline-summary.txt` |
| `make ci` | alt PASS indtil den kendte `changelog-check` | `evidence/ci.log` |

### E2E på en frisk klon med kun pakkens `apply.sh`

| Kommando | Resultat | Log |
| --- | --- | --- |
| `./dkc-044/apply.sh <clone>/00-core` | PASS | `evidence/e2e-apply.log` |
| `make install` | PASS | `evidence/e2e-install.log` |
| fokuseret kontrol (`validate`, `lint`, `itsm-adapter-test`, `itsm-adapter-demo`, `adapter-sdk-check`, `release-check`, `supply-chain-check`, `test`) | PASS | `evidence/e2e-check.log` |
| træ-diff mod arbejdsklonen | byte-identisk (0 forskelle) | `evidence/e2e-tree-diff.txt` |

### Baseline

`make baseline` giver **139 PASS, 1 FAIL, 0 error, 41 NOT RUN af 181 checks**.
Den ene FAIL er den kendte, forudgående **`changelog-check`**: commits i
checkoutet mangler DCO sign-off (også `83ad91a`). Den er ikke "rettet" eller
skjult. De fire nye checks (`itsm-adapter-test`, `-evidence`, `-demo` og
`integration-glpi`) er henholdsvis PASS og NOT RUN med en præcis begrundelse.
Baseline muterer som vanligt sporede filer under `modules/*/conformance`;
snapshottet (59 filer) blev gendannet bagefter, og `diff -rq` viste ingen
afvigelser.

## Acceptkriterier

| # | Kriterium | Resultat | Evidens |
| --- | --- | --- | --- |
| 1 | En alarm bliver én korreleret incident med ejer og berørte tjenester | PASS | `correlateAlarm`, `service/test/{serviceregistry,adapter}.test.mjs`, `conformance/test/itsm-conformance.test.mjs`, `make itsm-adapter-demo` |
| 2 | Manglende menneskelig kvittering eskalerer til næste menneske og stopper risikofyldt handling | PASS | `acknowledgementState`, `riskyActionAllowed`, `escalationTarget`; tests + `make itsm-adapter-demo` |
| 3 | Gentagne incidents kan oprette problem og kendt fejl med menneskelig validering | PASS | `problemCandidate`, `problemProblems`, `createProblem`; en AI afvises med `human_required` |
| 4 | Kunde ser kun egne sager og status | PASS | `customerCases`/`customerView` (default-deny, tenantfiltrering, skjult ejer/AI-handlinger); HTTP-test |
| 5 | AI må ikke lukke en major incident alene på baggrund af et grønt healthcheck | PASS | `majorIncidentCloseProblems`; HTTP 409 `close_denied` for agent |
| — | En serviceproces må bruge flere agenter, men aldrig én agent med flere roller | PASS | `serviceProcessProblems`, `conformance/test/itsm-conformance.test.mjs`, `POST /v1/itsm/processes/validate` |
| — | Én dokumenteret editionkombination; delmodul frigives kun ved valideret licens/API/drift | PASS | `assessEditionCombination`, `EDITION_COMBINATIONS`; Community frigiver ikke SLA |
| — | Default-deny, verificeret identitet, tenantgrænse og fail-closed PDP | PASS | `service/test/adapter.test.mjs` (401/403/503 uden sag), SDK-genbrug |

## Leverancer (formelle)

1. **Vælg ITSM-kandidat og verificér edition/API; genbrug support og CMDB** —
   kandidat + releaseprofil i `adapter-sdk/registry.json`, ADR-0056.
2. **Servicekatalog, requests, incident/major incident, problem/known error,
   CI-relationer og vidensartikler** — implementeret (`service-registry/`,
   `serviceregistry.mjs`, `itsm.mjs`).
3. **Severity, menneskelig on-call, eskalationskæde, kvitteringsfrister, SLA/OLA
   og kommunikationskanal uden for platformen** — implementeret
   (`oncall.json`, `acknowledgementState`, `escalationTarget`).
4. **Forbind hændelse, service, change, runbook, approval og audit-ID** —
   implementeret (`createChange`, `links`).
5. **AI-arbejde fordeles mellem særskilte single-role identiteter** —
   implementeret (`serviceProcessProblems`, DKC-055-rollerne).

## Grænser og resterende arbejde

- Der findes ingen rigtig GLPI-installation i dette miljø. Al adfærd er
  efterprøvet mod `mock-itsm.mjs` og den rigtige PDP; en levende upstream er
  registreret som `integration-glpi` (NOT RUN).
- Kandidaten er bevidst **ikke** godkendt (`candidate_not_approved`), fordi en
  testet gendannelse af GLPI mangler; releaseprofilens gate står som `blocked`.
- `subject.locate`/`subject.export`/`subject.erase` er `partial` (subjektreferencer
  i GLPI er ikke en verificeret subjektnøgle; audit/backup kræver en godkendt
  sletteproces), og `subject.legal_hold` er `unsupported`.
- `backup` er `partial` og `restore`/`verify-restore` `unsupported`.
- PDP-bundlen har endnu ingen signerede regler for de nye `itsm.*`-verber;
  de er gatede og fail-closed, og en policyændring er en særskilt menneskelig
  beslutning.
- `changelog-check` forbliver den ene kendte FAIL (manglende DCO sign-off).

## Verifikation

Manifestet er selvkonsistent: alle hashes i `OVERLAY-MANIFEST.txt` er
verificeret med `sha256sum -c` (se `evidence/manifest-verify.log`, der ikke
indeholder sin egen linje). `evidence/e2e-tree-diff.txt` viser, at en frisk
klon med kun denne pakkes `apply.sh` er byte-identisk med arbejdsklonen.
