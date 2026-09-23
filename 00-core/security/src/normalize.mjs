/**
 * 3.4 — Normalisering af sikkerhedsfund.
 *
 * Trivy (CI), Falco (runtime) og Wazuh (SIEM) taler tre forskellige formater.
 * Her oversættes de til ét, så fundene kan indgå i OSCAL-evidenspakken i
 * stedet for at ligge i hver sin silo. Status er konservativ: critical/high
 * giver fail, medium/low giver partial, ingen fund giver pass.
 */

const TRIVY_SEVERITY = { CRITICAL: "critical", HIGH: "high", MEDIUM: "medium", LOW: "low", UNKNOWN: "low" };
const FALCO_SEVERITY = {
  Emergency: "critical",
  Alert: "critical",
  Critical: "critical",
  Error: "high",
  Warning: "medium",
  Notice: "low",
  Informational: "low",
  Debug: "low",
};

export function wazuhSeverity(level) {
  if (level >= 12) return "critical";
  if (level >= 7) return "high";
  if (level >= 4) return "medium";
  return "low";
}

export function summarize(findings) {
  const summary = { critical: 0, high: 0, medium: 0, low: 0, total: findings.length };
  for (const finding of findings) summary[finding.severity] += 1;
  return summary;
}

export function statusFor(summary) {
  if (summary.critical > 0 || summary.high > 0) return "fail";
  if (summary.medium > 0 || summary.low > 0) return "partial";
  return "pass";
}

export function buildReport({ scanner, scannerVersion, target, capturedAt, findings, artifact }) {
  const summary = summarize(findings);
  return {
    scanner,
    ...(scannerVersion ? { scannerVersion } : {}),
    target,
    capturedAt,
    status: statusFor(summary),
    summary,
    findings,
    ...(artifact ? { artifact } : {}),
  };
}

export function normalizeTrivy(raw, { target, capturedAt, artifact, scannerVersion } = {}) {
  const findings = [];
  for (const result of raw.Results ?? []) {
    for (const v of result.Vulnerabilities ?? []) {
      findings.push({
        id: v.VulnerabilityID ?? "UNKNOWN",
        title: v.Title || `${v.PkgName ?? "pakke"}@${v.InstalledVersion ?? "?"}`,
        severity: TRIVY_SEVERITY[v.Severity] ?? "low",
        resource: `${result.Target ?? raw.ArtifactName ?? "?"}:${v.PkgName ?? "?"}@${v.InstalledVersion ?? "?"}`,
        ...(v.Description ? { detail: v.Description } : {}),
        remediation: v.FixedVersion ? `Opgrader til ${v.FixedVersion}.` : "Ingen kendt rettelse; vurdér risikoen.",
      });
    }
    for (const m of result.Misconfigurations ?? []) {
      findings.push({
        id: m.ID ?? "MISCONFIG",
        title: m.Title ?? "Fejlkonfiguration",
        severity: TRIVY_SEVERITY[m.Severity] ?? "low",
        resource: m.CauseMetadata?.Resource ?? result.Target ?? raw.ArtifactName ?? "?",
        ...(m.Description ? { detail: m.Description } : {}),
        ...(m.Resolution ? { remediation: m.Resolution } : {}),
      });
    }
  }
  return buildReport({
    scanner: "trivy",
    scannerVersion,
    target: target ?? raw.ArtifactName ?? "trivy",
    capturedAt,
    findings,
    artifact,
  });
}

export function normalizeFalco(events, { target, capturedAt, artifact } = {}) {
  const findings = (events ?? []).map((event, index) => ({
    id: `${event.rule ?? "falco"}#${index + 1}`,
    title: event.rule ?? "Falco-hændelse",
    severity: FALCO_SEVERITY[event.priority] ?? "low",
    resource: event.output_fields?.["k8s.pod.name"] ?? event.output_fields?.["container.name"] ?? target ?? "runtime",
    detail: event.output ?? "",
    remediation: "Undersøg hændelsen, luk den, og verificér at den ikke gentages.",
  }));
  return buildReport({ scanner: "falco", target: target ?? "runtime", capturedAt, findings, artifact });
}

export function normalizeWazuh(alerts, { target, capturedAt, artifact } = {}) {
  const findings = (alerts ?? []).map((alert, index) => ({
    id: alert.rule?.id ?? `wazuh-${index + 1}`,
    title: alert.rule?.description ?? "Wazuh-alert",
    severity: wazuhSeverity(alert.rule?.level ?? 0),
    resource: alert.agent?.name ?? target ?? "wazuh",
    detail: alert.data ? JSON.stringify(alert.data) : (alert.rule?.description ?? ""),
    remediation: `Følg playbooken for Wazuh-regel ${alert.rule?.id ?? "?"}.`,
  }));
  return buildReport({ scanner: "wazuh", target: target ?? "siem", capturedAt, findings, artifact });
}
