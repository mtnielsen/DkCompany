import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  validateTelemetryEnvelope,
  validateDashboardView,
  validateDashboardAdapter,
  validateCollectorStatus,
  validateTestRun,
  validateRecoveryStatus,
  dashboardViewProblems,
  testRunProblems,
  recoveryStatusProblems,
} from "../src/telemetry-api.mjs";
import { repoRoot } from "../src/schemas.mjs";
import { loadCollectorRegistry } from "../../telemetry-api/src/envelope.mjs";
import { collectorStatus } from "../../telemetry-api/src/collectors.mjs";
import { buildOperationsView } from "../../telemetry-api/src/views.mjs";

const example = (name) => JSON.parse(readFileSync(join(repoRoot, "contracts", "examples", name), "utf8"));
const registry = loadCollectorRegistry(repoRoot);
const NOW = Date.parse("2025-09-01T10:00:00Z");

test("de committede DKC-066-eksempler validerer med semantik", () => {
  assert.equal(validateTelemetryEnvelope(example("telemetry-envelope.example.json"), undefined, { now: Date.parse("2025-09-01T10:01:00Z"), registry }).ok, true);
  assert.equal(validateDashboardView(example("dashboard-view.example.json")).ok, true);
  assert.equal(validateDashboardAdapter(example("dashboard-adapter.example.json")).ok, true);
  assert.equal(validateCollectorStatus(example("collector-status.example.json")).ok, true);
  assert.equal(validateTestRun(example("test-run.example.json")).ok, true);
  assert.equal(validateRecoveryStatus(example("recovery-status.example.json")).ok, true);
});

test("en envelope med utroværdig kilde, fremtidstid eller kryds-tenant-relation afvises", () => {
  const base = example("telemetry-envelope.example.json");
  const opts = { now: Date.parse("2025-09-01T10:01:00Z"), registry };
  assert.equal(validateTelemetryEnvelope({ ...base, source: { id: "fraud", kind: "otel" } }, undefined, opts).ok, false);
  assert.equal(validateTelemetryEnvelope({ ...base, occurredAt: "2025-09-01T23:00:00Z" }, undefined, opts).ok, false);
  assert.equal(validateTelemetryEnvelope({ ...base, relations: { incident: "res://globex/incident/1" } }, undefined, opts).ok, false);
  assert.equal(validateTelemetryEnvelope({ ...base, schemaVersion: "2.0" }, undefined, opts).ok, false);
});

test("et tomt eller manglende view kan ikke være grønt", () => {
  const view = buildOperationsView({ records: [], tenantId: "acme", now: NOW, maxAgeSeconds: 300 });
  assert.ok(["missing", "unknown"].includes(view.status));
  assert.equal(view.lastObservedAt, null);
  assert.equal(validateDashboardView(view).ok, true);
  const faked = { ...view, status: "pass" };
  assert.equal(dashboardViewProblems(faked).some((p) => p.path === "/status"), true);
});

test("en adapter med skrivekapabilitet afvises", () => {
  const base = example("dashboard-adapter.example.json");
  assert.equal(validateDashboardAdapter({ ...base, capabilities: ["read", "write"] }).ok, false);
  assert.equal(validateDashboardAdapter({ ...base, capabilities: ["read"] }).ok, true);
});

test("den committede collector-status validerer og en pass for en forældet collector afvises", () => {
  const status = collectorStatus({ registry, observations: Object.fromEntries(registry.sources.map((s) => [s.id, { lastSeenAt: new Date(NOW).toISOString() }])), now: NOW });
  assert.equal(validateCollectorStatus(status).ok, true);
  const broken = { ...status, collectors: status.collectors.map((c) => (c.id === "otel-collector" ? { ...c, freshness: "stale", status: "pass" } : c)) };
  assert.equal(validateCollectorStatus(broken).ok, false);
});

test("en 'passed' testkørsel med fejlede checks afvises, og en fejlet check kræver ejer", () => {
  const base = example("test-run.example.json");
  const failed = { ...base, result: "failed", checks: [...base.checks, { id: "x", status: "fail", owner: { subject: "oidc|anna.andersen", name: "Anna Andersen", role: "Platform Owner" } }] };
  assert.equal(validateTestRun(failed).ok, true);
  assert.equal(validateTestRun({ ...failed, result: "passed" }).ok, false);
  assert.equal(testRunProblems({ ...failed, checks: [{ id: "x", status: "fail", owner: { subject: "team|oncall" } }] }).some((p) => /ejer/.test(p.message)), true);
});

test("en 'pass'-recovery kræver målte tal inden for målene", () => {
  const base = example("recovery-status.example.json");
  assert.equal(validateRecoveryStatus(base).ok, true);
  assert.equal(validateRecoveryStatus({ ...base, measured: { dataLossMinutes: null, restoreMinutes: null } }).ok, false);
  assert.equal(recoveryStatusProblems({ ...base, measured: { dataLossMinutes: 99, restoreMinutes: 10 } }).some((p) => /RPO/.test(p.message)), true);
});
