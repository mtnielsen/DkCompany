/**
 * DKC-017 — alarmer med ejer, eskalation og runbook.
 *
 * En alarm er ikke en grøn/rod prik. Den er en hændelse med:
 *   - en **ejer** (et navngivet, verificeret menneske),
 *   - en **eskalation** (hvem overtager efter hvor lang tid),
 *   - en **runbook** (hvad gør man),
 *   - en **modtager** (testmodtager lokalt eller en rigtig webhook) og
 *   - et **forløb** (tidslinje) der dokumenteres, uden at rå persondata deles
 *     bredt.
 *
 * `evaluateAlerts` omsætter en sikkerhedspostur til alarmer. `dispatchAlerts`
 * leverer notifikationer gennem en transport og skriver en kvittering.
 * `createLocalMailbox` er en rigtig, lokal modtager (fil-bakket) til test;
 * `createWebhookTransport` er den rigtige kanal i drift og rapporterer
 * `not-run` når endpointet ikke er konfigureret — aldrig et falsk `delivered`.
 *
 * Alarmerende indhold minimeres med samme regel som telemetrien, så en bred
 * kanal ikke bærer persondata.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { minimizePayload } from "./telemetry.mjs";
import { alertRuleSetProblems } from "../../conformance/src/monitoring.mjs";

export { alertRuleSetProblems };

export const ALERT_RULES_PATH = "observability/alert-rules.json";

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
}

function digestOf(value) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

export function loadAlertRules(root) {
  const path = join(root, ALERT_RULES_PATH);
  if (!existsSync(path)) throw new Error(`Mangler ${ALERT_RULES_PATH}`);
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Evaluer én betingelse mod én sensor-reading. */
export function evaluateCondition(condition, reading) {
  const { operator, threshold, status: expectedStatus } = condition ?? {};
  const observed = {
    value: reading?.value ?? null,
    status: reading?.status ?? null,
    freshness: reading?.freshness ?? "missing",
    capturedAt: reading?.capturedAt ?? null,
    ageSeconds: reading?.ageSeconds ?? null,
  };
  const value = reading?.value;
  const missed = reading?.freshness === "missing" || reading === undefined || reading === null;
  switch (operator) {
    case "absent":
      return { triggered: missed, observed, reason: "målingen mangler" };
    case "stale":
      return { triggered: reading?.freshness === "stale" || missed, observed, reason: "målingen er forældet eller mangler" };
    case "not-pass":
      return { triggered: missed || (reading?.status !== "pass" && reading?.status !== undefined), observed, reason: `status er '${observed.status ?? "mangler"}'` };
    case "gt":
      return { triggered: Number.isFinite(value) && value > threshold, observed, reason: `${value} > ${threshold}` };
    case "gte":
      return { triggered: Number.isFinite(value) && value >= threshold, observed, reason: `${value} >= ${threshold}` };
    case "lt":
      return { triggered: Number.isFinite(value) && value < threshold, observed, reason: `${value} < ${threshold}` };
    case "lte":
      return { triggered: Number.isFinite(value) && value <= threshold, observed, reason: `${value} <= ${threshold}` };
    case "eq":
      return { triggered: (expectedStatus ?? threshold) === observed.status, observed, reason: `status == ${expectedStatus ?? threshold}` };
    case "ne":
      return { triggered: (expectedStatus ?? threshold) !== observed.status, observed, reason: `status != ${expectedStatus ?? threshold}` };
    default:
      return { triggered: false, observed, reason: `ukendt operator '${operator}'` };
  }
}

/**
 * Evaluer alle regler mod en sikkerhedspostur. Returnerer de alarmer der
 * faktisk udløses, hver med ejer, eskalation, runbook, modtagere og den
 * observerede måling.
 */
export function evaluateAlerts({ rules, posture, now = Date.now(), tenantId = null } = {}) {
  const readings = new Map((posture?.sensors ?? []).map((s) => [s.id, s]));
  const alerts = [];
  for (const rule of rules?.rules ?? []) {
    const reading = readings.get(rule.sensor) ?? null;
    const { triggered, observed, reason } = evaluateCondition(rule.condition, reading);
    if (!triggered) continue;
    alerts.push({
      id: `alert-${randomUUID()}`,
      ruleId: rule.id,
      signal: rule.signal,
      severity: rule.severity,
      tenantId: rule.tenantScoped ? tenantId : null,
      owner: rule.owner,
      escalation: rule.escalation,
      runbook: rule.runbook,
      recipients: rule.recipients,
      summary: rule.summary,
      observed,
      reason,
      detectedAt: new Date(typeof now === "string" ? Date.parse(now) : now).toISOString(),
    });
  }
  return alerts;
}

/* -------------------------------------------------------------------------- */
/* Hændelsesforløb                                                            */
/* -------------------------------------------------------------------------- */

export function createIncident(alert, { now = Date.now() } = {}) {
  const at = new Date(typeof now === "string" ? Date.parse(now) : now).toISOString();
  return {
    incidentId: `inc-${randomUUID()}`,
    alertId: alert.id,
    ruleId: alert.ruleId,
    severity: alert.severity,
    tenantId: alert.tenantId,
    state: "open",
    owner: alert.owner,
    escalation: alert.escalation,
    runbook: alert.runbook,
    openedAt: at,
    timeline: [{ at, type: "alerted", actor: "monitoring", detail: `regel '${alert.ruleId}': ${alert.reason}` }],
  };
}

/**
 * Tilføj en hændelse til forløbet. `detail` minimeres, så tidslinjen kan
 * dokumenteres bredt uden rå persondata.
 */
export function appendIncidentEvent(incident, { type, at = new Date().toISOString(), actor = "monitoring", detail = "", data = null } = {}) {
  const text = String(detail);
  if (/@/.test(text)) {
    throw new Error("hændelsesdetaljen ser ud som rå persondata; læg den i `data`, som minimeres");
  }
  const minimized = minimizePayload(data ?? {});
  const event = {
    at,
    type,
    actor,
    detail: text,
    ...(minimized.removed.length || minimized.redactions.length
      ? { personalData: { removed: minimized.removed, redactions: minimized.redactions, digest: minimized.personalDigest } }
      : {}),
  };
  return { ...incident, timeline: [...incident.timeline, event] };
}

/** Hvem eskaleringen peger på lige nu, ud fra forløbets starttidspunkt. */
export function currentEscalationTarget(incident, { now = Date.now() } = {}) {
  const opened = Date.parse(incident.openedAt);
  const at = typeof now === "string" ? Date.parse(now) : now;
  const elapsedMinutes = Math.max(0, (at - opened) / 60000);
  let target = incident.owner;
  for (const step of incident.escalation ?? []) {
    if (elapsedMinutes >= step.afterMinutes) target = step.to;
  }
  return { target, elapsedMinutes: Math.round(elapsedMinutes * 1000) / 1000 };
}

export function escalateIncident(incident, { now = Date.now() } = {}) {
  const { target, elapsedMinutes } = currentEscalationTarget(incident, { now });
  const at = new Date(typeof now === "string" ? Date.parse(now) : now).toISOString();
  return appendIncidentEvent(incident, {
    type: "escalated",
    at,
    actor: "monitoring",
    detail: `eskaleret til ${target.name} efter ${elapsedMinutes} min`,
    data: { assignee: target.subject },
  });
}

export function acknowledgeIncident(incident, { by, now = Date.now(), note = "" } = {}) {
  const at = new Date(typeof now === "string" ? Date.parse(now) : now).toISOString();
  return {
    ...appendIncidentEvent(incident, { type: "acknowledged", at, actor: by?.subject ?? "unknown", detail: note || "kvitteret", data: { by: by?.subject ?? null } }),
    state: "acknowledged",
  };
}

export function resolveIncident(incident, { by, now = Date.now(), note = "" } = {}) {
  const at = new Date(typeof now === "string" ? Date.parse(now) : now).toISOString();
  return {
    ...appendIncidentEvent(incident, { type: "resolved", at, actor: by?.subject ?? "unknown", detail: note || "løst", data: { by: by?.subject ?? null } }),
    state: "resolved",
    resolvedAt: at,
  };
}

/* -------------------------------------------------------------------------- */
/* Notifikation og transport                                                  */
/* -------------------------------------------------------------------------- */

/** Byg en minimeret notifikation. Summaren må ikke bære rå persondata. */
export function buildNotification(alert, { now = Date.now() } = {}) {
  const at = new Date(typeof now === "string" ? Date.parse(now) : now).toISOString();
  const minimized = minimizePayload({ observed: alert.observed, reason: alert.reason });
  return {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "AlertNotification",
    id: `notif-${randomUUID()}`,
    alertId: alert.id,
    ruleId: alert.ruleId,
    severity: alert.severity,
    signal: alert.signal,
    tenantId: alert.tenantId ?? null,
    summary: alert.summary,
    owner: alert.owner,
    escalation: alert.escalation,
    runbook: alert.runbook,
    emittedAt: at,
    minimized: true,
    personalData: {
      removed: minimized.removed.map((p) => `observed${p}`),
      redactions: minimized.redactions,
      digest: minimized.personalDigest,
    },
    observed: minimized.operational.observed ?? null,
    delivery: { recipientId: null, transport: null, status: "not-run", receipt: null, deliveredAt: at },
  };
}

/** En rigtig, lokal fil-bakket testmodtager. */
export function createLocalMailbox({ dir }) {
  mkdirSync(dir, { recursive: true });
  return {
    type: "local-mailbox",
    async deliver(notification) {
      const path = join(dir, `${notification.id}.json`);
      const body = JSON.stringify(notification, null, 2) + "\n";
      writeFileSync(path, body);
      const receipt = `local:${digestOf(notification)}`;
      return { status: "delivered", receipt, transport: "local-mailbox", target: path, deliveredAt: new Date().toISOString() };
    },
  };
}

/**
 * Rigtig webhook-transport. Uden en konfigureret URL returneres `not-run`, så
 * et manglende endpoint aldrig forveksles med en leveret alarm.
 */
export function createWebhookTransport({ url = null, token = null, fetchImpl = globalThis.fetch } = {}) {
  return {
    type: "webhook",
    configured: Boolean(url),
    async deliver(notification) {
      if (!url) return { status: "not-run", receipt: null, transport: "webhook", reason: "intet webhook-endpoint er konfigureret", deliveredAt: new Date().toISOString() };
      const headers = { "content-type": "application/json" };
      if (token) headers.authorization = `Bearer ${token}`;
      const response = await fetchImpl(url, { method: "POST", headers, body: JSON.stringify(notification) });
      if (response?.ok) {
        return { status: "delivered", receipt: `http:${response.status}`, transport: "webhook", deliveredAt: new Date().toISOString() };
      }
      return { status: "failed", receipt: response ? `http:${response.status}` : null, transport: "webhook", deliveredAt: new Date().toISOString() };
    },
  };
}

/**
 * Kør alarmer gennem modtagerne. `transports` er en funktion
 * `(recipient) => transport` eller et map fra modtager-id til transport.
 * Returnerer `{ notifications, incidents }` og skriver dem til `outDir` når
 * angivet.
 */
export async function dispatchAlerts({ alerts = [], transports, now = Date.now(), outDir = null } = {}) {
  const notifications = [];
  const incidents = [];
  for (const alert of alerts) {
    const incident = createIncident(alert, { now });
    const notification = buildNotification(alert, { now });
    const recipient = alert.recipients?.[0] ?? null;
    const transport = typeof transports === "function" ? transports(recipient) : transports?.[recipient?.id] ?? null;
    let delivery;
    if (!transport) {
      delivery = { status: "not-run", receipt: null, transport: recipient?.type ?? "unknown", reason: "ingen transport for modtageren", deliveredAt: new Date(typeof now === "string" ? Date.parse(now) : now).toISOString() };
    } else {
      delivery = await transport.deliver(notification);
    }
    notification.delivery = {
      recipientId: recipient?.id ?? null,
      transport: delivery.transport ?? recipient?.type ?? "unknown",
      status: delivery.status,
      receipt: delivery.receipt ?? null,
      deliveredAt: delivery.deliveredAt ?? new Date(typeof now === "string" ? Date.parse(now) : now).toISOString(),
      ...(delivery.reason ? { reason: delivery.reason } : {}),
    };
    const notified = appendIncidentEvent(incident, {
      type: "notified",
      at: notification.delivery.deliveredAt,
      actor: "monitoring",
      detail: delivery.status === "delivered" ? `leveret til ${recipient?.id} (${notification.delivery.receipt})` : `ikke leveret til ${recipient?.id ?? "modtager"}: ${delivery.reason ?? delivery.status}`,
      data: { recipient: recipient?.id ?? null, status: delivery.status },
    });
    notifications.push(notification);
    incidents.push(notified);
    if (outDir) {
      mkdirSync(join(outDir, "notifications"), { recursive: true });
      mkdirSync(join(outDir, "incidents"), { recursive: true });
      writeFileSync(join(outDir, "notifications", `${notification.id}.json`), JSON.stringify(notification, null, 2) + "\n");
      writeFileSync(join(outDir, "incidents", `${incident.incidentId}.json`), JSON.stringify(notified, null, 2) + "\n");
    }
  }
  return { notifications, incidents };
}
