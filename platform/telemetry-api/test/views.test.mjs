import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOperationsView, buildVulnerabilitiesView, buildTestReleaseView, buildRecoveryView, buildAiView, buildView } from "../src/views.mjs";

const NOW = Date.parse("2025-09-01T10:00:00Z");
const iso = (offsetMs = 0) => new Date(NOW + offsetMs).toISOString();
const metric = (name, value, { at = iso(-30000), labels = {} } = {}) => ({ signal: "metric", occurredAt: at, scope: { tenantId: "acme" }, resource: "res://acme/service/dummy-ok", labels, otel: { metric: { name, value } } });

test("driftsviewet beregner tilgængelighed, latens og fejlrate", () => {
  const view = buildOperationsView({ records: [metric("http_requests_total", 1000, { labels: { status: "200" } }), metric("http_errors_total", 5, { labels: { status: "500" } }), metric("http_request_duration_p95_seconds", 0.4)], tenantId: "acme", now: NOW, maxAgeSeconds: 300 });
  assert.equal(view.status, "pass");
  assert.equal(view.aggregates.availability, 0.995);
  assert.equal(view.aggregates.latencyP95Seconds, 0.4);
  assert.equal(view.aggregates.errorRate, 0.005);
  assert.equal(view.lastObservedAt, iso(-30000));
});

test("manglende eller forældede signaler giver ikke grøn status", () => {
  const empty = buildOperationsView({ records: [], tenantId: "acme", now: NOW, maxAgeSeconds: 300 });
  assert.ok(["missing", "unknown"].includes(empty.status));
  assert.equal(empty.lastObservedAt, null);
  const stale = buildOperationsView({ records: [metric("http_requests_total", 10, { at: iso(-3600 * 1000) })], tenantId: "acme", now: NOW, maxAgeSeconds: 300 });
  assert.equal(stale.status, "stale");
  assert.equal(stale.lastObservedAt, iso(-3600 * 1000));
});

test("syntetiske CVE-fund vises med ejer og evidens", () => {
  const finding = (overrides) => ({
    signal: "finding",
    occurredAt: iso(-60000),
    scope: { tenantId: "acme" },
    resource: "res://acme/service/dummy-ok",
    ref: { contract: "security-findings", id: "SEC-1", uri: "security/raw/trivy-app.json", digest: "a".repeat(64) },
    payload: { cve: "CVE-2025-0001", severity: "critical", title: "kritisk sårbarhed", owner: { subject: "oidc|cecilia.christensen", name: "Cecilia Christensen", role: "Security Owner" }, status: "open", remediation: "opgrader" },
    ...overrides,
  });
  const critical = buildVulnerabilitiesView({ records: [finding()], tenantId: "acme", now: NOW });
  assert.equal(critical.status, "fail");
  assert.equal(critical.items[0].owner.subject, "oidc|cecilia.christensen");
  assert.equal(critical.items[0].evidence[0].sha256, "a".repeat(64));
  const clean = buildVulnerabilitiesView({ records: [], tenantId: "acme", now: NOW });
  assert.equal(clean.status, "missing");
  assert.equal(clean.lastObservedAt, null);
  const noOwner = buildVulnerabilitiesView({ records: [finding({ payload: { cve: "CVE-2", severity: "low", status: "open" } })], tenantId: "acme", now: NOW });
  assert.equal(noOwner.status, "partial");
});

test("en fejlet test vises med ejer og kan ikke skjules som grøn", () => {
  const run = {
    signal: "test-run",
    occurredAt: iso(-60000),
    scope: { tenantId: "acme" },
    resource: "res://acme/test-run/run-1",
    payload: {
      id: "run-1",
      result: "failed",
      checks: [
        { id: "monitoring-test", status: "fail", owner: { subject: "oidc|anna.andersen", name: "Anna Andersen", role: "Platform Owner" } },
        { id: "lint", status: "pass", owner: { subject: "oidc|anna.andersen", name: "Anna Andersen", role: "Platform Owner" } },
      ],
    },
  };
  const view = buildTestReleaseView({ records: [run], tenantId: "acme", now: NOW });
  assert.equal(view.status, "fail");
  assert.equal(view.aggregates.failed, 1);
  assert.equal(view.items[0].failedChecks[0], "monitoring-test");
  assert.equal(view.items[0].checks[0].owner.subject, "oidc|anna.andersen");
});

test("en erklæret recovery uden målte tal er ikke grøn", () => {
  const declared = { signal: "recovery", occurredAt: iso(-60000), scope: { tenantId: "acme" }, payload: { gate: "pass", serviceClass: "tier-1", targets: { rpoMinutes: 5, rtoMinutes: 30 }, measured: { dataLossMinutes: null, restoreMinutes: null } } };
  const view = buildRecoveryView({ records: [declared], tenantId: "acme", now: NOW });
  assert.equal(view.status, "unknown");
  assert.notEqual(view.status, "pass");
  const measured = { ...declared, payload: { ...declared.payload, measured: { dataLossMinutes: 1, restoreMinutes: 10 } } };
  const ok = buildRecoveryView({ records: [measured], tenantId: "acme", now: NOW });
  assert.equal(ok.status, "pass");
});

test("AI-viewet løfter bypass og godkendelser frem", () => {
  const action = (overrides) => ({ signal: "agent-action", occurredAt: iso(-30000), scope: { tenantId: "acme" }, payload: { verb: "upgrade.patch", decision: "allow", cost: 1.5, ...overrides } });
  const view = buildAiView({ records: [action({}), action({ decision: "bypass" })], tenantId: "acme", now: NOW });
  assert.equal(view.status, "fail");
  assert.equal(view.aggregates.actions, 2);
  assert.equal(view.aggregates.costTotal, 3);
  const clean = buildAiView({ records: [action({})], tenantId: "acme", now: NOW });
  assert.equal(clean.status, "pass");
  const missing = buildAiView({ records: [], tenantId: "acme", now: NOW });
  assert.equal(missing.status, "missing");
});

test("buildView dispatcher til det rigtige view", () => {
  assert.equal(buildView("operations", { records: [], tenantId: "acme", now: NOW }).view, "operations");
  assert.throws(() => buildView("ukendt", {}), /ukendt view/);
});
