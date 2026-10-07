/**
 * DKC-066 — views for drift, sårbarheder, test/release, recovery og AI.
 *
 * Hvert view er en tenant-scopet, autoriseret projektion af de indtagne
 * signaler. Fælles regler:
 *
 *   - `late`-markerede hændelser indgår ikke i friskhed eller pass,
 *   - manglende signaler giver `unknown`/`missing` med `lastObservedAt` — aldrig
 *     en stiltiende grøn,
 *   - et view bærer kun strukturerede fakta (ingen rå persondata); følsomme
 *     felter fjernes senere af autorisationslaget,
 *   - et view ændrer ikke tilstand og har ingen udførelsesmyndighed.
 */
import { freshnessFor, statusForReading, overallStatus } from "../../observability/src/freshness.mjs";

export const VIEW_SCHEMA_VERSION = "1.0";

function freshest(records, { now, maxAgeSeconds }) {
  let newest = null;
  for (const r of records) {
    const t = Date.parse(r.occurredAt);
    if (Number.isFinite(t) && (newest === null || t > newest)) newest = t;
  }
  if (newest === null) return { freshness: "missing", lastObservedAt: null, ageSeconds: null };
  const iso = new Date(newest).toISOString();
  return { ...freshnessFor({ capturedAt: iso, maxAgeSeconds, now }), lastObservedAt: iso };
}

function baseView({ view, tenantId, environment = null, service = null, now, windowSeconds, records }) {
  const end = new Date(now).toISOString();
  return {
    schemaVersion: VIEW_SCHEMA_VERSION,
    kind: "DashboardView",
    view,
    generatedAt: end,
    scope: { tenantId, environment, service },
    lastObservedAt: null,
    windowStart: new Date(now - windowSeconds * 1000).toISOString(),
    windowEnd: end,
    series: [],
    items: [],
    aggregates: {},
    cardinality: { series: 0, dropped: 0 },
    redactions: [],
    partial: false,
    notes: [],
    _records: records,
  };
}

function stripInternal(view) {
  const { _records, ...rest } = view;
  void _records;
  return rest;
}

function metricSeries(records) {
  const byMetric = new Map();
  for (const r of records) {
    const name = r.otel?.metric?.name;
    if (!name) continue;
    if (!byMetric.has(name)) byMetric.set(name, { metric: name, unit: r.otel.metric.unit ?? null, points: [] });
    byMetric.get(name).points.push({ at: r.occurredAt, value: Number(r.otel.metric.value) });
  }
  for (const series of byMetric.values()) series.points.sort((a, b) => a.at.localeCompare(b.at));
  return [...byMetric.values()];
}

/** Drift: tilgængelighed, latens, fejl og kapacitet fra OTel-metrikker. */
export function buildOperationsView({ records = [], tenantId, environment = null, service = null, now = Date.now(), windowSeconds = 3600, maxAgeSeconds = 300 } = {}) {
  const view = baseView({ view: "operations", tenantId, environment, service, now, windowSeconds, records });
  const metrics = records.filter((r) => r.signal === "metric" && !r.late);
  view.series = metricSeries(metrics);
  view.cardinality.series = view.series.length;
  const fresh = freshest(metrics, { now, maxAgeSeconds });
  view.lastObservedAt = fresh.lastObservedAt;

  const value = (name) => view.series.find((s) => s.metric === name)?.points.at(-1)?.value ?? null;
  const requests = value("http_requests_total");
  const errors = value("http_errors_total");
  view.aggregates = {
    availability: requests !== null && errors !== null && requests > 0 ? Math.max(0, 1 - errors / requests) : null,
    latencyP95Seconds: value("http_request_duration_p95_seconds"),
    errorRate: requests !== null && errors !== null && requests > 0 ? errors / requests : null,
    capacityRatio: value("container_cpu_usage_ratio"),
    requests,
    errors,
  };
  let findingsStatus = null;
  if (view.aggregates.errorRate !== null && view.aggregates.errorRate > 0.05) findingsStatus = "fail";
  else if (view.aggregates.errorRate !== null && view.aggregates.errorRate > 0.01) findingsStatus = "partial";
  else if (view.aggregates.capacityRatio !== null && view.aggregates.capacityRatio > 0.9) findingsStatus = "partial";
  else if (view.series.length > 0) findingsStatus = "pass";
  view.status = statusForReading({ freshness: fresh.freshness, findingsStatus });
  if (fresh.freshness !== "fresh") view.notes.push("Ingen frisk driftsmetrik; status er ikke grøn.");
  return stripInternal(view);
}

/** Sårbarheder: CVE'er og afhjælpning med ejer og evidens. */
export function buildVulnerabilitiesView({ records = [], tenantId, environment = null, now = Date.now(), windowSeconds = 7 * 86400, maxAgeSeconds = 86400 } = {}) {
  const view = baseView({ view: "vulnerabilities", tenantId, environment, now, windowSeconds, records });
  const findings = records.filter((r) => r.signal === "finding" && !r.late);
  view.items = findings
    .map((r) => ({
      id: r.payload?.cve ?? r.ref?.id ?? r.id,
      severity: r.payload?.severity ?? "unknown",
      title: r.payload?.title ?? "",
      owner: r.payload?.owner ?? null,
      remediation: r.payload?.remediation ?? null,
      status: r.payload?.status ?? "open",
      resource: r.resource,
      evidence: r.ref ? [{ uri: r.ref.uri ?? `ref:${r.ref.contract}/${r.ref.id}`, sha256: r.ref.digest ?? null }] : [],
      occurredAt: r.occurredAt,
    }))
    .sort((a, b) => String(a.severity).localeCompare(String(b.severity)));
  const open = view.items.filter((i) => i.status !== "resolved" && i.status !== "accepted");
  const criticalHigh = open.filter((i) => i.severity === "critical" || i.severity === "high");
  const mediumLow = open.filter((i) => i.severity === "medium" || i.severity === "low");
  view.aggregates = { critical: criticalHigh.filter((i) => i.severity === "critical").length, high: criticalHigh.filter((i) => i.severity === "high").length, medium: mediumLow.filter((i) => i.severity === "medium").length, low: mediumLow.filter((i) => i.severity === "low").length, open: open.length, total: view.items.length };
  const fresh = freshest(findings, { now, maxAgeSeconds });
  view.lastObservedAt = fresh.lastObservedAt;
  const findingsStatus = criticalHigh.length ? "fail" : mediumLow.length ? "partial" : view.items.length ? "pass" : null;
  view.status = statusForReading({ freshness: fresh.freshness, findingsStatus });
  // Ejerskab mangler = ikke en gyldig grøn.
  if (view.status === "pass" && open.some((i) => !i.owner)) {
    view.status = "partial";
    view.notes.push("Åbne fund uden navngivet ejer kan ikke give grøn status.");
  }
  return stripInternal(view);
}

/** Test/release: testkørsler og release-status med ejer og evidens. */
export function buildTestReleaseView({ records = [], tenantId, environment = null, now = Date.now(), windowSeconds = 30 * 86400, maxAgeSeconds = 30 * 86400 } = {}) {
  const view = baseView({ view: "test-release", tenantId, environment, now, windowSeconds, records });
  const runs = records.filter((r) => r.signal === "test-run" && !r.late).map((r) => ({ ...(r.payload ?? {}), occurredAt: r.occurredAt, resource: r.resource }));
  view.items = runs.map((r) => ({
    id: r.id,
    result: r.result,
    environment: r.environment,
    targetCommit: r.targetCommit,
    artifactDigest: r.artifactDigest ?? null,
    producer: r.producer ?? null,
    checks: (r.checks ?? []).map((c) => ({ id: c.id, status: c.status, owner: c.owner, evidence: c.evidence ?? [] })),
    failedChecks: (r.checks ?? []).filter((c) => c.status === "fail").map((c) => c.id),
    occurredAt: r.occurredAt,
  }));
  const failed = view.items.filter((r) => r.result === "failed" || (r.failedChecks ?? []).length > 0);
  const passed = view.items.filter((r) => r.result === "passed");
  view.aggregates = { runs: view.items.length, passed: passed.length, failed: failed.length, notRun: view.items.filter((r) => r.result === "not-run").length };
  const fresh = freshest(records.filter((r) => r.signal === "test-run"), { now, maxAgeSeconds });
  view.lastObservedAt = fresh.lastObservedAt;
  const findingsStatus = failed.length ? "fail" : view.items.length ? "pass" : null;
  view.status = statusForReading({ freshness: fresh.freshness, findingsStatus });
  if (view.status === "pass" && failed.some((r) => (r.checks ?? []).some((c) => c.status === "fail" && !c.owner))) {
    view.status = "partial";
    view.notes.push("Fejlede checks uden navngivet ejer kan ikke give grøn status.");
  }
  return stripInternal(view);
}

/** Recovery: backup-/gendannelsesfriskhed og målte RPO/RTO. */
export function buildRecoveryView({ records = [], tenantId, environment = null, now = Date.now(), windowSeconds = 30 * 86400, maxAgeSeconds = 14 * 86400 } = {}) {
  const view = baseView({ view: "recovery", tenantId, environment, now, windowSeconds, records });
  const items = records.filter((r) => r.signal === "recovery" && !r.late).map((r) => ({ ...(r.payload ?? {}), occurredAt: r.occurredAt }));
  view.items = items;
  const latest = items.sort((a, b) => String(b.occurredAt).localeCompare(String(a.occurredAt)))[0] ?? null;
  view.aggregates = latest
    ? {
        gate: latest.gate,
        serviceClass: latest.serviceClass,
        rpoTargetMinutes: latest.targets?.rpoMinutes ?? null,
        rtoTargetMinutes: latest.targets?.rtoMinutes ?? null,
        measuredRpoMinutes: latest.measured?.dataLossMinutes ?? null,
        measuredRtoMinutes: latest.measured?.restoreMinutes ?? null,
        lastBackupAt: latest.lastBackupAt ?? null,
        lastRestoreDrillAt: latest.lastRestoreDrillAt ?? null,
      }
    : { gate: "unknown" };
  const fresh = freshest(records.filter((r) => r.signal === "recovery"), { now, maxAgeSeconds });
  view.lastObservedAt = fresh.lastObservedAt ?? latest?.occurredAt ?? null;
  let findingsStatus = null;
  if (latest) {
    const withinRpo = latest.measured?.dataLossMinutes === null || latest.measured?.dataLossMinutes === undefined || latest.measured.dataLossMinutes <= (latest.targets?.rpoMinutes ?? Infinity);
    const withinRto = latest.measured?.restoreMinutes === null || latest.measured?.restoreMinutes === undefined || latest.measured.restoreMinutes <= (latest.targets?.rtoMinutes ?? Infinity);
    findingsStatus = latest.gate === "pass" && withinRpo && withinRto ? "pass" : latest.gate === "blocked" ? "fail" : "partial";
  }
  view.status = statusForReading({ freshness: fresh.freshness, findingsStatus });
  if (view.status === "pass" && (latest?.measured?.restoreMinutes === null || latest?.measured?.dataLossMinutes === null)) {
    view.status = "unknown";
    view.notes.push("Et erklæret recoveryniveau uden målte tal er ikke et målt niveau.");
  }
  return stripInternal(view);
}

/** AI: godkendelser, agenthandlinger og omkostning. */
export function buildAiView({ records = [], tenantId, environment = null, now = Date.now(), windowSeconds = 7 * 86400, maxAgeSeconds = 86400 } = {}) {
  const view = baseView({ view: "ai", tenantId, environment, now, windowSeconds, records });
  const actions = records.filter((r) => r.signal === "agent-action" && !r.late);
  view.items = actions.map((r) => ({
    id: r.id,
    verb: r.payload?.verb ?? null,
    decision: r.payload?.decision ?? null,
    autonomyClass: r.payload?.autonomyClass ?? null,
    principal: r.payload?.principal ?? r.ref?.id ?? null,
    approvalId: r.payload?.approvalId ?? null,
    cost: r.payload?.cost ?? null,
    occurredAt: r.occurredAt,
  }));
  const denied = view.items.filter((a) => a.decision === "deny");
  const bypass = view.items.filter((a) => a.decision === "bypass");
  view.aggregates = {
    actions: view.items.length,
    allowed: view.items.filter((a) => a.decision === "allow").length,
    denied: denied.length,
    escalations: view.items.filter((a) => a.decision === "escalate").length,
    approvals: view.items.filter((a) => a.approvalId).length,
    costTotal: view.items.reduce((sum, a) => sum + (Number(a.cost) || 0), 0),
  };
  const fresh = freshest(actions, { now, maxAgeSeconds });
  view.lastObservedAt = fresh.lastObservedAt;
  const findingsStatus = bypass.length ? "fail" : denied.length ? "partial" : view.items.length ? "pass" : null;
  view.status = statusForReading({ freshness: fresh.freshness, findingsStatus });
  return stripInternal(view);
}

export const VIEW_BUILDERS = {
  operations: buildOperationsView,
  vulnerabilities: buildVulnerabilitiesView,
  "test-release": buildTestReleaseView,
  recovery: buildRecoveryView,
  ai: buildAiView,
};

export function buildView(name, options) {
  const builder = VIEW_BUILDERS[name];
  if (!builder) throw new Error(`ukendt view '${name}'`);
  return builder(options);
}

/** Samlet status på tværs af views (til et overblik). */
export function overallViewStatus(views = []) {
  return overallStatus(views.map((v) => v.status));
}
