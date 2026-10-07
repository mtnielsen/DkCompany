/**
 * DKC-065 — deterministisk rapport for sikkerhedsvurderingen.
 *
 * Rapporten er adgangskontrolleret og redigeret: den indeholder kun
 * klassifikation, dækning, tællinger og gate-blokkere — aldrig rå evidens,
 * tokens eller persondata. `measured` er false, så en lokal deterministisk
 * kørsel ikke forveksles med en målt uafhængig vurdering.
 */
import { REPORT_PATH, REPORT_DOC_PATH, REPORT_GENERATED_AT } from "./model.mjs";

export function buildReport(assessment, gate) {
  return {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "SecurityAssessmentReport",
    metadata: {
      name: "platform-security-assessment-report",
      version: "1.0.0",
      description: "Redigeret, adgangskontrolleret rapport for den lokale regressionsharness og assessment-gaten.",
      accountableHuman: assessment.metadata.accountableHuman,
    },
    generatedAt: REPORT_GENERATED_AT,
    measured: false,
    assessmentVersion: assessment.assessmentVersion,
    targetCommit: assessment.artifactBinding.targetCommit,
    artifactDigest: assessment.artifactBinding.artifactDigest,
    accessControl: {
      classification: "confidential",
      allowedRoles: ["Security Owner", "Platform Owner", "Independent Assessor"],
      rawEvidenceControlled: true,
    },
    coverage: assessment.coverage.map((c) => ({ id: c.id, version: c.version, required: c.required, status: c.status, probeCount: (c.probeIds ?? []).length })),
    harness: {
      runs: assessment.harnessRuns.length,
      total: assessment.harnessRuns.reduce((sum, r) => sum + (r.summary?.total ?? 0), 0),
      passed: assessment.harnessRuns.reduce((sum, r) => sum + (r.summary?.passed ?? 0), 0),
      failed: assessment.harnessRuns.reduce((sum, r) => sum + (r.summary?.failed ?? 0), 0),
    },
    findings: {
      total: assessment.findings.length,
      open: assessment.findings.filter((f) => f.status === "open").length,
      blocking: gate.findings.blocking,
    },
    independentAssessment: assessment.independentAssessment ? { id: assessment.independentAssessment.id, method: assessment.independentAssessment.method } : null,
    releaseDecision: assessment.releaseDecision ? { decision: assessment.releaseDecision.decision } : null,
    status: assessment.status,
    gate: { decision: gate.decision, outstanding: gate.outstanding, blockers: gate.blockers.map((b) => b.id) },
    provenance: {
      producer: gate.producer,
      actors: [...new Set(["implementer:security-assessment-suite", ...(assessment.independentAssessment ? [`assessor:${assessment.independentAssessment.assessor?.subject}`] : [])])],
    },
  };
}

const GATE_LABEL = { eligible: "ELIGIBLE", blocked: "BLOCKED" };

export function renderReportMarkdown(report) {
  const lines = [];
  lines.push("# Sikkerhedsvurdering — regressionsharness og assessment-gate (DKC-065)");
  lines.push("");
  lines.push(`- **Genereret:** ${report.generatedAt} (deterministisk)`);
  lines.push("- **Målt:** nej — dette er en deterministisk lokal kørsel, ikke en uafhængig vurdering");
  lines.push(`- **Commit:** ${report.targetCommit}`);
  lines.push(`- **Artefakt:** ${report.artifactDigest}`);
  lines.push(`- **Vurderingsversion:** ${report.assessmentVersion}`);
  lines.push(`- **Status:** ${report.status}`);
  lines.push(`- **Produktionsgate:** ${GATE_LABEL[report.gate.decision] ?? report.gate.decision}${report.gate.outstanding ? " (udestående)" : ""}`);
  lines.push("");
  lines.push("## Dækning");
  lines.push("");
  lines.push("| Kategori | Version | Status | Sonder |");
  lines.push("| --- | --- | --- | --- |");
  for (const c of report.coverage) lines.push(`| ${c.id} | ${c.version} | ${c.status} | ${c.probeCount} |`);
  lines.push("");
  lines.push("## Isoleret regressionsharness");
  lines.push("");
  lines.push(`- Kørsler: ${report.harness.runs}, sonder: ${report.harness.total}, bestået: ${report.harness.passed}, fejlet: ${report.harness.failed}`);
  lines.push("");
  lines.push("## Fund");
  lines.push("");
  lines.push(`- I alt: ${report.findings.total}, åbne: ${report.findings.open}, blokerende: ${report.findings.blocking}`);
  lines.push("");
  lines.push("## Uafhængig vurdering");
  lines.push("");
  lines.push(report.independentAssessment ? `- Registreret: ${report.independentAssessment.id} (${report.independentAssessment.method})` : "- **Udestående:** der findes ingen uafhængig assessor. En implementørkørsel tæller ikke.");
  lines.push("");
  lines.push("## Releasebeslutning");
  lines.push("");
  lines.push(report.releaseDecision ? `- ${report.releaseDecision.decision}` : "- **Ikke truffet:** et navngivet menneske skal træffe den.");
  lines.push("");
  lines.push("## Gate-blokkere");
  lines.push("");
  if (report.gate.blockers.length === 0) lines.push("- Ingen.");
  else for (const b of report.gate.blockers) lines.push(`- \`${b}\``);
  lines.push("");
  lines.push(`> Rapporten er klassificeret \`${report.accessControl.classification}\` og redigeret. Rå evidens er adgangskontrolleret, og rapporter indeholder hverken tokens eller persondata.`);
  return lines.join("\n") + "\n";
}

export function reportPaths() {
  return { json: REPORT_PATH, markdown: REPORT_DOC_PATH };
}
