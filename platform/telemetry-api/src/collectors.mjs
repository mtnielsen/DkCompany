/**
 * DKC-066 — collector-selvovervågning, alarmgruppering og audit-adskillelse.
 *
 * Drifts-telemetriens collectorer overvåges som alt andet: hver collector har en
 * heartbeat, en forventet kadence og en maksimal alder. Overload og nedbrud
 * følger dokumenterede grænser (kapacitet, drop, backpressure) og udløser
 * alarmer. Den obligatoriske audit har sin egen holdbare vej; et telemetritab
 * må derfor ikke kunne deaktivere den.
 */
import { freshnessFor, statusForReading, overallStatus } from "../../observability/src/freshness.mjs";

/** Byg `CollectorStatus` fra registret og de observerede heartbeat-tællere. */
export function collectorStatus({ registry, observations = {}, now = Date.now() } = {}) {
  const collectors = [];
  for (const source of registry?.sources ?? []) {
    const observed = observations[source.id] ?? {};
    const fresh = freshnessFor({ capturedAt: observed.lastSeenAt ?? null, maxAgeSeconds: source.maxAgeSeconds ?? null, now });
    const drops = Number(observed.drops ?? 0);
    const backpressure = Number(observed.backpressure ?? 0);
    const rejected = Number(observed.rejected ?? 0);
    let findingsStatus = "pass";
    if (observed.lastError) findingsStatus = "fail";
    else if (rejected > 0) findingsStatus = "partial";
    else if (backpressure > 0) findingsStatus = "partial";
    const status = observed.lastError ? "fail" : statusForReading({ freshness: fresh.freshness, findingsStatus });
    collectors.push({
      id: source.id,
      kind: source.kind,
      status,
      freshness: fresh.freshness,
      lastSeenAt: observed.lastSeenAt ?? null,
      ageSeconds: fresh.ageSeconds,
      expectedIntervalSeconds: source.expectedIntervalSeconds,
      maxAgeSeconds: source.maxAgeSeconds,
      drops,
      backpressure,
      rejected,
      bound: `${drops} drops / ${backpressure} backpressure / ${rejected} afviste`,
      ...(fresh.reason ? { reason: fresh.reason } : {}),
    });
  }
  const required = (registry?.sources ?? []).filter((s) => s.required !== false);
  const requiredIds = new Set(required.map((s) => s.id));
  const overall = overallStatus(collectors.filter((c) => requiredIds.has(c.id)).map((c) => c.status));
  return { schemaVersion: "1.0", kind: "CollectorStatus", generatedAt: new Date(typeof now === "number" ? now : Date.parse(now)).toISOString(), overall, collectors };
}

export function collectorStatusProblems(status) {
  const problems = [];
  const collectors = Array.isArray(status?.collectors) ? status.collectors : [];
  const required = collectors.filter((c) => /drops|backpressure|afviste/.test(c.bound ?? "") ? true : true);
  void required;
  const computed = collectors.reduce((worst, c) => (({ fail: 5, partial: 4, stale: 3, missing: 2, unknown: 1, pass: 0 }[c.status] ?? 1) > ({ fail: 5, partial: 4, stale: 3, missing: 2, unknown: 1, pass: 0 }[worst] ?? 0) ? c.status : worst), "pass");
  if (status?.overall !== computed) problems.push(`/overall: '${status?.overall}' stemmer ikke med '${computed}'`);
  for (const [i, c] of collectors.entries()) {
    if (c.freshness !== "fresh" && c.status === "pass") problems.push(`/collectors/${i}: en ikke-frisk collector må ikke være 'pass'`);
    if (c.backpressure > 0 && c.freshness === "missing" && (status.overall ?? "pass") === "pass") problems.push(`/overall: overload må ikke give 'pass'`);
  }
  return problems;
}

/**
 * Gruppér alarmer på regel + tenant + observeret ressource, så en storm af
 * ens hændelser bliver én alarm med et antal og et tidsrum. Bevarer ejer,
 * eskalation og runbook fra den underliggende regel.
 */
export function groupAlerts(alerts = []) {
  const groups = new Map();
  for (const alert of alerts) {
    const key = `${alert.ruleId}|${alert.tenantId ?? "platform"}|${alert.observed?.sensorId ?? alert.observed?.resource ?? alert.signal}`;
    if (!groups.has(key)) {
      groups.set(key, {
        groupId: key,
        ruleId: alert.ruleId,
        signal: alert.signal,
        severity: alert.severity,
        tenantId: alert.tenantId ?? null,
        owner: alert.owner,
        escalation: alert.escalation,
        runbook: alert.runbook,
        recipients: alert.recipients,
        summary: alert.summary,
        count: 0,
        firstSeenAt: alert.detectedAt,
        lastSeenAt: alert.detectedAt,
        observed: alert.observed,
      });
    }
    const group = groups.get(key);
    group.count += 1;
    if (alert.detectedAt < group.firstSeenAt) group.firstSeenAt = alert.detectedAt;
    if (alert.detectedAt > group.lastSeenAt) group.lastSeenAt = alert.detectedAt;
  }
  return [...groups.values()].sort((a, b) => String(b.severity).localeCompare(String(a.severity)) || a.groupId.localeCompare(b.groupId));
}

/**
 * Bevis at et telemetritab ikke rører den obligatoriske audit. Funktionen
 * overfylder telemetrilageret, hvorefter audit-skriveren kaldes. Kan audit
 * stadig skrive, er de to veje adskilte.
 */
export function verifyAuditUnaffected({ store, auditAppend, overflow = null, now = Date.now() } = {}) {
  if (typeof auditAppend !== "function") throw new Error("verifyAuditUnaffected kræver en auditAppend-funktion");
  const before = store.stats();
  const fill = overflow ?? before.capacity + 10;
  for (let i = 0; i < fill; i++) {
    store.append({ id: `overflow-${i}`, occurredAt: new Date(now).toISOString(), scope: { tenantId: "platform" }, signal: "metric", labels: {}, otel: { metric: { name: "overflow_total", value: i } } });
  }
  const after = store.stats();
  const audit = auditAppend({ at: new Date(now).toISOString(), note: "audit skal kunne skrive trods telemetritab" });
  return { telemetryDropped: after.dropped + after.cardinalityDropped, audit, auditOk: Boolean(audit) };
}
