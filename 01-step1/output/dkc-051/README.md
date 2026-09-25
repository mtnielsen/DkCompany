# DKC-051 — Kør fejl- og katastrofetests inklusive immutable og dedup

Kumulativ overlay oven på stak-tippet DKC-050. Lægges med
`./apply.sh <checkout>/00-core`.

- **Reviewets base:** `5f9fa73457d22583b9948611d5cc3afffec4ae38` (`5f9fa73`)
- **Undersøgt checkout:** `83ad91a963d8055f77c29fb4361455689df95acb` (`83ad91a`)
- **Forudsætningskæde:** `dkc-050/apply.sh` → `dkc-027/apply.sh` →
  `dkc-058/apply.sh` → … → `dkc-001/apply.sh`. DKC-051 afhænger formelt af
  **DKC-042** (uafhængig backup, PITR og katastrofegendannelse), **DKC-043**
  (sikker deduplikering og kontrolleret oprydning), **DKC-046** (begrænset
  selvreparation), **DKC-049** (komplet logging) og **DKC-050** (kapacitet og
  vandret skalering). Den genbruger desuden DKC-038/039/040/041/048. Alle er
  verificeret i den anvendte stak (se `evidence/prerequisites.txt`).
- **Miljø:** Node v22.22.1. Ingen isoleret stagingklynge, levende hosts,
  lastgenerator eller ekstern KMS. Matrixen kører de **rigtige** moduler
  deterministisk på syntetiske data og bærer `measured: false`; en målt
  fejløvelse er NOT RUN og beskrevet i `docs/continuity/chaos-live.md`.

## Implementeret adfærd

1. **Fejlmatrix** (`chaos/failure-matrix.json`): 13 scenarier der hver erklærer
   **failure scope**, **forventet dataudfald**, **RPO/RTO**, **tilladt autonomi**,
   **menneskeeskalation** og en konkret probe. Kontrakten
   `contracts/failure-matrix.schema.json` + `conformance/src/chaos.mjs`
   håndhæver form og beslutninger (fem invarianter, alle kritiske scopes, ingen
   målt øvelse).
2. **Prober mod de rigtige moduler** (`chaos/src/probes.mjs`):
   - `ha-host-loss` / `ha-quorum-loss` → `runFailoverDrill`/`assessQuorum` (DKC-038),
   - `network-partition` / `database-failover` → `runDatabaseFailoverDrill` med
     fencing og sync-commit (DKC-039),
   - `storage-disk-full` → kapacitetsalarm og kontrolleret afvisning (DKC-041),
   - `storage-corruption` → `runStorageDrill` (scrub/repair/quorum) (DKC-041),
   - `queue-replay` → outbox-dedup, publisher-confirm og inbox-replay uden
     dobbelt sideeffekt (DKC-040),
   - `control-plane-loss` → `createSafeFallback` uden mutation (DKC-046),
   - `site-restore` → `runDisasterRecoveryDrill` i et isoleret miljø (DKC-042),
   - `dedup-prune` → retention-aware prune med single-writer lease (DKC-043),
   - `kms-unavailability` → fail-closed nøglering (DKC-041/048),
   - `immutable-bypass` → `createImmutableEnforcer` afviser og logger (DKC-048),
   - `healing-storm` → fælles remediation-budget + menneskelig eskalation (DKC-046).
3. **Kører og gate** (`chaos/src/runner.mjs`): sammenligner målt dataudfald og
   RPO/RTO med det erklærede, opgør de fem invarianter og udleder en gate.
   Enhver afvigelse blokerer release med en afvigelsesrapport.
4. **Rapport** (`chaos/src/report.mjs`): genererer
   `docs/continuity/chaos-report.md` og `chaos/report/chaos-report.json`.
5. **Bevis for de fire invarianter**: ingen split-brain, intet tab af kvitterede
   writes, immutable-bypass afvises+logges, healingstorm afgrænses, og øvelsen
   er gentagelig fra ren installation uden kundedata.

## Ændrede filer

32 leverancefiler (18 nye, 14 ændrede, 0 slettede): se
`evidence/deliverable-files.txt`. De vigtigste:

- `chaos/` — nyt modul: `failure-matrix.json`, `package.json`,
  `src/{matrix,probes,runner,report,check,cli}.mjs`,
  `test/chaos.test.mjs`, `report/chaos-report.json`.
- `contracts/failure-matrix.schema.json` + `contracts/examples/failure-matrix.example.json`,
  `conformance/src/chaos.mjs`, `conformance/test/chaos-conformance.test.mjs`,
  `conformance/src/{schemas.mjs,validate-schemas.mjs}`.
- `Makefile`, `tools/baseline/registry.mjs` (komponent `chaos-continuity` + 5
  checks), `release/matrix/{test-matrix,threats}.json` (REQ-CHAOS-001 + 2
  trusler, matrix 1.32.0).
- `docs/spec/chaos.md`, `docs/continuity/chaos-report.md`,
  `docs/continuity/chaos-live.md`,
  `docs/adr/0063-automatiseret-fejl-og-katastrofematrix.md`.
- `docs/spec/README.md`, `docs/adr/README.md`,
  `docs/status/implementation-matrix.md`, `docs/testing/test-matrix.md`,
  `docs/security/threat-model.md` (regenereret pga. nye krav/trusler og den nye
  førstepartspakke), `docs/status/supply-chain.md`,
  `release/{sbom/platform-sbom.cdx.json,artifacts.json}` (regenereret pga. ny
  `package.json`).

## Testkommandoer og resultater

Kørt i den arbejdsklonede stak (stak-tip DKC-050 + DKC-051). Alle nedenstående
er PASS i `evidence/`-loggene:

| Kommando | Resultat | Log |
| --- | --- | --- |
| `make validate` | PASS (117 kontraktskemaer, 128 eksempler) | `evidence/validate.log` |
| `make lint` | PASS (663 JSON-filer) | `evidence/lint.log` |
| `make chaos-run` / `-check` | PASS (gate pass, 13 scenarier, 0 afvigelser) | `evidence/chaos-run.log`, `evidence/chaos-check.log` |
| `make chaos-test` | PASS (16 modul- + 5 konformanstests) | `evidence/chaos-test.log` |
| `make dr-check` / `dedup-check` / `remediation-check` | PASS | `evidence/dr-check.log`, `evidence/dedup-check.log`, `evidence/remediation-check.log` |
| `make ha-check` / `db-ha-check` / `storage-check` / `performance-check` | PASS | `evidence/*-check.log` |
| `make runbook-check` / `monitoring-check` | PASS | `evidence/runbook-check.log`, `evidence/monitoring-check.log` |
| `make release-check` / `-test` | PASS (55 krav, matrix 1.32.0; 27+5 tests) | `evidence/release-*.log` |
| `make supply-chain-check` | PASS (SBOM regenereret) | `evidence/supply-chain-check.log` |
| `make observability-check` / `data-register-check` | PASS | `evidence/observability-check.log`, `evidence/data-register-check.log` |
| `make gitops-verify` / `infrastructure-verify` | PASS (9/9 i dev/staging/prod) | `evidence/gitops-verify.log`, `evidence/infrastructure-verify.log` |
| `make test` | PASS (382 tests) | `evidence/test.log` |
| `make conform-all` / `conform-negative` | PASS / forventet FAIL | `evidence/conform-*.log` |
| `make baseline` | 162 PASS, 1 FAIL, 46 NOT RUN af 209 | `evidence/baseline.log`, `evidence/baseline-summary.txt` |

### E2E på en frisk klon med kun pakkens `apply.sh`

| Kommando | Resultat | Log |
| --- | --- | --- |
| `./dkc-051/apply.sh <clone>/00-core` | PASS | `evidence/e2e-apply.log` |
| `make install` | PASS | `evidence/e2e-install.log` |
| fokuseret kontrol (`validate`, `lint`, `chaos-run/-check/-test`, `release-check/-test`, `supply-chain-check`, `dr-check`, `dedup-check`, `remediation-check`, `ha-check`, `db-ha-check`, `storage-check`, `performance-check`, `runbook-check`, `monitoring-check`, `observability-check`, `data-register-check`, `gitops-verify`, `infrastructure-verify`, `test`) | PASS | `evidence/e2e-check.log` |
| træ-diff mod arbejdsklonen | byte-identisk (0 forskelle) | `evidence/e2e-tree-diff.txt` |

### Baseline

`make baseline` giver **162 PASS, 1 FAIL, 0 error, 46 NOT RUN af 209 checks**.
Den ene FAIL er den kendte, forudgående **`changelog-check`**: commits i
checkoutet mangler DCO sign-off (også `83ad91a`). Den er ikke "rettet" eller
skjult. De fem nye checks (`chaos-check`, `chaos-test`, `chaos-run`,
`chaos-report` og `integration-chaos-staging`) er henholdsvis PASS og NOT RUN
med en præcis begrundelse. Baseline muterer som vanligt sporede filer under
`modules/*/conformance`; snapshottet (65 filer) blev gendannet bagefter, og
`diff -rq` viste ingen afvigelser.

## Acceptkriterier

| # | Kriterium | Resultat | Evidens |
| --- | --- | --- | --- |
| 1 | Ingen kendt split-brain eller tab af kvitterede kritiske writes i den vedtagne HA-fejlmodel | PASS (model) / NOT RUN (levende) | `chaos/src/runner.mjs` invarianter, `docs/continuity/chaos-report.md` |
| 2 | Katastrofegendannelse opfylder mål eller blokerer release med afvigelsesrapport | PASS | `site-restore`-probe, `report.gate` + `deviations` |
| 3 | Healingstorm stoppes af fælles budget og menneskelig eskalation | PASS | `healing-storm`-probe, `evidence/chaos-test.log` |
| 4 | Alle immutable-bypassforsøg afvises og logges | PASS | `immutable-bypass`-probe (`bypassesDenied`/`bypassesLogged`) |
| 5 | Testen kan gentages fra en ren installation uden kundedata | PASS | deterministisk dobbeltkørsel i `chaos/test/chaos.test.mjs` + E2E-trædiff |

Kriterium 1 er **PASS for den deterministiske model**. Selve den **levende**
fejløvelse i en isoleret stagingklynge er **NOT RUN** (ingen infrastruktur i
dette miljø) og kræver en ekstern evidenspost.

## Ærlige begrænsninger

- Matrixen er `measured: false`; den er deterministisk og kører de rigtige
  moduler, men erstatter ikke en målt fejløvelse.
- Den levende øvelse (`make chaos-live`) afviser med en begrundelse og er NOT RUN.
- `storage-disk-full` bruger en skaleret `perHostCapacityBytes` for at nå
  hard-stop i et lille, deterministisk datasæt; mekanikken og alarmen er den
  rigtige.
- `release-check`'s uafhængige vurdering for REQ-CHAOS-001 er udestående og
  markeret som `external-audit`.

## Review

- Base: `5f9fa73`; checkout: `83ad91a`.
- Forudsætningsoverlays: DKC-001 … DKC-050 med stak-tip DKC-050, derefter denne
  overlay. Se `apply.sh` og `evidence/prerequisites.txt`.
- E2E-træet fra en frisk klon med kun `dkc-051/apply.sh` er byte-identisk med
  arbejdsklonen (`evidence/e2e-tree-diff.txt`).
