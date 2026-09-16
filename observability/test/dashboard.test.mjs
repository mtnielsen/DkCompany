import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildPrometheusRules, buildModuleSloDashboard, buildAgentDashboard, sloTargets } from "../src/generate.mjs";
import { loadModules, repoRoot, check } from "../src/cli.mjs";

const modules = loadModules();
const targets = sloTargets(modules);

test("sloTargets udtrækker ét SLO pr. modul med slo-blok, sorteret", () => {
  const expected = modules.filter((m) => m.manifest.slo).map((m) => m.manifest.metadata.name).sort();
  assert.deepEqual(targets.map((t) => t.name), expected);
  assert.ok(targets.length >= 3, "forventer mindst tre moduler med SLO");
  for (const t of targets) {
    assert.equal(typeof t.availability, "number");
    assert.equal(typeof t.latencyP95Ms, "number");
  }
});

test("Prometheus-regler dækker hvert moduls SLO og agentlaget", () => {
  const rules = buildPrometheusRules(modules);
  const names = rules.groups.flatMap((g) => g.rules.map((r) => r.alert ?? r.record));
  for (const t of targets) {
    assert.ok(names.includes("ModuleAvailabilityBelowSLO"), "manglende availability-alert");
    assert.ok(names.includes("ModuleLatencyAboveSLO"), "manglende latency-alert");
  }
  const availability = rules.groups
    .flatMap((g) => g.rules)
    .filter((r) => r.alert === "ModuleAvailabilityBelowSLO");
  assert.equal(availability.length, targets.length);
  const audit = availability.find((r) => r.labels.module === "audit-service");
  assert.match(audit.expr, /< 0\.9995$/);
  assert.match(audit.annotations.description, /99\.95 %/);

  for (const alert of ["AgentEscalationSpike", "AgentBudgetExceeded", "AgentGatewayBypassDetected"]) {
    assert.ok(names.includes(alert), `mangler agent-alert ${alert}`);
  }
});

test("modul-dashboardet har SLO-tabel og et panel pr. modul", () => {
  const dashboard = buildModuleSloDashboard(modules);
  const text = dashboard.panels.find((p) => p.type === "text");
  for (const t of targets) {
    assert.match(text.options.content, new RegExp(t.name));
    assert.ok(dashboard.panels.some((p) => p.title.startsWith(`${t.name} — tilgængelighed`)), `mangler availability-panel for ${t.name}`);
    assert.ok(dashboard.panels.some((p) => p.title.startsWith(`${t.name} — p95-latens`)), `mangler latency-panel for ${t.name}`);
  }
  const availability = dashboard.panels.find((p) => p.title === "audit-service — tilgængelighed");
  const steps = availability.fieldConfig.defaults.thresholds.steps;
  assert.deepEqual(steps[steps.length - 1], { color: "green", value: 0.9995 });
});

test("agent-dashboardet gør agenthandlinger førsteklassede og har et Loki-view", () => {
  const dashboard = buildAgentDashboard();
  const titles = dashboard.panels.map((p) => p.title);
  for (const expected of [
    "Agenthandlinger (1t)",
    "Eskaleringer (1t)",
    "Budgetoverskridelser (1t)",
    "Kald uden om gateway (1t)",
    "Handlinger pr. agent",
    "Handlinger pr. verbum",
  ]) {
    assert.ok(titles.includes(expected), `mangler panel '${expected}'`);
  }
  assert.ok(dashboard.panels.some((p) => p.type === "logs" && p.datasource.type === "loki"), "mangler Loki-logpanel");
});

test("de genererede GitOps-configmaps er i trit med modulets SLO", () => {
  assert.doesNotThrow(() => check());
  const files = ["observability-prometheus-rules.json", "observability-grafana-dashboards.json"];
  for (const file of files) {
    const path = join(repoRoot, "gitops", "manifests", "dev", file);
    const data = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(data.kind, "ConfigMap");
    assert.equal(data.metadata.labels["platform.example.org/module"], "observability");
    for (const value of Object.values(data.data)) JSON.parse(value);
  }
});
