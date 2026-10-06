/**
 * DKC-066 — udskiftelige, read-only dashboard-adaptere.
 *
 * En adapter oversætter et autoriseret `DashboardView` til sit eget dashboards
 * format (Grafana, Loki, Prometheus eller et tilpasset system). Alle adaptere
 * deler den samme kontrakt: de erklærer kun `read`, de bærer en view-scope, og
 * de læser gennem det autentificerede query-lag. Udskiftning af én adapter
 * kræver derfor ingen ændring i forretningsmodulerne og udvider ikke deres
 * privilegier.
 */
export const ADAPTER_CAPABILITIES = ["read"];

export function adapterProblems(adapter) {
  const problems = [];
  for (const key of ["id", "kindDetail", "version"]) {
    if (!adapter?.[key]) problems.push(`/${key}: mangler`);
  }
  const caps = adapter?.capabilities ?? [];
  if (!caps.includes("read")) problems.push("/capabilities: skal indeholde 'read'");
  if (caps.some((c) => c !== "read")) problems.push("/capabilities: kun 'read' er tilladt i en dashboard-adapter");
  if (!(adapter?.scopes ?? []).length) problems.push("/scopes: skal erklære mindst én view-scope");
  if (!(adapter?.views ?? []).length) problems.push("/views: skal erklære mindst ét view");
  if (adapter?.enabled === undefined) problems.push("/enabled: mangler");
  return problems;
}

function assertReadOnly(adapter) {
  const problems = adapterProblems(adapter);
  if (problems.length) throw new Error(`ugyldig dashboard-adapter: ${problems.join("; ")}`);
  if (adapter.execute) throw new Error("en dashboard-adapter må ikke eksponere execute()");
  return true;
}

function summarize(view, path) {
  const pick = path(view);
  return {
    id: view.view,
    status: view.status,
    lastObservedAt: view.lastObservedAt,
    generatedAt: view.generatedAt,
    scope: view.scope,
    cardinality: view.cardinality,
    redactions: view.redactions ?? [],
    aggregates: view.aggregates,
    data: pick,
  };
}

export function createGrafanaAdapter({ query, view = "operations", id = "grafana" } = {}) {
  const adapter = {
    id,
    kindDetail: "grafana",
    version: "10.x",
    capabilities: ["read"],
    scopes: [`view:${view}`],
    views: [view],
    enabled: true,
    async render({ principal, tenantId, params = {}, now } = {}) {
      const data = query.readView({ principal, view, tenantId, params, now, via: "grafana" });
      return summarize(data, (v) => ({
        panels: v.series.map((s) => ({ title: s.metric, type: "timeseries", targets: [{ expr: s.metric, unit: s.unit, points: s.points }] })),
      }));
    },
  };
  assertReadOnly(adapter);
  return adapter;
}

export function createLokiAdapter({ query, view = "operations", id = "loki" } = {}) {
  const adapter = {
    id,
    kindDetail: "loki",
    version: "3.x",
    capabilities: ["read"],
    scopes: [`view:${view}`],
    views: [view],
    enabled: true,
    async render({ principal, tenantId, params = {}, now } = {}) {
      const data = query.readView({ principal, view, tenantId, params, now, via: "loki" });
      return summarize(data, (v) => ({
        streams: v.items.slice(0, 500).map((item) => ({ labels: { view: v.view, tenant: v.scope.tenantId }, values: [[v.generatedAt, JSON.stringify(item)]] })),
      }));
    },
  };
  assertReadOnly(adapter);
  return adapter;
}

export function createPrometheusAdapter({ query, view = "operations", id = "prometheus" } = {}) {
  const adapter = {
    id,
    kindDetail: "prometheus",
    version: "2.x",
    capabilities: ["read"],
    scopes: [`view:${view}`],
    views: [view],
    enabled: true,
    async render({ principal, tenantId, params = {}, now } = {}) {
      const data = query.readView({ principal, view, tenantId, params, now, via: "prometheus" });
      return summarize(data, (v) => ({
        series: v.series.map((s) => ({ metric: { __name__: s.metric }, values: s.points.map((p) => [Math.floor(Date.parse(p.at) / 1000), String(p.value)]) })),
      }));
    },
  };
  assertReadOnly(adapter);
  return adapter;
}

/**
 * Registry af adaptere. `render` vælger en adapter, validérer at den er
 * read-only og at dens view-scope dækker det ønskede view.
 */
export function createAdapterRegistry(adapters = []) {
  const byId = new Map();
  for (const adapter of adapters) {
    assertReadOnly(adapter);
    byId.set(adapter.id, adapter);
  }
  return {
    list() {
      return [...byId.values()].map((a) => ({ id: a.id, kindDetail: a.kindDetail, version: a.version, views: a.views, scopes: a.scopes, enabled: a.enabled }));
    },
    async render({ adapterId, principal, view, tenantId, params, now } = {}) {
      const adapter = byId.get(adapterId);
      if (!adapter) throw new Error(`ukendt dashboard-adapter '${adapterId}'`);
      if (!adapter.views.includes(view)) throw new Error(`adapteren '${adapterId}' understøtter ikke view '${view}'`);
      return adapter.render({ principal, view, tenantId, params, now });
    },
  };
}
