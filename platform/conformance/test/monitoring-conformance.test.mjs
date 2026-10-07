import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  telemetryRecordProblems,
  alertNotificationProblems,
  securityPostureProblems,
  sensorRegistryProblems,
  alertRuleSetProblems,
} from "../src/monitoring.mjs";
import { repoRoot } from "../src/schemas.mjs";

const sensorRegistry = JSON.parse(readFileSync(join(repoRoot, "observability", "sensors.json"), "utf8"));
const alertRules = JSON.parse(readFileSync(join(repoRoot, "observability", "alert-rules.json"), "utf8"));

const telemetry = {
  apiVersion: "contracts.platform/v1alpha1",
  kind: "TelemetryRecord",
  id: "tel-1",
  signal: "metric",
  tenantId: "acme",
  source: { type: "metric", name: "prometheus" },
  capturedAt: "2025-09-01T10:00:00Z",
  minimized: true,
  subject: { kind: "service", name: "module:dummy-ok" },
  metric: { name: "http_requests_total", value: 1 },
  attributes: { email: "[MINIMIZED]" },
  personalData: { removed: ["attributes/email"], digest: "0".repeat(64) },
};

test("en minimeret telemetri-post accepteres", () => {
  assert.equal(telemetryRecordProblems(telemetry, { now: Date.parse("2025-09-01T11:00:00Z") }).length, 0);
});

test("en ikke-minimeret post eller rå personidentifikator afvises", () => {
  assert.ok(telemetryRecordProblems({ ...telemetry, minimized: false }).some((p) => p.path === "/minimized"));
  assert.ok(telemetryRecordProblems({ ...telemetry, subject: { kind: "human", name: "kunde@example.org" } }).some((p) => p.path === "/subject/name"));
  assert.ok(telemetryRecordProblems({ ...telemetry, signal: "trace", metric: undefined }).length > 0);
});

test("et gyldigt sensorkatalog og regelsæt accepteres", () => {
  assert.equal(sensorRegistryProblems(sensorRegistry, { root: repoRoot }).length, 0);
  const sensorIds = new Set(sensorRegistry.sensors.map((s) => s.id));
  const recipientIds = new Set(alertRules.rules.flatMap((r) => r.recipients.map((x) => x.id)));
  assert.equal(alertRuleSetProblems(alertRules, { root: repoRoot, sensorIds, recipientIds }).length, 0);
});

test("en regel med ukendt sensor, ejer eller ikke-stigende eskalation afvises", () => {
  const broken = JSON.parse(JSON.stringify(alertRules));
  broken.rules[0].sensor = "finnes-ikke";
  broken.rules[0].owner = { subject: "team|oncall", name: "Team", role: "Team" };
  broken.rules[0].escalation = [
    { afterMinutes: 30, to: broken.rules[0].owner },
    { afterMinutes: 10, to: broken.rules[0].owner },
  ];
  const problems = alertRuleSetProblems(broken, { root: repoRoot, sensorIds: new Set(sensorRegistry.sensors.map((s) => s.id)) });
  assert.ok(problems.some((p) => p.path === "/rules/0/sensor"));
  assert.ok(problems.some((p) => p.path === "/rules/0/owner"));
  assert.ok(problems.some((p) => p.path.endsWith("/afterMinutes")));
});

test("en notifikation med rå persondata eller manglende ejer afvises", () => {
  const base = {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "AlertNotification",
    id: "n1",
    alertId: "a1",
    ruleId: "service-unavailable",
    severity: "critical",
    signal: "service.availability",
    summary: "Tjenesten er nede",
    owner: { subject: "oidc|anna.andersen", name: "Anna Andersen", role: "Platform Owner" },
    escalation: [{ afterMinutes: 10, to: { subject: "oidc|bo.bertelsen", name: "Bo Bertelsen", role: "Platform Owner" } }],
    runbook: "docs/runbooks/alerting.md",
    emittedAt: "2025-09-01T10:00:00Z",
    minimized: true,
    personalData: { removed: [], digest: "0".repeat(64) },
    observed: { email: "[MINIMIZED]" },
    delivery: { recipientId: "local", transport: "local-mailbox", status: "delivered", receipt: "local:1", deliveredAt: "2025-09-01T10:00:01Z" },
  };
  assert.equal(alertNotificationProblems(base).length, 0);
  assert.ok(alertNotificationProblems({ ...base, summary: "Ring til kunde@example.org" }).some((p) => p.path === "/summary"));
  assert.ok(alertNotificationProblems({ ...base, owner: { subject: "team|oncall" } }).some((p) => p.path === "/owner"));
  assert.ok(alertNotificationProblems({ ...base, observed: { email: "kunde@example.org" } }).some((p) => p.path.startsWith("/observed")));
});

test("en sikkerhedsstatus med stale/missing må ikke være pass", () => {
  const sensor = (id, freshness, status) => ({ id, source: "x", kind: "scanner", capturedAt: "2025-09-01T10:00:00Z", ageSeconds: 0, freshness, status, required: true, runbook: "docs/runbooks/alerting.md" });
  const base = { apiVersion: "contracts.platform/v1alpha1", kind: "SecurityPosture", generatedAt: "2025-09-01T10:00:00Z", staleSensorIds: [], missingSensorIds: [], findings: { critical: 0, high: 0, medium: 0, low: 0, total: 0 } };
  const pass = { ...base, overall: "pass", sensors: [sensor("a", "fresh", "pass")] };
  assert.equal(securityPostureProblems(pass).length, 0);

  const stale = { ...base, overall: "pass", sensors: [sensor("a", "stale", "stale")], staleSensorIds: ["a"] };
  assert.ok(securityPostureProblems(stale).some((p) => p.path === "/overall"));

  const consistent = { ...base, overall: "stale", sensors: [sensor("a", "stale", "stale")], staleSensorIds: ["a"] };
  assert.equal(securityPostureProblems(consistent).length, 0);

  const wrongList = { ...consistent, staleSensorIds: [] };
  assert.ok(securityPostureProblems(wrongList).some((p) => p.path === "/staleSensorIds"));
});
