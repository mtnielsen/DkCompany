# DKC-017 — Tilslut reel overvågning og hændelseshåndtering (leverance)

Implementering af **DKC-017** for `mtnielsen/DkCompany`. Bygger på DKC-001 ..
DKC-057. `00-core/` i det faktiske repo er fortsat **ikke ændret**; alt ligger
under `01-step1/output/dkc-017/`.

- **Reviewets base:** `5f9fa73457d22583b9948611d5cc3afffec4ae38` (`5f9fa73`)
- **Undersøgt checkout:** `83ad91a963d8055f77c29fb4361455689df95acb` (`83ad91a`)
- **Forudsætnings-overlays:** `dkc-057` → `dkc-016` → `dkc-020` → `dkc-024` →
  `dkc-023` → `dkc-064` → … → `dkc-001` (kædes af `apply.sh`)
- **Miljø:** Node v22.22.1. Ingen Prometheus/Loki/OTel-backend, ingen pager-/
  webhook-konto, intet Docker/kubectl/tofu.

## Forudsætninger og valg

DKC-017 afhænger formelt af **DKC-009** og **DKC-015**. Begge er verificeret i
kode, ikke i et statusfelt:

- `persistence/src/redact.mjs` og `persistence/src/audit-check.mjs` (DKC-009)
  giver den fælles minimering/redaktion, som telemetri og notifikationer
  genbruger, og fail-closed logadfærd.
- `infrastructure/` og `gitops/manifests/prod|staging` (DKC-015) giver den
  kørende installations GitOps-vej og de netværks-/secretkontroller, som en
  telemetri-strøm skal respektere.
- Derudover genbruges `identity/src/tenant.mjs` (DKC-006) til den verificerede
  tenant-kontekst, `conformance/src/evidence-mode.mjs` (DKC-018) til
  mode-/friskhedssemantik og `backup/` (DKC-016/057) til backupfejl-signalet.

Opgaven er delvist miljøblokeret: der findes ingen levende metrics-/log-/trace-
backend og ingen rigtig alarmkanal. Valget var at implementere hele kæden
**rigtigt** og efterprøve den lokalt, mens de to eksterne integrationer
registreres ærligt som **NOT RUN**.

## Implementeret adfærd

1. **Telemetri med minimering og tenantadgang.** `observability/src/telemetry.mjs`
   minimerer metrics/logs/traces (hemmeligheder → `[REDACTED]`, personfelter →
   `[MINIMIZED]` med bevaret digest) og afviser et emne der ser ud som en rå
   personidentifikator. `queryTelemetry` udleder tenanten af den **verificerede**
   principal via `requireTenantContext`; en fremmed tenant afvises, og resultatet
   filtreres altid på den udledte tenant. Kun en scopet platformrolle kan læse
   på tværs — og det markeres.
2. **Sensorkatalog med kilde og friskhed.** `observability/sensors.json` er den
   kanoniske kilde (7 sensorer). `observability/src/freshness.mjs` skelner
   `fresh`/`stale`/`missing`, og `observability/src/sensors.mjs` bygger
   `SecurityPosture` hvor `stale`/`missing` tilsidesætter ethvert `pass`.
3. **Alarmer med ejer, eskalation og runbook.** `observability/alert-rules.json`
   har 5 regler, hver med navngivet ejer, stigende eskalationsstige, runbook og
   modtager. `observability/src/alerts.mjs` evaluerer reglerne, leverer en
   minimeret notifikation gennem en transport og fører et hændelsesforløb
   (`alerted → notified → escalated → acknowledged → resolved`).
   `createLocalMailbox` er en rigtig, fil-bakket testmodtager;
   `createWebhookTransport` rapporterer `not-run` uden endpoint — aldrig et
   falsk `delivered`.
4. **Kontrakter og konformans.** Nye skemaer `telemetry-record`,
   `sensor-registry`, `alert-rule-set`, `alert-notification` og
   `security-posture` med eksempler. `conformance/src/monitoring.mjs` håndhæver
   minimering, pseudonymitet, ejerskab, runbook-eksistens, friskhed og at en
   status med forældede/manglende sensorer ikke kan være `pass`.
5. **CLI og Makefile.** `monitoring-check`, `monitoring-test`,
   `monitoring-posture` og `monitoring-drill` (sidstnævnte fremkalder
   tjenestefejl + backupfejl + forældet sensor og leverer til testmodtageren).

## Ændrede og nye filer

Se [`evidence/logs/deliverable-files.txt`](evidence/logs/deliverable-files.txt)
(35 filer). De væsentligste:

- `observability/src/telemetry.mjs`, `freshness.mjs`, `sensors.mjs`, `alerts.mjs`, `monitoring-cli.mjs`, `check.mjs`
- `observability/sensors.json`, `observability/alert-rules.json`
- `observability/test/telemetry.test.mjs`, `sensors.test.mjs`, `alerts.test.mjs`
- `contracts/{telemetry-record,sensor-registry,alert-rule-set,alert-notification,security-posture}.schema.json` + 3 eksempler
- `conformance/src/monitoring.mjs`, `conformance/test/monitoring-conformance.test.mjs`
- `Makefile`, `tools/baseline/registry.mjs` (ny `monitoring`-komponent + 3 checks + 2 eksterne)
- `release/matrix/test-matrix.json` (1.10.0 + `REQ-MONITORING-001`), `release/matrix/threats.json`
- `docs/spec/monitoring.md`, `docs/runbooks/alerting.md`, `docs/adr/0041-…md`
- `docs/spec/README.md`, `docs/adr/README.md`, `docs/testing/test-matrix.md`, `docs/security/threat-model.md`, `docs/status/implementation-matrix.md`

## Testkommandoer og resultater

| Kommando | Resultat |
| --- | --- |
| `make install` | OK |
| `make validate` | OK — 66 kontraktskemaer, 69 eksempler, heraf 1 telemetri, 1 notifikation, 1 sikkerhedsstatus med semantik |
| `make lint` | OK — 406 JSON-filer, 1029 filer |
| `make test` | OK — 195/195 konformanstests |
| `make monitoring-check` | OK — 7 sensorer, 5 regler, alle runbooks findes |
| `make monitoring-test` | OK — 20 observability-tests + 6 konformanstests |
| `make monitoring-drill` | OK — 2 scenarier, 3 alarmer leveret til testmodtageren, forløb med eskalation/kvittering/løsning |
| `make monitoring-posture` | OK — scanner-/runtime-sensorerne får deres tid og status fra de normaliserede fund. Med det committede sample (2025-09-01) er statussen ærligt `stale` nu; på sampletidspunktet bliver den `partial`/`pass` efter friskhed. |
| `make release-check` | OK — 33 krav, matrixversion 1.10.0, docs i sync |
| `make supply-chain-check` | OK — SBOM-digest `560ff7eedabc…` (uændret; ingen ny `package.json`) |
| `make baseline` | **FAIL** — 97 pass, 1 fail, 22 not run, 0 error (120 checks). Den ene FAIL er den kendte, forudgående `changelog-check` (manglende DCO sign-off, inkl. 83ad91a). |
| `make ci` | Stopper ved den samme forudgående `changelog-check`; resten er dækket af baseline. |

Logfiler: [`evidence/logs/`](evidence/logs/) og baseline i
[`evidence/baseline/`](evidence/baseline/) samt
[`evidence/monitoring/`](evidence/monitoring/) (drillens notifikationer,
hændelsesforløb og posturer).

## Acceptkriterier

| Kriterium | Status | Bevis |
| --- | --- | --- |
| Fremkaldt tjenestefejl og backupfejl udløser alarm hos testmodtager | **PASS** | `monitoring-drill` (service-unavailable + backup-failed leveret til `platform-oncall-local`), `observability/test/alerts.test.mjs` |
| En kunde kan ikke se en andens telemetri | **PASS** | `observability/test/telemetry.test.mjs` (fremmed tenant afvises, kun scopet platformrolle kan krydslæse) |
| Gamle eller manglende sensordata fremstår ikke som grøn sikkerhedsstatus | **PASS** | `observability/test/sensors.test.mjs`, `conformance/test/monitoring-conformance.test.mjs`, drill-scenariet `stale-security-sensor` (`overall=stale`) |
| Alarmens forløb dokumenteres uden at dele rå persondata bredt | **PASS** | `observability/test/alerts.test.mjs` (minimeret notifikation + tidslinje), `evidence/monitoring/` |

Leverancepunkterne 1–3 (metrics/logs/traces med tenantadgang og minimering; scanner-
og runtime-sensorer med datakilde og friskhed; alarmer med ejer/eskalation/runbook
samt øvelse i nøglerevokation, logsvigt og fejlet backup) er alle implementeret med
konfigurerede regler (`credential-revocation-failed`, `audit-log-failure`,
`backup-failed`).

## Miljøblokerede dele (NOT RUN)

- **`integration-monitoring-backend`** — ingen kørende Prometheus/Loki/OTel-
  collector. Indsamling, minimering og friskhed er efterprøvet lokalt; den
  rigtige backend er NOT RUN.
- **`integration-alert-delivery`** — ingen pager-/webhook-konto. Den lokale,
  fil-bakkede testmodtager er en rigtig modtager, men en rigtig kanal er NOT RUN.
- **`REQ-MONITORING-001`** har derfor en påkrævet, uafhængig driftsvurdering.

## Kendte begrænsninger

- Den lokale testmodtager er fil-bakket; den beviser kæden fra signal til
  leveret notifikation, ikke en ekstern leverandørs levering.
- Sensorkataloget dækker de sensorer repoet kender i dag; nye scannere skal
  tilføjes til `observability/sensors.json` og have en regel i
  `observability/alert-rules.json`.
- Baseline ændrer 30 sporede fixture-filer under `modules/*/conformance`; de er
  gendannet fra en ren reference-checkout. Se
  [`evidence/baseline/SUMMARY.txt`](evidence/baseline/SUMMARY.txt).
