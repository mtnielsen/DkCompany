import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadAlertRules,
  alertRuleSetProblems,
  evaluateCondition,
  evaluateAlerts,
  buildNotification,
  createIncident,
  appendIncidentEvent,
  currentEscalationTarget,
  escalateIncident,
  dispatchAlerts,
  createLocalMailbox,
  createWebhookTransport,
} from "../src/alerts.mjs";
import { alertNotificationProblems } from "../../conformance/src/monitoring.mjs";

const root = new URL("../..", import.meta.url).pathname;
const rules = loadAlertRules(root);
const registry = JSON.parse(readFileSync(join(root, "observability", "sensors.json"), "utf8"));
const now = Date.parse("2025-09-01T12:00:00Z");

function postureWith(readingOverrides = {}) {
  const at = new Date(now).toISOString();
  const reading = (id, source, kind, extra = {}) => ({
    id,
    source,
    kind,
    capturedAt: at,
    ageSeconds: 0,
    freshness: "fresh",
    status: "pass",
    required: true,
    runbook: "docs/runbooks/alerting.md",
    ...extra,
  });
  return {
    sensors: [
      reading("service-availability", "prometheus", "metrics", { value: 1, ...readingOverrides["service-availability"] }),
      reading("backup-drill", "backup", "backup", readingOverrides["backup-drill"] ?? {}),
      reading("trivy-fs", "trivy", "scanner", readingOverrides["trivy-fs"] ?? {}),
      reading("audit-journal", "audit-journal", "log", readingOverrides["audit-journal"] ?? {}),
      reading("credential-revocation", "credentials", "credentials", readingOverrides["credential-revocation"] ?? {}),
      reading("falco-runtime", "falco", "runtime", {}),
      reading("wazuh-siem", "wazuh", "runtime", {}),
    ],
  };
}

test("alarmreglerne er semantisk gyldige og peger på kendte sensorer og modtagere", () => {
  const sensorIds = new Set(registry.sensors.map((s) => s.id));
  const recipientIds = new Set(rules.rules.flatMap((r) => r.recipients.map((x) => x.id)));
  assert.equal(alertRuleSetProblems(rules, { root, sensorIds, recipientIds }).length, 0);
  assert.ok(rules.rules.every((r) => r.owner.subject.startsWith("oidc|")));
});

test("evaluateCondition håndterer tærskel, status, stale og manglende", () => {
  assert.equal(evaluateCondition({ operator: "lt", threshold: 0.999 }, { value: 0.5, freshness: "fresh" }).triggered, true);
  assert.equal(evaluateCondition({ operator: "lt", threshold: 0.999 }, { value: 1, freshness: "fresh" }).triggered, false);
  assert.equal(evaluateCondition({ operator: "not-pass" }, { status: "fail", freshness: "fresh" }).triggered, true);
  assert.equal(evaluateCondition({ operator: "not-pass" }, { status: "pass", freshness: "fresh" }).triggered, false);
  assert.equal(evaluateCondition({ operator: "stale" }, { freshness: "stale" }).triggered, true);
  assert.equal(evaluateCondition({ operator: "stale" }, { freshness: "missing" }).triggered, true);
});

test("en fremkaldt tjenestefejl og backupfejl udløser alarmer med ejer, eskalation og runbook", () => {
  const posture = postureWith({
    "service-availability": { status: "fail", value: 0.0 },
    "backup-drill": { status: "fail" },
  });
  const alerts = evaluateAlerts({ rules, posture, now, tenantId: "acme" });
  const byRule = Object.fromEntries(alerts.map((a) => [a.ruleId, a]));
  assert.ok(byRule["service-unavailable"]);
  assert.ok(byRule["backup-failed"]);
  assert.equal(byRule["service-unavailable"].owner.subject, "oidc|anna.andersen");
  assert.ok(byRule["service-unavailable"].escalation.length >= 1);
  assert.equal(byRule["service-unavailable"].runbook, "docs/runbooks/alerting.md");
  assert.equal(byRule["service-unavailable"].tenantId, "acme");
});

test("en forældet sikkerhedssensor udløser en ikke-grøn alarm", () => {
  const posture = postureWith({ "trivy-fs": { freshness: "stale", status: "stale", capturedAt: "2025-08-01T00:00:00Z" } });
  const alerts = evaluateAlerts({ rules, posture, now, tenantId: "acme" });
  assert.ok(alerts.some((a) => a.ruleId === "security-data-stale"));
});

test("notifikationen er minimeret og bærer ikke rå persondata", () => {
  const alert = {
    id: "alert-1",
    ruleId: "service-unavailable",
    signal: "service.availability",
    severity: "critical",
    tenantId: "acme",
    owner: { subject: "oidc|anna.andersen", name: "Anna Andersen", role: "Platform Owner" },
    escalation: [{ afterMinutes: 10, to: { subject: "oidc|bo.bertelsen", name: "Bo Bertelsen", role: "Platform Owner" } }],
    runbook: "docs/runbooks/alerting.md",
    recipients: [{ id: "platform-oncall-local", type: "local-mailbox" }],
    summary: "Tjenesten er nede",
    observed: { value: 0, status: "fail", freshness: "fresh", capturedAt: new Date(now).toISOString(), ageSeconds: 0, email: "kunde@example.org" },
    reason: "0 < 0.999",
  };
  const notification = buildNotification(alert, { now });
  assert.equal(notification.minimized, true);
  assert.equal(notification.observed.email, "[MINIMIZED]");
  assert.equal(alertNotificationProblems(notification).length, 0);
});

test("hændelsesforløbet eskalerer og afviser rå persondata", () => {
  const alert = {
    id: "alert-2",
    ruleId: "service-unavailable",
    severity: "critical",
    owner: { subject: "oidc|anna.andersen", name: "Anna Andersen", role: "Platform Owner" },
    escalation: [{ afterMinutes: 10, to: { subject: "oidc|bo.bertelsen", name: "Bo Bertelsen", role: "Platform Owner" } }],
    runbook: "docs/runbooks/alerting.md",
    recipients: [{ id: "platform-oncall-local", type: "local-mailbox" }],
    summary: "Tjenesten er nede",
    observed: {},
    reason: "x",
  };
  let incident = createIncident(alert, { now });
  incident = appendIncidentEvent(incident, { type: "acknowledged", at: new Date(now).toISOString(), actor: "oidc|anna.andersen", detail: "undersøger", data: { email: "kunde@example.org" } });
  const target = currentEscalationTarget(incident, { now: now + 15 * 60 * 1000 });
  assert.equal(target.target.subject, "oidc|bo.bertelsen");
  incident = escalateIncident(incident, { now: now + 15 * 60 * 1000 });
  assert.ok(incident.timeline.some((e) => e.type === "escalated"));
  assert.equal(incident.timeline.find((e) => e.type === "acknowledged").personalData.removed.includes("/email"), true);
  assert.throws(() => appendIncidentEvent(incident, { type: "note", detail: "ring til kunde@example.org" }), /persondata/);
});

test("alarmer leveres til en lokal testmodtager og til webhook som not-run uden endpoint", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dkc-monitoring-"));
  try {
    const posture = postureWith({ "service-availability": { status: "fail", value: 0 } });
    const alerts = evaluateAlerts({ rules, posture, now, tenantId: "acme" });
    const mailbox = createLocalMailbox({ dir });
    const webhook = createWebhookTransport({ url: null });
    const { notifications } = await dispatchAlerts({ alerts, transports: (r) => (r?.type === "webhook" ? webhook : mailbox), now, outDir: dir });
    const service = notifications.find((n) => n.ruleId === "service-unavailable");
    assert.equal(service.delivery.status, "delivered");
    assert.equal(service.delivery.recipientId, "platform-oncall-local");
    assert.ok(existsSync(join(dir, "notifications", `${service.id}.json`)));
    assert.match(service.delivery.receipt, /^local:/);

    const direct = createWebhookTransport({ url: null });
    const r = await direct.deliver(buildNotification(alerts[0], { now }));
    assert.equal(r.status, "not-run");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
