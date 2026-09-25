# DKC-050 — Bevis vandret skalering og kapacitet under fejl

Kumulativ overlay oven på stak-tippet DKC-027. Lægges med
`./apply.sh <checkout>/00-core`.

- **Reviewets base:** `5f9fa73457d22583b9948611d5cc3afffec4ae38` (`5f9fa73`)
- **Undersøgt checkout:** `83ad91a963d8055f77c29fb4361455689df95acb` (`83ad91a`)
- **Forudsætningskæde:** `dkc-027/apply.sh` → `dkc-058/apply.sh` →
  `dkc-054/apply.sh` → … → `dkc-001/apply.sh`. DKC-050 afhænger formelt af
  **DKC-012** (modelgateway og budgetter), **DKC-026** (filer og
  kontorsamarbejde), **DKC-027** (projektstyring), **DKC-038** (HA-klynge),
  **DKC-039** (database-HA), **DKC-040** (beskeder og jobkø) og **DKC-041**
  (holdbart fil- og objektlager). Alle er verificeret i den anvendte stak
  (`gateway/`, `modules/nextcloud-adapter/`, `modules/openproject-adapter/`,
  `infrastructure/ha-plan.json`, `persistence/ha-plan.json`,
  `jobs/messaging.json`, `storage/storage-plan.json`; se
  `evidence/prerequisites.txt`).
- **Miljø:** Node v22.22.1. Ingen levende klynge, lastgenerator, rigtige hosts,
  Docker, kubectl eller PostgreSQL. Modellen er deterministisk og bærer
  `measured: false`; en faktisk lasttest er NOT RUN og beskrevet i
  `docs/capacity/live-load-test.md`.

## Implementeret adfærd

1. **Reproducerbar lastprofil for tre kundestørrelser**
   (`performance/capacity-plan.json`): lille, mellemstor og stor kunde med
   samtidige brugere, requests/s, jobs/s, filer/dag, datamængde og AI-kald/dag.
   Den mellemstore profil er baseline for N+1.
2. **Deterministisk kapacitetsprojektion** (`performance/src/projection.mjs`):
   hvert workload har en målbar kapacitet pr. replika og en latens ved lav
   belastning. Belastningen oversættes til en utilisation, og latensen vokser
   efter en kømodel (`1 / (1 - u)`), så en flaskehals bliver synlig. Rapporten
   viser throughput, p95/p99, fejlrate, køalder, replikeringslag, pris pr.
   måned og flaskehals ved 1x/2x/5x for alle tre profiler.
3. **N+1 efter hosttab** (`buildCapacityReport`): tab af én host på de tre
   hosts måles for baselineprofilen, med fejlrate og throughput efter tab.
4. **Autoskalering** (`performance/src/autoscale.mjs`): stateless tjenester
   skalerer efter CPU-utilisering og køworkers efter kødybde, inden for en fast
   replikaramme og med cooldowns. Stateful workloads autoskalerer **aldrig**;
   de kræver den signerede runbook `stateful-scaling@1.0.0`. En app uden
   multi-active-support vinder intet ved at øge replikatællingen.
5. **Tenantkvoter, fairness og connection pools**
   (`performance/src/quota.mjs`, `performance/src/pool.mjs`): en vægtet kø
   (`weighted-fair-queue`) med en reserveret mindsteandel og et hårdt loft pr.
   tenant (`maxSharePercent`), så en støjende tenant ikke kan forbruge alle
   ressourcer. Pools reserverer admin-forbindelser og afviser overtegnede
   forbindelser kontrolleret.
6. **Backpressure og kontrolleret afvisning**: ved `queueDepthCritical` pauses
   udgivere, og nye forespørgsler afvises med `429`/`503` og en retry-vejledning.
   En kvittering gives først efter holdbar skrivning (`durableBeforeAck`), så et
   kvitteret stykke arbejde ikke går tabt. Backpressure stemmer med
   beskedtopologien i `jobs/messaging.json` (DKC-040).
7. **Enhedspris** (`performance/src/cost.mjs`): pris pr. request, job, AI-kald,
   GB og vCPU-time, og pris pr. måned før/efter skalering.
8. **Kontrakter, konformans og drift**: skemaet
   `contracts/capacity-plan.schema.json` + eksempel, semantiske validatorer i
   `conformance/src/performance.mjs`, Makefile-targets, baseline-checks
   (komponent `performance-capacity`), genererede autoscaler-/kvote-/PDB-
   manifester i `gitops/manifests/performance/`, observability-sensor og to
   alarmregler, signeret runbook + katalogpost, ADR-0062, spec/rapport/runbook
   og 2 nye trusler (REQ-CAPACITY-001, matrix 1.31.0).

## Ændrede filer

48 leverancefiler (31 nye, 17 ændrede, 0 slettede): se
`evidence/deliverable-files.txt`. De vigtigste:

- `performance/` — nyt modul: `capacity-plan.json`, `package.json`,
  `src/{model,projection,quota,autoscale,pool,cost,render,check,cli}.mjs`,
  `test/{projection,quota,autoscale,model}.test.mjs` og
  `report/capacity-report.json`.
- `contracts/capacity-plan.schema.json` + `contracts/examples/capacity-plan.example.json`,
  `conformance/src/performance.mjs`,
  `conformance/test/performance-conformance.test.mjs`,
  `conformance/src/{schemas.mjs,validate-schemas.mjs}`.
- `Makefile`, `tools/baseline/registry.mjs` (komponent `performance-capacity` + 5
  checks), `release/matrix/{test-matrix,threats}.json` (REQ-CAPACITY-001 + 2
  trusler, matrix 1.31.0).
- `gitops/manifests/performance/{autoscale-*,tenant-quota,pod-disruption-budget}.json`,
  `docs/capacity/{scaling-report,live-load-test}.md`,
  `docs/spec/performance.md`,
  `docs/runbooks/stateful-scaling.md`,
  `runbooks/stateful-scaling.runbook.json` + `runbooks/registry.json`,
  `docs/adr/0062-kapacitetsbevis-og-vandret-skalering.md`.
- `observability/{sensors,alert-rules}.json` (capacity-saturation + to regler).
- `docs/spec/README.md`, `docs/adr/README.md`, `docs/status/implementation-matrix.md`,
  `docs/testing/test-matrix.md`, `docs/security/threat-model.md` (regenereret
  pga. nye krav/trusler og den nye førstepartspakke), `docs/status/supply-chain.md`,
  `release/{sbom/platform-sbom.cdx.json,artifacts.json}` (regenereret pga. ny
  `package.json`).

## Testkommandoer og resultater

Kørt i den arbejdsklonede stak (stak-tip DKC-027 + DKC-050). Alle nedenstående
er PASS i `evidence/`-loggene:

| Kommando | Resultat | Log |
| --- | --- | --- |
| `make validate` | PASS (116 kontraktskemaer, 127 eksempler) | `evidence/validate.log` |
| `make lint` | PASS (658 JSON-filer) | `evidence/lint.log` |
| `make performance-render` / `-check` | PASS (plan, semantik, manifester, HA- og beskedkrydsvalidering) | `evidence/performance-*.log` |
| `make performance-test` | PASS (30 modul- + 5 konformanstests) | `evidence/performance-test.log` |
| `make performance-drill` | PASS (11/11 deterministiske checks) | `evidence/performance-drill.log` |
| `make monitoring-check` | PASS (8 sensorer, 7 regler) | `evidence/monitoring-check.log` |
| `make runbook-check` | PASS (7 verifikationsdigests) | `evidence/runbook-check.log` |
| `make remediation-check` | PASS (2 signerede selvreparations-runbooks) | `evidence/remediation-check.log` |
| `make release-check` / `-test` | PASS (54 krav, matrix 1.31.0; 27+5 tests) | `evidence/release-*.log` |
| `make supply-chain-check` | PASS (SBOM regenereret) | `evidence/supply-chain-check.log` |
| `make observability-check` | PASS | `evidence/observability-check.log` |
| `make data-register-check` | PASS (9 poster, 0 aktive blockere) | `evidence/data-register-check.log` |
| `make gitops-verify` / `infrastructure-verify` | PASS (9/9 i dev/staging/prod) | `evidence/gitops-verify.log`, `evidence/infrastructure-verify.log` |
| `make test` | PASS (377 tests) | `evidence/test.log` |
| `make conform-all` / `conform-negative` | PASS / forventet FAIL | `evidence/conform-*.log` |
| `make baseline` | 158 PASS, 1 FAIL, 45 NOT RUN af 204 | `evidence/baseline.log`, `evidence/baseline-summary.txt` |

### E2E på en frisk klon med kun pakkens `apply.sh`

| Kommando | Resultat | Log |
| --- | --- | --- |
| `./dkc-050/apply.sh <clone>/00-core` | PASS | `evidence/e2e-apply.log` |
| `make install` | PASS | `evidence/e2e-install.log` |
| fokuseret kontrol (`validate`, `lint`, `performance-render/-check/-test/-drill`, `monitoring-check`, `runbook-check`, `remediation-check`, `release-check/-test`, `supply-chain-check`, `observability-check`, `data-register-check`, `gitops-verify`, `infrastructure-verify`, `test`) | PASS | `evidence/e2e-check.log` |
| træ-diff mod arbejdsklonen | byte-identisk (0 forskelle) | `evidence/e2e-tree-diff.txt` |

### Baseline

`make baseline` giver **158 PASS, 1 FAIL, 0 error, 45 NOT RUN af 204 checks**.
Den ene FAIL er den kendte, forudgående **`changelog-check`**: commits i
checkoutet mangler DCO sign-off (også `83ad91a`). Den er ikke "rettet" eller
skjult. De fem nye checks (`performance-check`, `performance-test`,
`performance-drill`, `performance-render` og `integration-live-load-test`) er
henholdsvis PASS og NOT RUN med en præcis begrundelse. Baseline muterer som
vanligt sporede filer under `modules/*/conformance`; snapshottet (65 filer) blev
gendannet bagefter, og `diff -rq` viste ingen afvigelser.

## Acceptkriterier

| # | Kriterium | Resultat | Evidens |
| --- | --- | --- | --- |
| 1 | Rapportér throughput, p95/p99, fejlrate, køalder, replikeringslag og pris før/efter skalering | PASS (model) / NOT RUN (levende måling) | `docs/capacity/scaling-report.md`, `performance/src/projection.mjs`, `evidence/performance-drill.log` |
| 2 | En noisy tenant kan ikke forbruge alle ressourcer | PASS | `performance/src/quota.mjs`, `performance/test/quota.test.mjs`, `evidence/performance-drill.log` |
| 3 | N+1-kapacitet er målt efter hosttab | PASS (model) / NOT RUN (levende måling) | `buildCapacityReport().nPlusOne`, `docs/capacity/scaling-report.md` |
| 4 | App uden multi-active-support skaleres ikke ved blot at øge replicas | PASS | `performance/src/projection.mjs` (`effectiveCapacity`), `performance/test/projection.test.mjs` |
| 5 | Overskredet kapacitet afvises kontrolleret frem for at miste kvitterede data | PASS | `performance/src/quota.mjs` (`simulateDurableQueue`), `performance/test/quota.test.mjs` |

Kriterium 1 og 3 er **PASS for den deterministiske model** (som er hvad der kan
bevises uden en klynge). Selve den **levende** lasttest og måling af
replikeringslag på rigtige hosts er **NOT RUN** (ingen infrastruktur i dette
miljø) og kræver en ekstern evidenspost.

## Ærlige begrænsninger

- Modellen er `measured: false`. Den er deterministisk og efterprøvet mod den
  rigtige HA-plan og beskedtopologi, men den erstatter ikke en målt lasttest.
- Den levende lasttest (`make performance-live`) afviser med en begrundelse og
  er NOT RUN.
- De genererede autoscaler-/kvote-/PDB-manifester er ikke appliceret på en
  klynge; de er statisk kontrolleret.
- `release-check`'s uafhængige vurdering for REQ-CAPACITY-001 er udestående og
  markeret som `external-audit`.

## Review

- Base: `5f9fa73`; checkout: `83ad91a`.
- Forudsætningsoverlays: DKC-001 … DKC-058 med stak-tip DKC-027, derefter denne
  overlay. Se `apply.sh` og `evidence/prerequisites.txt`.
- E2E-træet fra en frisk klon med kun `dkc-050/apply.sh` er byte-identisk med
  arbejdsklonen (`evidence/e2e-tree-diff.txt`).
