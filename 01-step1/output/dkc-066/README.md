# DKC-066 — Expose authorized operations, quality and security data to dashboards (leverance)

Implementering af **DKC-066** for `mtnielsen/DkCompany`. Bygger på DKC-001 ..
DKC-017. `00-core/` i det faktiske repo er fortsat **ikke ændret**; alt ligger
under `01-step1/output/dkc-066/`.

- **Reviewets base:** `5f9fa73457d22583b9948611d5cc3afffec4ae38` (`5f9fa73`)
- **Undersøgt checkout:** `83ad91a963d8055f77c29fb4361455689df95acb` (`83ad91a`)
- **Forudsætnings-overlays:** `dkc-017` → `dkc-057` → `dkc-016` → `dkc-020` →
  `dkc-024` → `dkc-023` → … → `dkc-001` (kædes af `apply.sh`)
- **Miljø:** Node v22.22.1. Ingen OTel-/Prometheus-backend, ingen Grafana-/Loki-
  instans, intet Docker/kubectl/tofu.

## Forudsætninger og valg

DKC-066 afhænger formelt af **DKC-017, DKC-018, DKC-055 og DKC-063**. Alle er
verificeret i kode, ikke i et statusfelt:

- `observability/` og `conformance/src/monitoring.mjs` (DKC-017) giver friskhed,
  sensorkatalog og den ikke-grønne regel, som views genbruger.
- `conformance/src/evidence-mode.mjs` og `evidence/src/probes.mjs` (DKC-018)
  giver mode-/friskhedsbundet evidens.
- `agent-registry/` og `contracts/agent-registration.schema.json` (DKC-055)
  giver den single-role-agent-model, som agenthandlinger refererer.
- `release/matrix/test-matrix.json` og `release/src/gate.mjs` (DKC-063) giver
  test-/release-kontrakterne, som `test-run`-viewet bygger på.
- Derudover genbruges `identity/src/tenant.mjs` (DKC-006) til server-side scope,
  `credentials/src/jws.mjs` (DKC-010) til autentificeret API-adgang og
  `persistence/src/redact.mjs` (DKC-009) til minimering/redaktion.

Opgaven er delvist miljøblokeret: der findes ingen levende OTel-/Prometheus-
backend og ingen rigtig Grafana-/Loki-instans. Valget var at implementere hele
kæden **rigtigt** og efterprøve den lokalt, mens de to eksterne integrationer
registreres ærligt som **NOT RUN**.

## Implementeret adfærd

1. **Versionerede kontrakter.** `telemetry-envelope` (én envelope for
   metrics/logs/traces via OpenTelemetry, fund, testkørsler, recovery og
   agenthandlinger), `test-run`, `recovery-status`, `dashboard-view`,
   `dashboard-adapter` og `collector-status` med eksempler og semantiske
   validatorer i `conformance/src/telemetry-api.mjs`. Fund bruger fortsat
   `security-findings`, agenthandlinger `cloud-event`.
2. **Stabile ressource-ID'er og relationer.** `telemetry-api/src/resources.mjs`
   bygger `res://<tenant>/<type>/<lokal-id>`-relationer på tværs af tjeneste,
   miljø, version, deployment, ændring, incident, alarm og trace og afviser en
   relation, der krydser tenant. Indtagningen udleder scope **server-side** fra
   den verificerede principal (`telemetry-api/src/ingest.mjs`).
3. **Autoriseret indtagning og læsning.** `POST /v1/ingest` afviser malformede,
   utroværdige og replayede hændelser, markerer forældede `late`, deduplikerer og
   anvender kardinalitets-/backpressure-grænser. `GET /v1/views/:view`,
   `/v1/records`, `/v1/resources/:id`, `/v1/adapters` og `/v1/collectors` er
   tenant-scopede. HTTP-API'et autentificerer med et verificeret Ed25519-JWS.
4. **Read-only dashboard-adaptere.** Grafana-, Loki- og Prometheus-adaptere
   læser gennem det samme autoriserede query-lag, erklærer kun `read` og kan
   udskiftes uden at ændre forretningsmoduler.
5. **Fem views.** `operations` (tilgængelighed/latens/fejl/kapacitet),
   `vulnerabilities` (CVE + afhjælpning med ejer/evidens), `test-release`,
   `recovery` (målte RPO/RTO) og `ai` (godkendelser/aktioner/omkostning).
   Manglende signaler giver `unknown`/`missing` med `lastObservedAt`.
6. **Drifts- og sikkerhedsgarantier.** Retention, kardinalitet, paginering,
   redaktion, tenant-scopet cache, dedup/replay-detektion, token-bucket/
   backpressure og collector-selvovervågning. `verifyAuditUnaffected` beviser, at
   den obligatoriske audit kan skrive, efter telemetrilageret er overfyldt.

## Ændrede og nye filer

Se [`evidence/logs/deliverable-files.txt`](evidence/logs/deliverable-files.txt)
(54 filer). De væsentligste:

- `telemetry-api/` — `collectors.json`, `package.json`, `src/{resources,envelope,store,ingest,authz,views,query,adapters,collectors,server,cli}.mjs`, 11 testfiler
- `contracts/{telemetry-envelope,test-run,recovery-status,dashboard-view,dashboard-adapter,collector-status}.schema.json` + 6 eksempler
- `conformance/src/telemetry-api.mjs`, `conformance/test/telemetry-api-conformance.test.mjs`
- `Makefile`, `tools/baseline/registry.mjs` (ny `telemetry-api`-komponent + 3 checks + 2 eksterne)
- `release/matrix/test-matrix.json` (1.11.0 + `REQ-TELEMETRY-API-001`), `release/matrix/threats.json`
- `release/sbom/platform-sbom.cdx.json`, `release/artifacts.json`, `docs/status/supply-chain.md` (regenereret SBOM pga. ny `package.json`)
- `docs/spec/telemetry-api.md`, `docs/adr/0042-…md`, og de genererede docs

## Testkommandoer og resultater

| Kommando | Resultat |
| --- | --- |
| `make install` | OK |
| `make validate` | OK — 72 kontraktskemaer, 75 eksempler, heraf 6 DKC-066-eksempler med semantik |
| `make lint` | OK — 420 JSON-filer, 1069 filer |
| `make test` | OK — 202/202 konformanstests |
| `make telemetry-api-check` | OK — collectorkatalog (5 kilder) + 6 kontrakteksempler |
| `make telemetry-api-test` | OK — 61 modultests + 7 konformanstests |
| `make telemetry-api-demo` | OK — kontrolleret staging-fejl linker version/trace/alarm/incident gennem API, views og adaptere |
| `make release-check` | OK — 34 krav, matrixversion 1.11.0, docs i sync |
| `make supply-chain-check` | OK — SBOM-digest `692b82531d3b…` (regenereret efter ny `package.json`) |
| `make monitoring-test` | OK — DKC-017-adfærden er uændret |
| `make baseline` | **FAIL** — 100 pass, 1 fail, 24 not run, 0 error (125 checks). Den ene FAIL er den kendte, forudgående `changelog-check` (manglende DCO sign-off, inkl. 83ad91a). |

Logfiler: [`evidence/logs/`](evidence/logs/) og baseline i
[`evidence/baseline/`](evidence/baseline/).

## Acceptkriterier

| Kriterium | Status | Bevis |
| --- | --- | --- |
| Kontrolleret staging-fejl linker version, trace, alarm og incident; manglende signaler viser `unknown` med last-observed | **PASS** | `telemetry-api-demo` (korrelation version→trace→incident→alert), `telemetry-api/test/views.test.mjs` |
| Syntetiske CVE- og fejlede testposter vises med ejer/evidens uden ny scanner | **PASS** | `views.test.mjs` (vulnerabilities/test-release), `telemetry-api-conformance.test.mjs` |
| Tenant A kan ikke indtage under eller læse/eksportere tenant B gennem API, cache, link eller AI | **PASS** | `ingest.test.mjs`, `query.test.mjs`, `authz.test.mjs`, `server.test.mjs` |
| Almindelige brugere kan ikke se globale hostmetrikker eller følsomme HR-payloads; aggregater følger eksplicit politik | **PASS** | `authz.test.mjs` (global rolle, HR/AI-redaktion, host-aggregering) |
| Sene/dublerede/replayede/malformede/utroværdige hændelser kan ikke forfalske pass/godkendelse/healthy | **PASS** | `envelope.test.mjs`, `ingest.test.mjs`, `views.test.mjs` (late ekskluderes; tomt view kan ikke være pass) |
| Collector-nedbrud/-overload følger dokumenterede grænser og alarmer; telemetritab deaktiverer ikke audit | **PASS** | `collectors.test.mjs` (friskhed/overload, gruppering, `verifyAuditUnaffected`) |
| En understøttet dashboard-adapter kan udskiftes uden at ændre moduler eller udvide privilegier | **PASS** | `adapters.test.mjs`, `authz.test.mjs` (`assertReadOnly`) |

## Miljøblokerede dele (NOT RUN)

- **`integration-telemetry-backend`** — ingen kørende OTel-collector/Prometheus.
  Indtagning, scope og views er efterprøvet lokalt; den rigtige backend er NOT RUN.
- **`integration-dashboard-adapter`** — ingen rigtig Grafana-/Loki-instans.
  Adapterkontrakten og udskifteligheden er efterprøvet lokalt; en rigtig instans
  er NOT RUN.
- **`REQ-TELEMETRY-API-001`** har derfor en påkrævet, uafhængig driftsvurdering.

## Kendte begrænsninger

- HTTP-serveren autentificerer med et injiceret JWKS; en produktion kobler den til
  den rigtige IdP og nøglerotation.
- Telemetrilageret er best-effort (bounded + retention); den obligatoriske audit
  har fortsat sin egen holdbare vej og påvirkes ikke.
- Den eksporterede `content` bruger en simpel JSON-projektion; en produktion kan
  tilføje streaming/CSV uden at ændre kontrakten.
- Baseline ændrer 30 sporede fixture-filer under `modules/*/conformance`; de er
  gendannet fra en ren reference-checkout. Se
  [`evidence/baseline/SUMMARY.txt`](evidence/baseline/SUMMARY.txt).
