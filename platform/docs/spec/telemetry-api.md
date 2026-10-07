# Autoriseret telemetri-API og udskiftelige dashboards

**Kode:** [`telemetry-api/`](../../telemetry-api)
**Konfiguration:** [`telemetry-api/collectors.json`](../../telemetry-api/collectors.json)
**Kontrakter:** `telemetry-envelope`, `dashboard-view`, `dashboard-adapter`, `collector-status`, `test-run`, `recovery-status`
**Konformans:** [`conformance/src/telemetry-api.mjs`](../../conformance/src/telemetry-api.mjs)
**Backlog:** DKC-066 (afhænger af DKC-017, DKC-018, DKC-055 og DKC-063)

> Interchangeable dashboards og API'er med korrelerede, tenant-sikre drifts- og
> assurance-data.

## Formål

DKC-017 samlede telemetri, friskhed og alarmer lokalt. DKC-066 åbner den samme
sandhed for dashboards og eksterne systemer uden at svække tenantgrænsen eller
lade et forældet signal fremstå som grønt. Indgangen er én versioneret envelope;
udgangen er tenant-scopede views og read-only adaptere.

```
OTel / scannere / CI / backup / agent-runtime
        │  TelemetryEnvelope (metrics, logs, traces, fund, test, recovery, agent)
        ▼
POST /v1/ingest ── server-side scope ──▶ afvis malformet/utroværdig/replay
        │                                   markér late, dedup, backpressure
        ▼
afgrænset lager (retention, kardinalitet, spilling)
        │
        ▼
GET /v1/views/:view ── tenant-scopet autorisation ──▶ DashboardView
        │                                              │
        ├── cache (tenant-scopet, genautoriseres)      ├── Grafana-adapter
        ├── /v1/records (pagineret)                    ├── Loki-adapter
        ├── /v1/resources/:id (link, tenant-spærret)   └── Prometheus-adapter
        └── AI-værktøj (kun aggregater, minimeret)
```

## 1. Versionerede kontrakter

| Kontrakt | Indhold |
| --- | --- |
| `telemetry-envelope` | Én envelope for metrics/logs/traces (OpenTelemetry), find, test, recovery og agenthandling |
| `test-run` | Strukturerede test-/release-resultater med ejer og evidens pr. check |
| `recovery-status` | Målte og vedtagne RPO/RTO, gate og evidens |
| `dashboard-view` | Autoriseret projektion med status, friskhed, serier, aggregater |
| `dashboard-adapter` | Read-only adapter med view-scope |
| `collector-status` | Selvovervågning: heartbeat, drop, backpressure, afviste |

Fund bruger fortsat `security-findings`, agenthandlinger `cloud-event`, og
test-evidens `evidence-record`/`release-gate-result` som separate strukturerede
kontrakter. Envelopen refererer dem via `ref.contract`.

## 2. Stabile ressource-ID'er og relationer

`res://<tenant>/<type>/<lokal-id>` (DKC-006) udvides med et lukket sæt af
ressourcetyper og relationer: `service`, `environment`, `version`, `deployment`,
`change`, `incident`, `alert`, `trace`. `buildCorrelation` bygger en graf og
afviser en relation, der krydser tenant — kun globale miljø-/host-ressourcer
(scope `platform`) er tilladte. Indtagningen udleder scope **server-side** fra den
verificerede principal; et tenantpåstand i body påvirker ikke scope.

## 3. Autoriserede API'er og adaptere

HTTP-API'et er autentificeret med et verificeret Ed25519-JWS (DKC-010):
`POST /v1/ingest`, `GET /v1/views/:view`, `GET /v1/records`,
`GET /v1/resources/:id`, `GET /v1/adapters`, `GET /v1/collectors`, `/healthz`
og `/metrics`. Der findes **ingen** udførelsesrute.

En dashboard-adapter erklærer kun `read` og en `view:`-scope. Registry'et
afviser enhver adapter med skrivekapabilitet eller en `execute()`-metode.
Grafana-, Loki- og Prometheus-adapterne læser alle gennem det samme
autoriserede query-lag og kan udskiftes uden at ændre forretningsmoduler.

## 4. Views

| View | Indhold |
| --- | --- |
| `operations` | Tilgængelighed, p95-latens, fejlrate, kapacitet |
| `vulnerabilities` | CVE'er og afhjælpning med ejer og evidens |
| `test-release` | Test-/release-status med fejlede checks og ejer |
| `recovery` | Backup-/gendannelsesfriskhed og målte RPO/RTO |
| `ai` | Godkendelser, agenthandlinger og omkostning |

Manglende signaler giver `unknown`/`missing` med `lastObservedAt`. Et tomt view
kan aldrig være `pass`. En erklæret recovery uden målte tal er `unknown`, ikke
grøn.

## 5. Skemaudvikling, tid, retention, kardinalitet og backpressure

- `schemaVersion` valideres; ukendte versioner afvises.
- `occurredAt` skal være sandsynligt: fremtidige hændelser afvises, forældede
  markeres `late` og udelades fra friskhed.
- Lageret har retention, hård kapacitet og en kardinalitetsgrænse pr.
  tenant/metrik; overskridelser tælles og droppes.
- Indtagningen har en token-bucket og en buffer-grænse; overload giver HTTP 429
  med `Retry-After`.
- Dedup på `id` → digest; et genbrugt id med nyt indhold afvises som replay.
- Læsning er pagineret med en stabil cursor; eksport bærer digest.

## 6. Alarmer, collectore og audit-adskillelse

Collectorernes heartbeat, drop, backpressure og afviste hændelser overvåges.
En ikke-frisk collector er aldrig `pass`; et overload giver `partial`, og en
eksplicit fejl giver `fail`. Alarmer grupperes på regel + tenant + ressource og
bevarer ejer, eskalation og runbook. Den obligatoriske audit har sin egen
holdbare vej (DKC-009): `verifyAuditUnaffected` beviser, at audit stadig kan
skrive, efter telemetrilageret er overfyldt.

## Sådan køres det

```bash
make telemetry-api-check    # collectorkatalog + 6 kontrakteksempler (offline)
make telemetry-api-test     # 61 modultests + 7 konformanstests
make telemetry-api-demo     # kontrolleret staging-fejl gennem API, views og adaptere
make telemetry-api-serve    # start HTTP-API'et (kræver DKC_TELEMETRY_JWKS; ellers NOT RUN)
```

## Acceptkriterier (DKC-066)

- [x] En kontrolleret staging-fejl linker version, trace, alarm og incident;
      manglende signaler viser `unknown` med `lastObservedAt`.
- [x] Syntetiske CVE- og fejlede testposter vises med ejer og evidens uden en ny
      scanner.
- [x] Tenant A kan ikke indtage under eller læse/eksportere tenant B gennem API,
      cache, link eller AI-værktøj.
- [x] Almindelige brugere kan ikke se globale hostmetrikker eller følsomme
      HR-payloads; aggregater følger en eksplicit autorisationspolitik.
- [x] Sene, dublerede, replayede, malformede og utroværdige hændelser kan ikke
      forfalske pass, godkendelse eller healthy.
- [x] Collector-nedbrud/-overload følger dokumenterede grænser og alarmer; tab af
      drifts-telemetri deaktiverer ikke den obligatoriske audit.
- [x] En understøttet dashboard-adapter kan udskiftes uden at ændre
      forretningsmoduler eller udvide deres privilegier.

## Grænser

- Der kører **ingen** rigtig OTel-/Prometheus-backend og **ingen** rigtig
  Grafana-/Loki-instans i dette miljø. Kæden er efterprøvet lokalt, men
  `integration-telemetry-backend` og `integration-dashboard-adapter` er **NOT RUN**.
- HTTP-serveren autentificerer med et injiceret JWKS; en produktion kobler den til
  den rigtige IdP.
- Se [`docs/status/implementation-matrix.md`](../status/implementation-matrix.md)
  for status pr. check.
