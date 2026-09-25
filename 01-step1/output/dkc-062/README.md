# DKC-062 — Installations- og releaseacceptance

Kumulativ overlay oven på stak-tippet **DKC-061**. Lægges med
`./apply.sh <checkout>/00-core`.

- **Reviewets base:** `5f9fa73457d22583b9948611d5cc3afffec4ae38` (`5f9fa73`)
- **Undersøgt checkout:** `83ad91a963d8055f77c29fb4361455689df95acb` (`83ad91a`)
- **Forudsætningskæde:** `dkc-061/apply.sh` → `dkc-059/apply.sh` →
  `dkc-031/apply.sh` → … → `dkc-001/apply.sh`. DKC-062 afhænger formelt af
  **DKC-022, DKC-054, DKC-055, DKC-057, DKC-060, DKC-061, DKC-064 og DKC-066**;
  alle er verificeret i den anvendte stak (`evidence/prerequisites.txt`).
- **Miljø:** Node v22.22.1. Ingen ren VPS/lokal server/HA-klynge, ingen levende
  konfiguration og ingen registreret menneskelig ejeraccept. Brugerrejserne og
  den profilbevidste acceptgate er efterprøvet deterministisk mod den faktiske
  stack; den målte installation og den menneskelige accept er NOT RUN.

## Implementeret adfærd

1. **Kørebare brugerrejser** (`distribution/acceptance/scenarios.json`,
   `distribution/src/acceptance-run.mjs`). 13 rejser på de understøttede
   profiler/platforme eksekveres deterministisk mod den faktiske installer-,
   livscyklus-, provider- og migrationstak:
   - ren installation på lokal server (`small-vps`) og VPS (`small-vps`, arm64),
   - afbrudt installation der genoptages idempotent,
   - udvidelse (`expand-add-hr`) og fjernelse der bevarer data,
   - konfiguration af den ene ønskede tilstand,
   - opgradering mellem signerede releases og recovery via snapshot-rollback,
   - provider-skift af database efter capability-preflight,
   - eskalation hvor et muterende trin afvises uden godkendelse og gennemføres
     godkendt,
   - exit-eksport der kan læses uden platformen,
   - HA-installation (`ha-cluster`) og enterprise med host management,
     immutable og self-healing aktiveret.
2. **Profilbevidst acceptgate** (`distribution/src/acceptance-gate.mjs`,
   `distribution/acceptance/gate-policy.json`). Fire **fælles gates**
   (`security`, `privacy`, `restore`, `role`) gælder altid. Fire **særskilte
   profilgates** aktiveres kun når profilen/kapabiliteten er valgt:
   `ha` (`profileType: multiple-servers`), `host-management`, `immutable` og
   `self-healing`. En aktiv gate kræver sine forudsætningskapabiliteter i koden,
   gyldigt og friskt testbevis og en registreret ejeraccept. Gaten afviser
   manglende, forældet, forkert-artefakt (`wrong-artifact`) og ikke-godkendt
   (`unapproved`) evidens. Single-server markeres non-HA, og fravalg af immutable
   ophæver ikke den obligatoriske auditbeskyttelse (den fælles sikkerhedsgate
   kræver fortsat `REQ-AUDIT-001`).
3. **RACI og maskinlæsbare udfald** (`distribution/acceptance/raci.json`,
   `distribution/acceptance/owner-acceptance.json`,
   `acceptance/report/acceptance-report.json`). RACI har et ansvarligt menneske,
   en stedfortræder, accountable, konsulterede og informerede pr. service,
   dataklasse og kontrolproces. Ejeraccept er en **særskilt registreret
   menneskelig begivenhed** i `owner-acceptance.json` (tom som standard): en
   grøn check giver derfor aldrig `accepted`.
4. **Kontrakter og konformans.** Fire nye kontrakter
   (`acceptance-scenario`, `acceptance-gate-policy`, `acceptance-result`,
   `raci-registry`) med eksempler og semantiske validatorer i
   `conformance/src/acceptance.mjs`, wired ind i `validate-schemas.mjs`
   (afsnit 50). Nyt baseline-komponent `installation-acceptance` med checks
   `acceptance-check/-test/-run/-report` og `integration-acceptance-live`
   (NOT RUN). Nyt releasekrav `REQ-ACCEPTANCE-001` og trussel
   `THREAT-ACCEPTANCE-001` (matrixversion **1.42.0**). ADR **0073**.
5. **Rapport.** `make acceptance-render` skriver den deterministiske rapport til
   `acceptance/report/acceptance-report.json` og `docs/pilot/acceptance-report.md`;
   `make acceptance-check` afviser en rapport ude af trit med kilden.
6. **Rolle-adskillelse.** `probeRoleSeparation` beviser i kørslen, at et
   multi-rolle-manifest, en in-place rolleændring, et aliasgenbrug, en subagent
   med samme identitet/rolle/model og en scheduler der samler alle credentials
   alle afvises (ingen brud).

## Ændrede og nye filer

Se `evidence/deliverable-files.txt` (38 filer). Hovedgrupper:

- `distribution/acceptance/` — 4 kanoniske datafiler.
- `distribution/src/` — 6 nye moduler (`acceptance-model`, `-gate`, `-run`,
  `-check`, `-cli`, `-report`).
- `distribution/test/` — 2 testsuiter.
- `contracts/` — 4 skemaer + 4 eksempler.
- `conformance/src/acceptance.mjs`,
  `conformance/test/acceptance-conformance.test.mjs`, `validate-schemas.mjs`,
  `schemas.mjs`.
- `acceptance/report/acceptance-report.json`,
  `docs/pilot/acceptance-report.md`.
- `docs/spec/installation-acceptance.md`, `docs/operations/installation-acceptance.md`,
  `docs/runbooks/installation-acceptance.md`, `docs/adr/0073-…`, `docs/adr/README.md`.
- `Makefile`, `tools/baseline/registry.mjs`, `release/matrix/{test-matrix,threats}.json`,
  `docs/testing/test-matrix.md`, `docs/security/threat-model.md`,
  `docs/status/implementation-matrix.md`.

## Testkommandoer og resultater

| Kommando | Resultat |
| --- | --- |
| `make install` | OK (conformance-afhængigheder) |
| `make acceptance-check` | PASS (13/13 rejser, 16 aktive gates, rapport i trit) |
| `make acceptance-test` | PASS (17 gate/rejse-tests + 14 konformanstests) |
| `make acceptance-run` | PASS (13/13 rejser) |
| `make acceptance-render` | PASS (rapport skrevet) |
| `make acceptance-report` | PASS (JSON på stdout) |
| `make validate` | PASS (8 acceptkontrakter) |
| `make lint` | PASS |
| `make release-check` | PASS (matrixversion 1.42.0, dokumenter i sync) |
| `make distribution-check` / `make distribution-test` | PASS |
| `make test` | PASS (487 tests) |
| `make baseline` | 259 checks: 202 PASS, 1 kendt FAIL (`changelog-check`), 56 NOT RUN |

Den kendte fejl `changelog-check` (manglende DCO sign-off, inkl. `83ad91a`) er
**uændret** og er ikke "rettet" for at opnå grøn status.

## Acceptkriterier

| Kriterium | Status | Bevis |
| --- | --- | --- |
| Ren installation, afbrudt installation og udvidelse består på VPS og lokal server | PASS (deterministisk fixture) / NOT RUN (målt drift) | `acceptance-check`, `acceptance-run`, `install-clean-*`, `install-interrupted-resumed`, `expand-add-hr`; `integration-acceptance-live` NOT RUN |
| Ingen agent kan udføre to roller, heller ikke via rotation, aliases eller subagents | PASS | `probeRoleSeparation`, `acceptance-test`, `conformance/test/acceptance-conformance.test.mjs` |
| Single-server markeres non-HA med accepteret nedetids-/recoveryprofil; øvrige sikkerhedsgates uændrede | PASS | `gate-policy.json` (`ha` `not-applicable`), `acceptance-gate.test.mjs`, sikkerhedsgaten kræver fortsat `REQ-AUDIT-001` |
| HA kræver DKC-038–043 og DKC-050–052; host management kræver DKC-058 | PASS (forudsætningskapabiliteter verificeret) | `acceptance-gate.mjs` (`requiresCapabilities`), `acceptance-gate.test.mjs`, `raci.json` |
| Self-healing kræver DKC-045–046 og uafhængig menneskelig recoveryøvelse | PASS (gate + forudsætninger) / NOT RUN (menneskelig øvelse) | `self-healing` gate, `integration-acceptance-live` NOT RUN |
| Immutableprofil kræver DKC-047–049 og bypass-tests; fravalg ophæver ikke auditbeskyttelse | PASS | `immutable` gate, `acceptance-gate.test.mjs` (audit-bevarings-test) |
| Hver aktiv gate har aktuelt testbevis og menneskelig ejeraccept | PASS (testbevis) / NOT RUN (menneskelig accept) | `acceptance/report/acceptance-report.json`: alle aktive gates `unapproved`/`pending-owner-acceptance` indtil `owner-acceptance.json` udfyldes |

## Kørebare brugerrejser

Se `acceptance/report/acceptance-report.json` og
`docs/pilot/acceptance-report.md` for den fulde liste. Rejserne dækker
installation, konfiguration, tilføj/fjern, opgradering, provider-skift,
eskalation, recovery og exit.

## Ærlige begrænsninger

- `measured: false`: der findes ingen ren VPS/lokal server/HA-klynge i dette
  miljø. `integration-acceptance-live` er NOT RUN med begrundelse.
- Den menneskelige ejeraccept er **ikke** givet. Den committede
  `owner-acceptance.json` er tom, så hver aktiv gate er `unapproved` og
  beslutningen er `pending-owner-acceptance`. Det er den korrekte, ærlige
  tilstand — ikke en fejl.
- Den deterministiske rapport bruger den kørende acceptsuites evidens (ikke en
  målt baseline); release-gaten (DKC-063) bruger den faktiske baseline.
- Provider-skift, opgradering og exit er efterprøvet mod committede fixtures og
  den faktiske kode — ikke mod levende providere eller kundedata.

## Review-identifikatorer

- Base: `5f9fa73457d22583b9948611d5cc3afffec4ae38`
- Checkout: `83ad91a963d8055f77c29fb4361455689df95acb`
- Overlay: `01-step1/output/dkc-062/` (denne pakke), lagt oven på
  `01-step1/output/dkc-061/apply.sh` og alle forudsætninger.
