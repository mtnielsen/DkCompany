import { test } from "node:test";
import assert from "node:assert/strict";
import { collectorStatus, collectorStatusProblems, groupAlerts, verifyAuditUnaffected } from "../src/collectors.mjs";
import { createBoundedStore } from "../src/store.mjs";
import { registry, NOW } from "./support/fixtures.mjs";

const iso = (offset = 0) => new Date(NOW + offset).toISOString();

test("collector-status skelner frisk, forældet og fejl", () => {
  const fresh = collectorStatus({ registry, observations: { "otel-collector": { lastSeenAt: iso(-10) }, "trivy-ci": { lastSeenAt: iso(-10) }, "release-gate": { lastSeenAt: iso(-10) }, "backup-drill": { lastSeenAt: iso(-10) }, "agent-runtime": { lastSeenAt: iso(-10) } }, now: NOW });
  assert.equal(fresh.overall, "pass");
  assert.equal(fresh.collectors.find((c) => c.id === "otel-collector").freshness, "fresh");

  const overdue = collectorStatus({ registry, observations: { "otel-collector": { lastSeenAt: iso(-3600 * 1000) }, "trivy-ci": { lastSeenAt: iso(-10) }, "release-gate": { lastSeenAt: iso(-10) }, "backup-drill": { lastSeenAt: iso(-10) }, "agent-runtime": { lastSeenAt: iso(-10) } }, now: NOW });
  assert.equal(overdue.overall, "stale");
  assert.equal(overdue.collectors.find((c) => c.id === "otel-collector").status, "stale");

  const down = collectorStatus({ registry, observations: { "otel-collector": { lastError: "nedbrud" } }, now: NOW });
  assert.equal(down.overall, "fail");
});

test("overload og afviste hændelser giver partial og tælles", () => {
  const overloaded = collectorStatus({ registry, observations: { "otel-collector": { lastSeenAt: iso(-10), backpressure: 5, rejected: 2 }, "trivy-ci": { lastSeenAt: iso(-10) }, "release-gate": { lastSeenAt: iso(-10) }, "backup-drill": { lastSeenAt: iso(-10) }, "agent-runtime": { lastSeenAt: iso(-10) } }, now: NOW });
  const collector = overloaded.collectors.find((c) => c.id === "otel-collector");
  assert.equal(collector.status, "partial");
  assert.equal(collector.backpressure, 5);
  assert.equal(collector.rejected, 2);
  assert.equal(overloaded.overall, "partial");
  assert.deepEqual(collectorStatusProblems(overloaded), []);
});

test("collector-statusproblemer fanger pass for en ikke-frisk collector", () => {
  const broken = { overall: "pass", collectors: [{ id: "x", kind: "otel", status: "pass", freshness: "stale", drops: 0, backpressure: 0, rejected: 0 }] };
  assert.ok(collectorStatusProblems(broken).length > 0);
});

test("alarmgruppering samler ens hændelser og bevarer ejer/eskalation", () => {
  const alert = (id, at) => ({
    ruleId: "service-unavailable",
    severity: "critical",
    tenantId: "acme",
    signal: "service.availability",
    owner: { subject: "oidc|anna.andersen", name: "Anna Andersen", role: "Platform Owner" },
    escalation: [{ afterMinutes: 10, to: { subject: "oidc|bo.bertelsen", name: "Bo Bertelsen", role: "Platform Owner" } }],
    runbook: "docs/runbooks/alerting.md",
    recipients: [{ id: "platform-oncall-local", type: "local-mailbox" }],
    summary: "nede",
    observed: { sensorId: "service-availability" },
    detectedAt: at,
  });
  const groups = groupAlerts([alert("a1", iso(-1000)), alert("a2", iso()), { ...alert("a3", iso()), ruleId: "backup-failed", observed: { sensorId: "backup-drill" } }]);
  assert.equal(groups.length, 2);
  const service = groups.find((g) => g.ruleId === "service-unavailable");
  assert.equal(service.count, 2);
  assert.equal(service.owner.subject, "oidc|anna.andersen");
  assert.equal(service.escalation[0].to.subject, "oidc|bo.bertelsen");
  assert.equal(service.firstSeenAt, iso(-1000));
});

test("telemetritab deaktiverer ikke den obligatoriske audit", () => {
  const store = createBoundedStore({ capacity: 3, retentionSeconds: 86400, clock: () => NOW });
  const audit = [];
  const auditAppend = (event) => {
    audit.push(event);
    return `audit-${audit.length}`;
  };
  const result = verifyAuditUnaffected({ store, auditAppend, now: NOW });
  assert.ok(result.telemetryDropped > 0);
  assert.equal(result.auditOk, true);
  assert.equal(audit.length, 1);
});
