/**
 * DKC-033 — deterministisk rendering af readiness-rapporten.
 *
 * Rapporten skrives både som maskinlæsbar JSON og som menneskelæsbar markdown.
 * Renderingen er deterministisk (fast `generatedAt`), så `make pilot-check` kan
 * afvise en rapport der er ude af trit med den kørende kode.
 */
import { REPORT_PATH, REPORT_DOC_PATH } from "./model.mjs";

export function renderPilotJson(report) {
  return JSON.stringify(report, null, 2) + "\n";
}

const STATUS_MARK = { passed: "✔", failed: "✘", pending: "…", "not-run": "—", "not-applicable": "n/a" };

function escapeCell(value) {
  return String(value ?? "—").replace(/\|/g, "\\|");
}

export function renderPilotMarkdown(report) {
  const lines = [];
  lines.push("# Pilotforløb og readiness — rapport");
  lines.push("");
  lines.push("> Genereret af `make pilot-render` som en deterministisk kontrol. **Målt:** nej — en rigtig 30-dages observation og den menneskelige kundcaccept er særskilt NOT RUN.");
  lines.push("");
  lines.push(`- **Genereret:** ${report.generatedAt}`);
  lines.push(`- **Readiness:** \`${report.readiness}\``);
  lines.push(`- **Virksomhedsprofiler:** ${report.profiles.length}`);
  lines.push(`- **Åbne omgåelser (abuse):** ${report.abuse.violations.length}`);
  lines.push(`- **Belastning (bundet):** ${report.load.iterations} iterationer, ${report.load.concurrency} samtidige, ${report.load.failures} fejl, ${report.load.bypasses} omgåelser`);
  lines.push("");
  lines.push("## Virksomhedsprofiler og kritiske arbejdsgange");
  lines.push("");
  lines.push("| Profil | Segment | Installation | Medarbejdere | Alle seks | RPO (min) | RTO (min) | Omkostning (EUR/md.) |");
  lines.push("| --- | --- | --- | ---: | :---: | ---: | ---: | ---: |");
  for (const p of report.profiles) {
    lines.push(`| ${escapeCell(p.profileRef)} | ${escapeCell(p.segment)} | ${escapeCell(p.deploymentProfileRef)} | ${p.companySizeEmployees} | ${p.complete ? "✔" : "✘"} | ${p.rpoMinutes ?? "—"} | ${p.rtoMinutes ?? "—"} | ${p.monthlyCostEur ?? "—"} |`);
  }
  lines.push("");
  lines.push("## Arbejdsgange pr. profil");
  lines.push("");
  lines.push("| Profil | Arbejdsgang | Status | Træk |");
  lines.push("| --- | --- | :---: | --- |");
  for (const p of report.profiles) {
    for (const w of p.workflows) {
      lines.push(`| ${escapeCell(p.profileRef)} | ${escapeCell(w.journey)} | ${STATUS_MARK[w.status] ?? w.status} | ${escapeCell((w.metrics && Object.keys(w.metrics).length ? JSON.stringify(w.metrics) : "") || "")} |`);
    }
  }
  lines.push("");
  lines.push("## Readiness-gates");
  lines.push("");
  lines.push("| Gate | Slags | Anvendelig | Status | Årsager |");
  lines.push("| --- | --- | :---: | :---: | --- |");
  for (const g of report.gates) {
    lines.push(`| ${escapeCell(g.id)} | ${escapeCell(g.kind)} | ${g.applicable ? "ja" : "nej"} | ${STATUS_MARK[g.status] ?? g.status} ${escapeCell(g.status)} | ${escapeCell(g.reasons.join("; "))} |`);
  }
  lines.push("");
  lines.push("## Abuse-prober");
  lines.push("");
  for (const probe of report.abuse.probes) lines.push(`- ${escapeCell(probe)}`);
  if (report.abuse.violations.length) {
    lines.push("");
    lines.push(`**Omgåelser:** ${report.abuse.violations.map(escapeCell).join(", ")}`);
  } else {
    lines.push("");
    lines.push("Ingen kendte åbne omgåelser af godkendelser eller kundeisolering.");
  }
  lines.push("");
  lines.push("## Observation og kundcaccept");
  lines.push("");
  lines.push(`- **30-dages observation:** \`${report.observation.status}\` (${report.observation.observedDays}/${report.observation.requiredDays} dage)`);
  lines.push(`- **Kundcaccept:** \`${report.customerAcceptance.status}\`${report.customerAcceptance.acceptedBy ? ` af ${report.customerAcceptance.acceptedBy}` : ""}`);
  if (report.customerAcceptance.limitations.length) {
    lines.push("");
    lines.push("Kendte begrænsninger der afventer accept:");
    for (const limitation of report.customerAcceptance.limitations) lines.push(`- ${escapeCell(limitation)}`);
  }
  lines.push("");
  if (report.problems.length) {
    lines.push("## Problemer");
    lines.push("");
    for (const problem of report.problems) lines.push(`- ${escapeCell(problem)}`);
    lines.push("");
  }
  return lines.join("\n");
}

export function renderPilotReport(report) {
  return [
    [REPORT_PATH, renderPilotJson(report)],
    [REPORT_DOC_PATH, renderPilotMarkdown(report)],
  ];
}

export { REPORT_PATH, REPORT_DOC_PATH };
