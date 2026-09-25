# DKC-033 — Pilotforløb og readiness-kontrol

Kumulativ overlay oven på stak-tippet **DKC-065**. Lægges med
`./apply.sh <checkout>/00-core`.

- **Reviewets base:** `5f9fa73457d22583b9948611d5cc3afffec4ae38` (`5f9fa73`)
- **Undersøgt checkout:** `83ad91a963d8055f77c29fb4361455689df95acb` (`83ad91a`)
- **Forudsætningskæde:** `dkc-065/apply.sh` → `dkc-062/apply.sh` → … →
  `dkc-001/apply.sh`. DKC-033 afhænger formelt af **DKC-016, DKC-017, DKC-018,
  DKC-022, DKC-024..DKC-032, DKC-062 og DKC-065**; alle er verificeret i den
  anvendte stak (`evidence/prerequisites.txt`).
- **Miljø:** Node v22.22.1. Ingen levende serviceprofil, ingen 30-dages
  observation og ingen navngivet kundcaccept. De tre profiler, 18 scenarier,
  abuse-proberne, den afgrænsede belastningstest og readiness-aggregatoren er
  efterprøvet deterministisk mod den faktiske stak; den målte drift og den
  menneskelige accept er NOT RUN.

## Implementeret adfærd

1. **Tre virksomhedsprofiler** (`pilot/business-profiles.json`): SMV
   (`Solo Håndværk ApS`, 18 medarbejdere, `small-vps`), IT/service
   (`Team Viden A/S`, 120, `ha-cluster`) og enterprise
   (`Enterprise Nord A/S`, 900, `enterprise-dedicated`). Hver profil har
   syntetiske tenants, roller (menneske/tjeneste/agent), integrationer med
   ærlig tilgængelighed (`included`/`opt-in`/`unavailable`, fx dansk
   økonomimodul før DKC-035) og de seks kritiske arbejdsgange.
2. **18 kørebare pilotscenarier** (`pilot/pilot-scenarios.json`,
   `pilot/src/scenarios.mjs`). Hver profil gennemfører:
   - **login/offboarding** via `identity`-tenantkontekst og
     `feature-access`-offboarding af alle fem rettighedsklasser,
   - **dagligt arbejde** via `feature-access`-feltadgang og den
     `approvals`-bundne mutation,
   - **restore** via `backup`s krypterede backup og isolerede gendannelse med
     målt RPO/RTO,
   - **privacy-sag** via `privacy`s holdbare DSAR-sag, fan-out, sikrede eksport
     og indløsning,
   - **opgradering** via `installer`s signerede opdateringsplan og menneskelige
     godkendelse (den profilscopede del af release-låsen),
   - **exit** via `migration`s selvbeskrivende eksport der kan læses uden
     platformen.
3. **Readiness-aggregator** (`pilot/src/readiness.mjs`,
   `pilot/readiness-policy.json`). De krævede gates (`security`, `quality`,
   `recovery`, `human-assessment`) og de ekstra gates (`ha`, `cost`,
   `observation`) læser faktisk evidens:
   - `security` læser sikkerhedsvurderingens fail-closed gate (DKC-065) og de
     uafhængige vurderinger,
   - `quality` læser de kørebare scenarier og testmatricen,
   - `recovery` læser recovery-rapporten og restore-arbejdsgangene,
   - `human-assessment` læser uafhængige vurderinger og kundeaccept-registeret,
   - `ha` er kun aktiv for den erklærede HA-profil,
   - `cost` læser omkostningsrapporten (DKC-034),
   - `observation` læser 30-dages observationsregisteret.
   En manglende kilde giver `not-run`, en udestående `pending`, en fejlende
   arbejdsgang `failed`; `ready` kræver at hver aktiv, obligatorisk gate er
   `passed`.
4. **Abuse- og belastningsprober** (`pilot/src/scenarios.mjs`): en ændret eller
   omdirigeret godkendelse afvises af bindingen, krydskunde-kontekst og
   tenant-headere afvises, ubetroet indhold bliver ikke til en handling, og en
   afgrænset belastningstest kører 64 iterationer ved samtidighed 8 med nul fejl
   og nul omgåelser.
5. **Særskilte registre** (`pilot/observation.json`,
   `pilot/customer-acceptance.json`): 30-dages observationen og kundeaccepten er
   særskilt registrerede menneskelige begivenheder og udledes aldrig af en
   kørsel.
6. **Kontrakter og konformans.** Fire nye kontrakter (`pilot-business-profile`,
   `pilot-scenario`, `readiness-policy`, `pilot-readiness`) med eksempler og
   semantiske validatorer i `conformance/src/pilot.mjs`, wired ind i
   `validate-schemas.mjs` (afsnit 52). Nyt baseline-komponent `pilot-readiness`
   med checks `pilot-check/-test/-run/-report` og `integration-pilot-live`
   (NOT RUN). Nyt releasekrav `REQ-PILOT-001` og trussel `THREAT-PILOT-001`
   (matrixversion **1.44.0**). ADR **0075**.
7. **Rapport.** `make pilot-render` skriver den deterministiske rapport til
   `pilot/report/pilot-readiness-report.json` og
   `docs/pilot/readiness-report.md`; `make pilot-check` afviser en rapport ude af
   trit med kilden.

## Ændrede og nye filer

Se `evidence/deliverable-files.txt` (39 filer). Hovedgrupper:

- `pilot/` — 5 kanoniske datafiler, 6 nye kildemoduler, 2 testsuiter og rapporten.
- `contracts/` — 4 skemaer + 4 eksempler.
- `conformance/src/pilot.mjs`, `conformance/test/pilot-conformance.test.mjs`,
  `validate-schemas.mjs`, `schemas.mjs`.
- `docs/spec/pilot.md`, `docs/operations/pilot.md`, `docs/runbooks/pilot.md`,
  `docs/adr/0075-…`, `docs/adr/README.md`.
- `Makefile`, `tools/baseline/registry.mjs`,
  `release/matrix/{test-matrix,threats}.json`,
  `docs/testing/test-matrix.md`, `docs/security/threat-model.md`,
  `docs/status/implementation-matrix.md`.

## Testkommandoer og resultater

| Kommando | Resultat |
| --- | --- |
| `make install` | OK (conformance-afhængigheder) |
| `make pilot-check` | PASS (readiness `not-ready`, rapport i trit) |
| `make pilot-test` | PASS (16 pilot-tests + 10 konformanstests) |
| `make pilot-run` | PASS (3/3 profiler gennemfører alle seks arbejdsgange; 0 omgåelser; 0 fejl) |
| `make pilot-render` | PASS (2 rapportfiler skrevet) |
| `make pilot-report` | PASS (JSON på stdout) |
| `make validate` | PASS (10 pilotkontrakter valideret) |
| `make lint` | PASS (812 JSON-filer, 2102 filer) |
| `make release-check` | PASS (matrixversion 1.44.0, 67 krav, dokumenter i sync) |
| `make release-test` | PASS (32 tests) |
| `make test` | PASS (511 tests) |
| `make baseline` | 269 checks: 210 PASS, 1 kendt FAIL (`changelog-check`), 58 NOT RUN |

Den kendte fejl `changelog-check` (manglende DCO sign-off, inkl. `83ad91a`) er
**uændret** (`evidence/changelog-fail.txt`) og er ikke "rettet" for at opnå grøn
status. Baseline steg fra 264/206/1/57 til **269/210/1/58** (+4 PASS,
+1 NOT RUN).

## Acceptkriterier

| Kriterium | Status | Bevis |
| --- | --- | --- |
| Hver profil gennemfører alle kritiske workflows | PASS (deterministisk fixture) / NOT RUN (målt drift) | `pilot-run`, `pilot-test`, `pilot/report/pilot-readiness-report.json` (3/3 profiler `complete`); `integration-pilot-live` NOT RUN |
| Nul kendte åbne omgåelser af godkendelser eller kundeisolering | PASS | `runAbuseProbes` (0 violations), den afgrænsede belastningstest (0 bypasses), `pilot/test/scenarios.test.mjs` |
| 30 dages observation mod den valgte serviceprofil; HA-mål gælder kun en deklareret HA-profil | PASS (gate-semantik) / NOT RUN (observation) | `pilot/observation.json` `outstanding` 0/30; `ha`-gaten er `not-applicable` for SMV og aktiv for `ha-cluster`; `pilot/test/readiness.test.mjs` |
| RPO/RTO og omkostning er målt | PASS (deterministisk målt/modelleret) | Restore-scenarierne rapporterer `rpoMinutes`/`rtoMinutes` pr. profil; `monthlyCostEur` fra `metering/report/cost-report.json`; `cost`-gaten er `passed` |
| Kendte begrænsninger og kundens accept er dokumenteret | PASS (dokumenteret) / NOT RUN (accept) | `docs/spec/pilot.md`, `docs/operations/pilot.md`, `docs/runbooks/pilot.md`; `pilot/customer-acceptance.json` er tom → `human-assessment` og `observation` er `pending`, readiness `not-ready` |

## Kørebare arbejdsgange

Se `pilot/report/pilot-readiness-report.json` og
`docs/pilot/readiness-report.md`. Hver profil har seks arbejdsgange med status
`passed`; RPO/RTO og omkostning er gengivet pr. profil.

## Ærlige begrænsninger

- `measured: false`: der findes ingen levende serviceprofil i dette miljø.
  `integration-pilot-live` er NOT RUN med begrundelse.
- Den 30-dages observation er 0/30 dage, og kundeaccepregisteret er tomt.
  Readiness er derfor `not-ready` — det er den korrekte, ærlige tilstand, ikke
  en fejl.
- Sikkerheds- og `human-assessment`-gaterne er `pending`, fordi den uafhængige
  sikkerhedsvurdering (DKC-065) er udestående og kundeaccepten mangler.
- Opgraderingen bruger den profilscopede del af release-låsen (de komponenter
  profilen faktisk kører). Den fulde platformslås inkluderer valgfrie apps som
  `communications` (mattermost), der ikke er HA-egnet; den tvinges ikke ind i en
  HA-profil.
- Belastningstesten er en afgrænset, deterministisk kontrol af autorisation og
  godkendelsesbinding — ikke en målt produktionsbelastning.
- Baseline-reproducerbarhedsadvarslen (runtime-muterede `modules/*/conformance`)
  er den kendte mutation; fixtures blev gendannet fra en ren reference
  (`evidence/fixture-restore.log`).

## Review-identifikatorer

- Base: `5f9fa73457d22583b9948611d5cc3afffec4ae38`
- Checkout: `83ad91a963d8055f77c29fb4361455689df95acb`
- Overlay: `01-step1/output/dkc-033/` (denne pakke), lagt oven på
  `01-step1/output/dkc-065/apply.sh` og alle forudsætninger.
