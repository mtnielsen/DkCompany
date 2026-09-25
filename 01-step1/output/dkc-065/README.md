# DKC-065 — Pentest-harness og assessment-gates (leverance)

Implementering af **DKC-065** for `mtnielsen/DkCompany`. `00-core/` i det
faktiske repo er fortsat **ikke ændret**; alt ligger under
`01-step1/output/dkc-065/`.

- **Reviewets base:** `5f9fa73457d22583b9948611d5cc3afffec4ae38` (`5f9fa73`)
- **Undersøgt checkout:** `83ad91a963d8055f77c29fb4361455689df95acb` (`83ad91a`)
- **Forudsætnings-overlays (stak-tip):** `dkc-062` → `dkc-061` → … → `dkc-001`
  (kædes af `apply.sh`, som først lægger `dkc-062/apply.sh`)
- **Miljø:** Node v22.22.1. Ingen uafhængig assessor, intet godkendt eksternt
  scope, ingen levende stagingklynge og ingen menneskelig releasebeslutning.

## Forudsætninger og valg

DKC-065 afhænger formelt af **DKC-062, DKC-064 og DKC-066**. Alle er verificeret
i kode, ikke i et statusfelt:

- `distribution/acceptance/*` og `conformance/src/acceptance.mjs` (DKC-062) giver
  den profilbevidste gate-model, RACI og den særskilt registrerede menneskelige
  ejeraccept, som assessment-gaten spejler.
- `vulnerability-management/*` og `conformance/src/vulnerability.mjs` (DKC-064)
  giver fundmodellen, artefaktbindingen og den menneskelige undtagelsesmodel,
  som fund/retest-importen genbruger.
- `telemetry-api/*` (DKC-066) giver den faktiske, autentificerede HTTP-grænse
  med tenant-scope, view-scope og redaktion, som den isolerede harness kører
  sine sonder mod. Desuden genbruges `agent-registry/src/handoff.mjs` (DKC-055),
  `host-management/src/broker.mjs` (DKC-058), `adapter-sdk/src/guards.mjs`
  (DKC-024), `storage/src/object-store.mjs` (DKC-041) og `runtime/src/injection.mjs`
  (DKC-012) som de rigtige sikkerhedsværn i harnessen.
- `release/matrix/*` og `release/src/{load,gate}.mjs` (DKC-063) giver den
  eksisterende release-gate og kontrakten for uafhængige vurderinger, som det
  nye krav `REQ-PENTEST-001` bygger på.

Opgaven er delvist miljøblokeret: den uafhængige assessor, et godkendt eksternt
scope og den menneskelige releasebeslutning findes ikke her. Valget var at
implementere hele engagementet, harnessen, dækningen, importen og gaten
**rigtigt** og efterprøve dem deterministisk, mens den faktiske uafhængige
vurdering registreres ærligt som **NOT RUN** og produktionsgaten forbliver
**udestående**.

## Implementeret adfærd

1. **Ny kontrakt** `contracts/rules-of-engagement.schema.json`
   (`RulesOfEngagement`): mål, identiteter, teknikker, tidsvindue, udelukkelser,
   rate limits, stopbetingelser, nødkontakter og evidenshåndtering. Semantik i
   `security-assessment/src/model.mjs`: et forberedt engagement
   (`preparationOnly: true`, `authorization.approved: false`) autoriserer **kun**
   et lokalt, syntetisk loopback-mål; et eksternt mål kræver en navngivet
   scope-godkendelse, og et produktionsmål er altid udelukket.
2. **Ny kontrakt** `contracts/security-assessment.schema.json`
   (`SecurityAssessment`): artefaktbinding (`targetCommit`, `artifactDigest`,
   `profileInventory`), de ni versionerede dækningskategorier, harness-kørsler,
   fund, retest, impact review, uafhængig vurdering, releasebeslutning og status.
3. **Semantiske validatorer** `conformance/src/pentest.mjs` (skema + beslutning)
   og `security-assessment/src/model.mjs` (engagement, dækning, fund/retest,
   uafhængighed, gate). Nye `SCHEMA_IDS` og afsnit **51** i
   `validate-schemas.mjs`.
4. **Isoleret regressionsharness** `security-assessment/src/harness.mjs`:
   starter den faktiske telemetri-API på loopback og kører **17
   ikke-destruktive sonder** mod de rigtige førstepartsværn — auth, direkte
   API'er, krydskundeadgang, injektion, agentrolle-/godkendelsesomgåelse,
   host-broker, connectors, telemetrilækage og immutable-omgåelse. En
   uautoriseret eller udløbet kørsel udfører ingen sonder.
5. **Fund/retest-import** `security-assessment/src/import.mjs`: normaliserer
   assessor-/scannerfund, **redigerer** secrets og persondata via den fælles
   `persistence/src/redact.mjs`, bevarer proveniens, binder det rettede artefakt
   og markerer et retest af et andet artefakt som `artifactChanged`.
6. **Produktionsgate** `security-assessment/src/model.mjs`
   (`evaluateAssessmentGate`): fail-closed. Blokerer ved ugyldigt engagement,
   udløbet scope, ændret commit/artefakt uden impact review, manglende eller
   fejlende dækningskategori, åbne blokerende fund (undtagen rettede,
   menneskeligt accepterede eller verificeret falsk positive), manglende frisk
   artefaktbundet uafhængig vurdering og manglende navngivet menneskelig
   godkendt releasebeslutning. Kun da bliver beslutningen `eligible`.
7. **Deterministisk, redigeret rapport**
   `security-assessment/report/security-assessment-report.json` +
   `docs/release/security-assessment.md`: `measured: false`, klassificeret
   `confidential`, adgangskontrolleret og uden rå evidens/secrets.
8. **Release-krav** `REQ-PENTEST-001` og trussel `THREAT-PENTEST-001`
   (matrixversion **1.43.0**, `evidenceKind: penetration-test`, boundary
   `external-sources`, `controlRefs: ra-5, si-4, au-9, cm-2`). Registreret som
   komponenten `security-assessment` med checkene
   `security-assessment-check/-test/-run/-report` og den ærligt eksterne
   `integration-pentest-independent` (NOT RUN).
9. **Dokumentation:** `docs/spec/security-assessment.md`,
   `docs/operations/security-assessment.md`,
   `docs/runbooks/security-assessment.md`,
   `docs/adr/0074-pentest-harness-og-assessment-gates.md`, opdateret
   `docs/adr/README.md`, samt de regenererede `docs/testing/test-matrix.md`,
   `docs/security/threat-model.md` og `docs/status/implementation-matrix.md`.

## Ændrede og nye filer

Se `deliverable/` (35 filer) og `OVERLAY-MANIFEST.txt`. Hovedpunkter:

- Kontrakter: `contracts/{rules-of-engagement,security-assessment}.schema.json`
  + to eksempler.
- Konformans: `conformance/src/pentest.mjs`,
  `conformance/test/pentest-conformance.test.mjs`, opdateret
  `conformance/src/{schemas,validate-schemas}.mjs`.
- Modul: `security-assessment/` (`rules-of-engagement.json`,
  `assessment.json`, `report/`, `src/` × 7, `test/` × 2, `fixtures/` × 2).
- Release: `release/matrix/{test-matrix,threats}.json`.
- Baseline/CI: `tools/baseline/registry.mjs`, `Makefile`.
- Docs: spec/operations/runbook/ADR + regenererede matrix-/trussels-/statusdokumenter.

## Testkommandoer og resultater

Alle kørt i den disposable arbejdskopi (`/tmp/dkc-065/00-core`) på commit
`83ad91a` med DKC-062-stakken lagt:

| Kommando | Resultat |
| --- | --- |
| `make validate` | PASS (4 sikkerhedsvurderingskontrakter valideret) |
| `make lint` | PASS (798 JSON-filer) |
| `make security-assessment-check` | PASS (9 kategorier, gate `blocked`) |
| `make security-assessment-test` | PASS (7 + 14 tests) |
| `make security-assessment-run` | PASS (17/17 sonder) |
| `make security-assessment-report` | PASS (deterministisk, redigeret rapport) |
| `make release-check` | PASS (66 krav, matrixversion 1.43.0) |
| `make release-test` | PASS |
| `make test` | PASS (501 tests) |
| `make baseline` | 264 checks: **206 PASS, 1 FAIL, 57 NOT RUN** |

Den ene FAIL er den **præeksisterende** `changelog-check` (manglende DCO
sign-off, bl.a. `83ad91a`), som ikke er "rettet" i denne opgave.

## Acceptance criteria

| Kriterium | Status | Evidens |
| --- | --- | --- |
| Forberedelse autoriserer ikke levende test; kræver godkendt scope | **PASS** | `preparationOnly`, `authorization.approved: false`, kun `local-loopback` autoriseret; `conformance/test/pentest-conformance.test.mjs`. |
| Scanner/AI-selvvurdering er ikke en uafhængig pentest | **PASS** | Gaten kræver navngivet menneske som assessor ≠ implementer; `measured: false`; `invalid-independent-assessment`-test. |
| Ingen første kundeproduktionsrelease uden uafhængig vurdering og løste blokkere | **PASS** | `evaluateAssessmentGate` er fail-closed; `eligible` kun med gyldig uafhængig vurdering + fuld dækning + ingen blokerende fund + menneskelig beslutning. |
| Uden assessor/scope: markér udestående og gate unsatisfied; lever forberedelsen | **PASS** | `security-assessment/assessment.json` er `outstanding`; gaten er `blocked`; `integration-pentest-independent` er NOT RUN. |
| Retest identificerer det rettede artefakt; ændringer kræver impact review | **PASS** | `fixedArtifactDigest`-binding; `impactReview`-krav; import-/gate-tests. |
| Rapporter adgangskontrollerede, redigerede og med proveniens; kode og vurdering af forskellige aktører | **PASS** | `accessControl`/`redactionRequired`; import redigerer secrets; assessor ≠ producer. |

## Coding deliverables

| Leverance | Status |
| --- | --- |
| RoE-skema + validator + isoleret harness | PASS |
| Fund/retest-import, artefaktbinding, dækning og produktionsgate | PASS |
| Fail-closed-tests (manglende autorisation, udløbet scope, ændret artefakt, manglende uafhængig vurdering) | PASS |

## Baselines

| | Total | PASS | FAIL | NOT RUN |
| --- | --- | --- | --- | --- |
| Før DKC-065 (DKC-062-tip) | 259 | 202 | 1 | 56 |
| Efter DKC-065 | 264 | 206 | 1 | 57 |

Tilvækst: +4 PASS (real/contract) og +1 NOT RUN (`integration-pentest-independent`).
SBOM er **uændret** (intet nyt `package.json`).

## Resterende begrænsninger

- **Den uafhængige vurdering er ikke udført.** Der findes ingen assessor, intet
  godkendt eksternt scope og ingen menneskelig releasebeslutning i dette miljø.
  `integration-pentest-independent` er NOT RUN, og produktionsgaten er
  `blocked`/`outstanding`. Dette er tilsigtet, jf. opgavens betingelser.
- Harnessen er en isoleret **loopback**-regression, ikke en levende
  penetrationstest; den erstatter ikke den uafhængige vurdering.
- Den præeksisterende `changelog-check`-FAIL (DCO sign-off) er ikke rettet.

## Review

- Base: `5f9fa73457d22583b9948611d5cc3afffec4ae38`
- Checkout + forudsætnings-overlays: `83ad91a963d8055f77c29fb4361455689df95acb`
  plus `dkc-062/apply.sh` (stak-tip) og denne overlay.
- Reproduktion:

  ```bash
  git clone --no-hardlinks /mnt/c/projects/DkCompany /tmp/dkc-065-check
  git -C /tmp/dkc-065-check checkout 83ad91a
  ./01-step1/output/dkc-065/apply.sh /tmp/dkc-065-check/00-core
  cd /tmp/dkc-065-check/00-core && make install
  make security-assessment-check && make security-assessment-test && make security-assessment-run
  make validate && make lint && make release-check && make test
  make baseline   # forventer 264 checks: 206 PASS, 1 kendt FAIL, 57 NOT RUN
  ```
