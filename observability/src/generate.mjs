/**
 * 3.3 — Ops-dashboards.
 *
 * Genererer Prometheus-regler og Grafana-dashboards ud fra modulets manifest:
 * SLO pr. modul kommer fra `slo`-blokken, agenthandlinger er et
 * førsteklasses view. Alt er ren funktioner, så paneler og tærskler kan testes
 * uden en kørende Grafana/Prometheus.
 *
 * Metrikkontrakten (hvad dashboards forventer at OTel-collectoren eksporterer):
 *   platform_agent_actions_total{agent,verb,decision,autonomy_class,principal_kind,tenant}
 *   platform_agent_escalations_total{agent,reason}
 *   platform_agent_budget_exceeded_total{agent}
 *   platform_agent_gateway_bypass_total{agent}
 *   platform_audit_events_total{principal_kind,verb,tenant}
 *   http_requests_total{module,status}
 *   http_request_duration_seconds_bucket{module,le}
 */

const PROMETHEUS_DATASOURCE = { type: "prometheus", uid: "prometheus" };
const LOKI_DATASOURCE = { type: "loki", uid: "loki" };
const CONFIGMAP_LABELS = {
  "app.kubernetes.io/name": "observability",
  "app.kubernetes.io/managed-by": "argocd",
  "platform.example.org/module": "observability",
  "platform.example.org/environment": "dev",
};

const ratio = (availability) => availability / 100;
const seconds = (ms) => ms / 1000;

/** SLO-mål udtrukket fra de moduler, der har en `slo`-blok. */
export function sloTargets(manifests) {
  return manifests
    .filter((m) => m?.manifest?.slo && m?.manifest?.metadata?.name)
    .map(({ manifest }) => ({
      name: manifest.metadata.name,
      version: manifest.metadata.version,
      environment: manifest.telemetry?.otel?.resourceAttributes?.["deployment.environment"] ?? "dev",
      serviceName: manifest.telemetry?.serviceName ?? manifest.metadata.name,
      availability: manifest.slo.availability,
      latencyP95Ms: manifest.slo.latencyP95Ms,
      errorBudgetRef: manifest.slo.errorBudgetRef ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function buildPrometheusRules(manifests) {
  const modules = sloTargets(manifests);

  const sloRules = [
    {
      record: "module:availability:ratio",
      expr: 'sum by (module) (rate(http_requests_total{status!~"5.."}[5m])) / sum by (module) (rate(http_requests_total[5m]))',
    },
    {
      record: "module:latency:p95_seconds",
      expr: "histogram_quantile(0.95, sum by (le, module) (rate(http_request_duration_seconds_bucket[5m])))",
    },
  ];
  for (const m of modules) {
    sloRules.push({
      alert: "ModuleAvailabilityBelowSLO",
      expr: `module:availability:ratio{module="${m.name}"} < ${ratio(m.availability)}`,
      for: "10m",
      labels: { severity: "warning", module: m.name },
      annotations: {
        summary: `${m.name} er under sit tilgængeligheds-SLO`,
        description: `SLO ${m.availability} % (${m.errorBudgetRef ?? "ingen fejlbugdget-reference"}).`,
      },
    });
    sloRules.push({
      alert: "ModuleLatencyAboveSLO",
      expr: `module:latency:p95_seconds{module="${m.name}"} > ${seconds(m.latencyP95Ms)}`,
      for: "10m",
      labels: { severity: "warning", module: m.name },
      annotations: {
        summary: `${m.name} har p95 over sit SLO`,
        description: `SLO ${m.latencyP95Ms} ms (${m.errorBudgetRef ?? "ingen fejlbugdget-reference"}).`,
      },
    });
  }

  const agentRules = [
    {
      record: "platform:agent_actions:rate5m",
      expr: "sum by (agent, verb, decision, autonomy_class) (rate(platform_agent_actions_total[5m]))",
    },
    {
      alert: "AgentEscalationSpike",
      expr: "sum(rate(platform_agent_escalations_total[5m])) > 0.1",
      for: "5m",
      labels: { severity: "warning" },
      annotations: {
        summary: "Agent-eskaleringer over det normale",
        description: "Loop-detektion eller budget pres; se agent-dashboardet.",
      },
    },
    {
      alert: "AgentBudgetExceeded",
      expr: "increase(platform_agent_budget_exceeded_total[1h]) > 0",
      for: "0m",
      labels: { severity: "critical" },
      annotations: {
        summary: "En agent har overskredet sit budget",
        description: "Agenten skal have eskaleret til et menneske; verificér at den stoppede.",
      },
    },
    {
      alert: "AgentGatewayBypassDetected",
      expr: "increase(platform_agent_gateway_bypass_total[1h]) > 0",
      for: "0m",
      labels: { severity: "critical" },
      annotations: {
        summary: "Modelkald uden om AI-gatewayen",
        description: "Direkte leverandørkald er forbudt (ADR-0006). Undersøg straks.",
      },
    },
  ];

  return {
    groups: [
      { name: "platform-slo", interval: "30s", rules: sloRules },
      { name: "platform-agents", interval: "30s", rules: agentRules },
    ],
  };
}

function timeseriesPanel({ id, title, expr, unit, thresholds, gridPos, description, legendFormat }) {
  return {
    id,
    title,
    type: "timeseries",
    datasource: PROMETHEUS_DATASOURCE,
    gridPos,
    description,
    fieldConfig: {
      defaults: {
        unit,
        custom: { lineWidth: 1, fillOpacity: 10, showPoints: "never" },
        thresholds: { mode: "absolute", steps: thresholds },
      },
      overrides: [],
    },
    options: { legend: { displayMode: "list", placement: "bottom" }, tooltip: { mode: "multi" } },
    targets: [{ refId: "A", expr, legendFormat: legendFormat ?? "{{module}}" }],
  };
}

function statPanel({ id, title, expr, gridPos, thresholds, description, unit }) {
  return {
    id,
    title,
    type: "stat",
    datasource: PROMETHEUS_DATASOURCE,
    gridPos,
    description,
    fieldConfig: {
      defaults: { unit: unit ?? "short", thresholds: { mode: "absolute", steps: thresholds }, color: { mode: "thresholds" } },
      overrides: [],
    },
    options: {
      reduceOptions: { calcs: ["lastNotNull"], fields: "", values: false },
      colorMode: "value",
      graphMode: "none",
      textMode: "auto",
    },
    targets: [{ refId: "A", expr, legendFormat: "{{agent}}" }],
  };
}

function textPanel({ id, title, content, gridPos }) {
  return { id, title, type: "text", gridPos, options: { mode: "markdown", content } };
}

function logsPanel({ id, title, expr, gridPos, description }) {
  return {
    id,
    title,
    type: "logs",
    datasource: LOKI_DATASOURCE,
    gridPos,
    description,
    options: { showTime: true, showLabels: true, wrapLogMessage: true },
    targets: [{ refId: "A", expr, legendFormat: "" }],
  };
}

const DASHBOARD_BASE = {
  timezone: "browser",
  schemaVersion: 39,
  version: 1,
  refresh: "30s",
  time: { from: "now-6h", to: "now" },
  tags: ["platform"],
};

function sloTextContent(modules) {
  const lines = [
    "| Modul | Tilgængelighed | p95 | Fejlbugdget |",
    "| --- | --- | --- | --- |",
  ];
  for (const m of modules) {
    lines.push(`| \`${m.name}\` | ${m.availability} % | ${m.latencyP95Ms} ms | ${m.errorBudgetRef ?? "—"} |`);
  }
  return lines.join("\n");
}

export function buildModuleSloDashboard(manifests) {
  const modules = sloTargets(manifests);
  const panels = [
    textPanel({ id: 1, title: "SLO pr. modul (fra manifest)", content: sloTextContent(modules), gridPos: { h: 4, w: 24, x: 0, y: 0 } }),
  ];
  let id = 2;
  let y = 4;
  for (const m of modules) {
    panels.push(
      timeseriesPanel({
        id: id++,
        title: `${m.name} — tilgængelighed`,
        expr: `module:availability:ratio{module="${m.name}"}`,
        unit: "percentunit",
        thresholds: [
          { color: "red", value: null },
          { color: "green", value: ratio(m.availability) },
        ],
        gridPos: { h: 8, w: 12, x: 0, y },
        description: `SLO ${m.availability} % · ${m.errorBudgetRef ?? "ingen fejlbugdget-reference"}`,
      })
    );
    panels.push(
      timeseriesPanel({
        id: id++,
        title: `${m.name} — p95-latens`,
        expr: `module:latency:p95_seconds{module="${m.name}"}`,
        unit: "s",
        thresholds: [
          { color: "green", value: null },
          { color: "red", value: seconds(m.latencyP95Ms) },
        ],
        gridPos: { h: 8, w: 12, x: 12, y },
        description: `SLO ${m.latencyP95Ms} ms · ${m.errorBudgetRef ?? "ingen fejlbugdget-reference"}`,
      })
    );
    y += 8;
  }
  return {
    ...DASHBOARD_BASE,
    uid: "platform-module-slo",
    title: "Modul-SLO (fra manifest)",
    description: "Tilgængelighed og p95 pr. modul målt mod modulets eget SLO fra module-manifest.json.",
    tags: [...DASHBOARD_BASE.tags, "slo"],
    panels,
  };
}

export function buildAgentDashboard() {
  const redAboveOne = [
    { color: "green", value: null },
    { color: "red", value: 1 },
  ];
  return {
    ...DASHBOARD_BASE,
    uid: "platform-agent-actions",
    title: "Agenthandlinger",
    description: "Agenthandlinger som førsteklasses view: hvem, hvad, beslutning, autonomiklasse, eskaleringer og budget.",
    tags: [...DASHBOARD_BASE.tags, "agents"],
    panels: [
      statPanel({ id: 1, title: "Agenthandlinger (1t)", expr: "sum(increase(platform_agent_actions_total[1h]))", gridPos: { h: 4, w: 6, x: 0, y: 0 }, thresholds: [{ color: "blue", value: null }] }),
      statPanel({ id: 2, title: "Eskaleringer (1t)", expr: "sum(increase(platform_agent_escalations_total[1h]))", gridPos: { h: 4, w: 6, x: 6, y: 0 }, thresholds: redAboveOne, description: "Loop eller budget; skal følges op af et menneske." }),
      statPanel({ id: 3, title: "Budgetoverskridelser (1t)", expr: "sum(increase(platform_agent_budget_exceeded_total[1h]))", gridPos: { h: 4, w: 6, x: 12, y: 0 }, thresholds: redAboveOne }),
      statPanel({ id: 4, title: "Kald uden om gateway (1t)", expr: "sum(increase(platform_agent_gateway_bypass_total[1h]))", gridPos: { h: 4, w: 6, x: 18, y: 0 }, thresholds: redAboveOne, description: "Skal altid være 0 (ADR-0006)." }),
      timeseriesPanel({ id: 5, title: "Handlinger pr. agent", expr: "sum by (agent) (rate(platform_agent_actions_total[5m]))", unit: "reqps", thresholds: [{ color: "blue", value: null }], gridPos: { h: 8, w: 12, x: 0, y: 4 }, legendFormat: "{{agent}}" }),
      timeseriesPanel({ id: 6, title: "Handlinger pr. verbum", expr: "sum by (verb) (rate(platform_agent_actions_total[5m]))", unit: "reqps", thresholds: [{ color: "blue", value: null }], gridPos: { h: 8, w: 12, x: 12, y: 4 }, legendFormat: "{{verb}}" }),
      timeseriesPanel({ id: 7, title: "Beslutninger over tid", expr: "sum by (decision) (rate(platform_agent_actions_total[5m]))", unit: "reqps", thresholds: [{ color: "blue", value: null }], gridPos: { h: 8, w: 12, x: 0, y: 12 }, legendFormat: "{{decision}}" }),
      timeseriesPanel({ id: 8, title: "Autonomiklasse", expr: "sum by (autonomy_class) (rate(platform_agent_actions_total[5m]))", unit: "reqps", thresholds: [{ color: "blue", value: null }], gridPos: { h: 8, w: 12, x: 12, y: 12 }, legendFormat: "{{autonomy_class}}" }),
      logsPanel({ id: 9, title: "Agent-log (Loki)", expr: '{job="platform"} | json | principal_kind="agent"', gridPos: { h: 8, w: 24, x: 0, y: 20 }, description: "Rå hændelser for agenthandlinger, inkl. begrundelse og beslutning." }),
    ],
  };
}

export function buildGrafanaDashboards(manifests) {
  return {
    moduleSlo: buildModuleSloDashboard(manifests),
    agentActions: buildAgentDashboard(),
  };
}

/** GitOps-ConfigMaps, så Argo CD ruller regler og dashboards ud sammen med resten. */
export function buildGitOpsConfigMaps(manifests) {
  const rules = buildPrometheusRules(manifests);
  const dashboards = buildGrafanaDashboards(manifests);
  const metadata = (name) => ({ name, namespace: "platform", labels: CONFIGMAP_LABELS });
  return {
    "observability-prometheus-rules.json": {
      apiVersion: "v1",
      kind: "ConfigMap",
      metadata: metadata("observability-prometheus-rules"),
      data: { "platform-rules.json": JSON.stringify(rules, null, 2) },
    },
    "observability-grafana-dashboards.json": {
      apiVersion: "v1",
      kind: "ConfigMap",
      metadata: metadata("observability-grafana-dashboards"),
      data: {
        "module-slo.json": JSON.stringify(dashboards.moduleSlo, null, 2),
        "agent-actions.json": JSON.stringify(dashboards.agentActions, null, 2),
      },
    },
  };
}
