import { test } from "node:test";
import assert from "node:assert/strict";
import { createBoundedStore } from "../src/store.mjs";
import { createIngestor } from "../src/ingest.mjs";
import { createQueryService } from "../src/query.mjs";
import { createGrafanaAdapter, createLokiAdapter, createPrometheusAdapter, createAdapterRegistry, adapterProblems } from "../src/adapters.mjs";
import { metricEnvelope, registry, NOW, acmeOperator } from "./support/fixtures.mjs";

function setup() {
  const store = createBoundedStore({ capacity: 100, retentionSeconds: 86400, clock: () => NOW });
  const ingestor = createIngestor({ store, registry, clock: () => NOW });
  ingestor.ingest({ principal: acmeOperator, envelope: metricEnvelope("http_requests_total", 100, { id: "m1" }) });
  ingestor.ingest({ principal: acmeOperator, envelope: metricEnvelope("http_errors_total", 1, { id: "m2" }) });
  return createQueryService({ store, clock: () => NOW });
}

test("adapterkontrakten kræver read-only og en scope", () => {
  assert.deepEqual(adapterProblems({ id: "x", kindDetail: "grafana", version: "1", capabilities: ["read"], scopes: ["view:operations"], views: ["operations"], enabled: true }), []);
  assert.ok(adapterProblems({ id: "x", kindDetail: "grafana", version: "1", capabilities: ["read", "write"], scopes: ["view:operations"], views: ["operations"], enabled: true }).some((p) => /kun 'read'/.test(p)));
  assert.ok(adapterProblems({ id: "x", kindDetail: "grafana", version: "1", capabilities: ["write"], scopes: [], views: [], enabled: true }).length >= 3);
});

test("Grafana-, Loki- og Prometheus-adaptere giver samme underliggende view-status", async () => {
  const query = setup();
  const registryAdapters = createAdapterRegistry([createGrafanaAdapter({ query }), createLokiAdapter({ query }), createPrometheusAdapter({ query })]);
  const results = {};
  for (const id of ["grafana", "loki", "prometheus"]) {
    results[id] = await registryAdapters.render({ adapterId: id, principal: acmeOperator, view: "operations", now: NOW });
  }
  for (const r of Object.values(results)) {
    assert.equal(r.id, "operations");
    assert.equal(r.status, "pass");
    assert.equal(r.aggregates.availability, 0.99);
    assert.equal(r.scope.tenantId, "acme");
  }
  assert.ok(results.grafana.data.panels.length >= 1);
  assert.ok(Array.isArray(results.loki.data.streams));
  assert.ok(Array.isArray(results.prometheus.data.series));
});

test("en adapter kan udskiftes uden at ændre forretningsdata", async () => {
  const query = setup();
  const one = createAdapterRegistry([createGrafanaAdapter({ query })]);
  const two = createAdapterRegistry([createLokiAdapter({ query })]);
  const a = await one.render({ adapterId: "grafana", principal: acmeOperator, view: "operations", now: NOW });
  const b = await two.render({ adapterId: "loki", principal: acmeOperator, view: "operations", now: NOW });
  assert.deepEqual(a.aggregates, b.aggregates);
  assert.equal(a.status, b.status);
});

test("ukendt adapter og ukendt view afvises", async () => {
  const query = setup();
  const registryAdapters = createAdapterRegistry([createGrafanaAdapter({ query })]);
  await assert.rejects(() => registryAdapters.render({ adapterId: "finnes-ikke", principal: acmeOperator, view: "operations", now: NOW }), /ukendt dashboard-adapter/);
  await assert.rejects(() => registryAdapters.render({ adapterId: "grafana", principal: acmeOperator, view: "ai", now: NOW }), /understøtter ikke/);
});

test("adapterens læsning udløser samme tenant-spærring som API'et", async () => {
  const query = setup();
  const registryAdapters = createAdapterRegistry([createGrafanaAdapter({ query, view: "operations" })]);
  await assert.rejects(() => registryAdapters.render({ adapterId: "grafana", principal: acmeOperator, view: "operations", tenantId: "globex", now: NOW }), /tenant|kunde/);
});
