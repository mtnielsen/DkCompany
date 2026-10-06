/**
 * DKC-058 — kapacitetsalarmer på en host.
 *
 * Kapacitet er en read-only observation: at nå en tærskel udløser en alarm og
 * et forslag til en menneskeligt godkendt operation — aldrig en automatisk
 * mutation. Alarmen bærer host, signal, måling, tærskel og en ansvarlig ejer.
 */
export const CAPACITY_SIGNALS = ["cpu", "memory", "disk"];

export const DEFAULT_CAPACITY_THRESHOLDS = {
  cpu: { warn: 0.75, critical: 0.9 },
  memory: { warn: 0.8, critical: 0.92 },
  disk: { warn: 0.75, critical: 0.9 },
};

function severityFor(value, threshold) {
  if (value >= threshold.critical) return "critical";
  if (value >= threshold.warn) return "warning";
  return null;
}

/**
 * Evaluer kapacitetsmålinger mod tærskler. Returnerer alarmer (ingen mutation).
 */
export function evaluateCapacity({ hostRef, readings = {}, thresholds = DEFAULT_CAPACITY_THRESHOLDS, owner = null, tenantId = null } = {}) {
  const alerts = [];
  for (const signal of CAPACITY_SIGNALS) {
    const value = readings[signal];
    const threshold = thresholds[signal];
    if (typeof value !== "number" || !threshold) continue;
    const severity = severityFor(value, threshold);
    if (!severity) continue;
    alerts.push({
      id: `host-capacity-${signal}`,
      hostRef,
      tenantId,
      signal,
      severity,
      value,
      threshold: severity === "critical" ? threshold.critical : threshold.warn,
      owner,
      runbook: "docs/runbooks/host-capacity.md",
      readOnly: true,
      mutationRequiresApproval: true,
    });
  }
  return { hostRef, alerts, count: alerts.length, readOnly: true };
}

/** Foreslå en kapacitetsalarm som en operation (dry-run, kræver godkendelse). */
export function capacityAlertOperationId(hostRef, signal) {
  return `capacity-${hostRef}-${signal}`;
}
