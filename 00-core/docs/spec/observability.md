# Ops-dashboards: Prometheus, Grafana og Loki

**Kode:** [`observability/`](../../observability)
**GitOps-artefakter:** [`gitops/manifests/dev/observability-*`](../../gitops/manifests/dev)
**Backlog:** 3.3 (afhænger af 0.3 og 2.3)

> SLO pr. modul fra manifest. Agenthandlinger som førsteklasses view.

## Formål

Et SLO, der kun står i et manifest, er en hensigt. 3.3 gør hensigten målbar: Prometheus-regler og Grafana-dashboards genereres fra modulets `slo`-blok, så tærsklerne ikke kan drive fra den erklærede aftale. Agentlaget får sit eget dashboard, fordi en agenthandling skal kunne ses, forklares og stoppes — ikke gemmes i en generisk request-graf.

## Genereret fra manifestet

```
module-manifest.json (slo + telemetry)
        │
        ├── Prometheus-regler ──▶ gitops/manifests/dev/observability-prometheus-rules.json
        └── Grafana-dashboards ─▶ gitops/manifests/dev/observability-grafana-dashboards.json
```

`make observability-check` fejler, hvis de committede filer er ude af trit med et manifest. Det er samme princip som change loggen og kontrolmappingen: det, der vises i drift, skal kunne genskabes fra git.

### Prometheus-regler

| Regel | Type | Indhold |
| --- | --- | --- |
| `module:availability:ratio` | recording | Andel ikke-5xx-svar pr. modul |
| `module:latency:p95_seconds` | recording | p95-svartid pr. modul |
| `ModuleAvailabilityBelowSLO` | alert | Under modulets `slo.availability` i 10 min |
| `ModuleLatencyAboveSLO` | alert | Over modulets `slo.latencyP95Ms` i 10 min |
| `AgentEscalationSpike` | alert | Eskaleringer over det normale |
| `AgentBudgetExceeded` | alert | `critical` — en agent har overskredet sit budget |
| `AgentGatewayBypassDetected` | alert | `critical` — modelkald uden om AI-gatewayen (ADR-0006) |

### Grafana-dashboards

- **Modul-SLO** — en tabel med hvert moduls SLO og fejlbugdget-reference samt to tidsserier pr. modul: tilgængelighed (rød under SLO) og p95-latens (rød over SLO).
- **Agenthandlinger** — førsteklasses view: antal handlinger, eskaleringer, budgetoverskridelser og kald uden om gatewayen; tidsserier pr. agent, verbum, beslutning og autonomiklasse; et Loki-logpanel med de rå agenthændelser.

## Metrikkontrakten

Dashboards forventer, at OTel-collectoren (0.3) eksporterer disse serier. Runtime (2.3) udsender dem som del af telemetriplanen; navnene er dashboardets kontrakt:

```
platform_agent_actions_total{agent,verb,decision,autonomy_class,principal_kind,tenant}
platform_agent_escalations_total{agent,reason}
platform_agent_budget_exceeded_total{agent}
platform_agent_gateway_bypass_total{agent}
platform_audit_events_total{principal_kind,verb,tenant}
http_requests_total{module,status}
http_request_duration_seconds_bucket{module,le}
```

`platform_agent_gateway_bypass_total` skal altid være 0. Et enkelt positivt udsving er en `critical`-alert, fordi direkte leverandørkald er forbudt.

## Stakken

Prometheus, Grafana og Loki kører som GitOps-styrede Deployments i `platform`-namespacet: pinnede images, non-root, read-only root-filsystem, droppede capabilities. Prometheus scrapper pods via Kubernetes SD og mærker serierne med `module`; Grafana provisioneres med Prometheus og Loki som datakilder og de genererede dashboards; Loki samler logsignalerne. Alle tre er ConfigMap-drevet og ændres kun gennem git.

## Sådan køres det

```bash
make observability-dashboards   # genskab regler og dashboards fra manifesterne
make observability-check        # fejl hvis de committede filer er ude af trit
make observability-test         # generator + configmap-synkronisering (5 tests)
make gitops-verify              # stackens hardening og image-digests
```

## Acceptkriterier (3.3)

- [x] SLO pr. modul udledes af `module-manifest.json` og håndhæves som Prometheus-alerts.
- [x] Grafana-dashboards for modul-SLO og agenthandlinger genereres og committes til GitOps.
- [x] Agenthandlinger er et førsteklasses view med eskalering, budget og gateway-bypass.
- [x] Loki indgår som logdatakilde.
- [x] Drift mellem manifest og dashboard fanges i CI (`make observability-check`).

## Grænser

- Metrikkontrakten er deklareret, men runtime eksponerer endnu ikke Prometheus-serier; OTel-collectoren og eksportøren er deployerens ansvar. Dashboards er derfor klare, når telemetrien kobles på.
- Stackens images er pladsholdere med digest, som det er praksis i dette repo; en rigtig klon erstatter dem med verificerede digests.
