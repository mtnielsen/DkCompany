/**
 * DKC-063 — markdown-rendering af release-gaten og trusselmodellen.
 * Begge dokumenter genereres fra de kanoniske datafiler og kontrolleres for
 * sync i `release/src/check.mjs`.
 */

const DECISION_LABEL = {
  eligible: "ELIGIBLE",
  "eligible-with-exceptions": "ELIGIBLE MED UNDTAGELSER",
  blocked: "BLOKERET",
};

const STATUS_ICON = {
  passed: "PASS",
  failed: "FAIL",
  skipped: "SKIPPED",
  "not-run": "NOT RUN",
  unsupported: "UNSUPPORTED",
  stale: "STALE",
  "wrong-artifact": "WRONG-ARTIFACT",
  missing: "MISSING",
  "pending-independent-assessment": "PENDING INDEPENDENT",
  excepted: "EXCEPTED",
};

export function renderGateMarkdown(result) {
  const lines = [];
  lines.push("# Release-gate (DKC-063)");
  lines.push("");
  lines.push("> Genereret af `release/src/cli.mjs`. Kun `PASS` tæller som bestået. `SKIPPED`, `NOT RUN`, `UNSUPPORTED`, `STALE`, `WRONG-ARTIFACT` og `MISSING` er distinkte og tæller ikke som bestået.");
  lines.push("");
  lines.push(`**Beslutning:** ${DECISION_LABEL[result.decision] ?? result.decision}`);
  lines.push(`**Genereret:** ${result.generatedAt} · **Matrix:** ${result.matrixVersion} · **Profil:** ${result.profile}`);
  lines.push(`**Mål-commit:** \`${result.targetCommit ?? "?"}\` · **Artefakt:** ${result.artifactDigest}`);
  lines.push(`**Producent:** ${result.producer.type} (\`${result.producer.name}\`, ${result.producer.subject})`);
  lines.push(`**Tærskler accepteret af:** ${result.thresholds?.acceptedBy?.name ?? "—"} (${result.thresholds?.acceptedAt ?? "—"})`);
  lines.push("");
  lines.push(`**Status:** ${result.statuses.total} krav · ${result.statuses.passed} pass · ${result.statuses.blocking} blokerende · ${result.statuses.failed} fail · ${result.statuses.stale} stale · ${result.statuses.wrongArtifact} wrong-artifact · ${result.statuses.missing} missing · ${result.statuses.pendingIndependentAssessment} pending independent · ${result.statuses.excepted} excepted`);
  lines.push("");

  if (result.reasons?.length) {
    lines.push("## Globale grunde");
    lines.push("");
    for (const r of result.reasons) lines.push(`- ${r}`);
    lines.push("");
  }

  lines.push("## Krav");
  lines.push("");
  lines.push("| Krav | Status | Blokerer | Testtyper | Mangler | Grunde |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const r of result.requirements) {
    const missing = r.missingTestTypes?.length ? r.missingTestTypes.join(", ") : "—";
    const reasons = r.reasons?.length ? r.reasons.join("<br>") : "—";
    lines.push(`| \`${r.requirementId}\` ${r.title} | ${STATUS_ICON[r.status] ?? r.status} | ${r.blocking ? "ja" : "nej"} | ${r.testTypes.join(", ")} | ${missing} | ${reasons} |`);
  }
  lines.push("");

  lines.push("## Checks og binding");
  lines.push("");
  lines.push("| Krav | Check | Status | Niveau | Kommando | Evidens | Alder (dage) |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const r of result.requirements) {
    for (const c of r.checks) {
      lines.push(`| ${r.requirementId} | \`${c.id}\` | ${STATUS_ICON[c.status] ?? c.status} | ${c.level ?? "—"} | \`${(c.command ?? []).join(" ")}\` | \`${c.evidenceRef ?? "—"}\` | ${c.ageDays ?? "—"} |`);
    }
  }
  lines.push("");

  if (result.openExceptions?.length) {
    lines.push("## Åbne undtagelser");
    lines.push("");
    lines.push("| Krav | Undtagelse | Ejer |");
    lines.push("| --- | --- | --- |");
    for (const e of result.openExceptions) lines.push(`| ${e.requirementId} | \`${e.exceptionId}\` | ${e.owner ?? "—"} |`);
    lines.push("");
  }

  lines.push("## Trusselgrænser");
  lines.push("");
  lines.push("| Trussel | Grænse | Status | Restrisiko |");
  lines.push("| --- | --- | --- | --- |");
  for (const t of result.threats) lines.push(`| \`${t.id}\` ${t.title} | ${t.boundary} | ${STATUS_ICON[t.status] ?? t.status} | ${t.residualRisk} |`);
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("En grøn enhedstest er ikke produktions-, HA- eller compliance-status. Uafhængig verifikation er en separat menneskelig handling.");
  lines.push("");
  return lines.join("\n");
}

export function renderTestMatrix(matrix) {
  const lines = [];
  lines.push("# Testmatrix (DKC-063)");
  lines.push("");
  lines.push("> Genereret fra `release/matrix/test-matrix.json` (matrixversion " + (matrix.matrixVersion ?? "?") + "). Hvert obligatoriske krav mapper til navngivne checks eller til en eksplicit udestående uafhængig vurdering.");
  lines.push("");
  lines.push(`**Ejer:** ${matrix.metadata?.accountableHuman?.name ?? "—"} · **Tærskler accepteret af:** ${matrix.thresholds?.acceptedBy?.name ?? "—"} (${matrix.thresholds?.acceptedAt ?? "—"})`);
  lines.push(`**Freshness:** standard ${matrix.freshnessPolicy?.defaultDays ?? "?"} dage, maks ${matrix.freshnessPolicy?.maxDays ?? "?"} dage`);
  lines.push(`**Tærskler:** alle obligatoriske skal bestå = ${matrix.thresholds?.requireAllMandatoryPass ? "ja" : "nej"} · maks åbne undtagelser = ${matrix.thresholds?.maxOpenExceptions ?? "?"} · implementørevidens til release = ${matrix.thresholds?.allowImplementerEvidenceForRelease ? "ja" : "nej"}`);
  lines.push("");
  lines.push("## Understøttede miljøer");
  lines.push("");
  lines.push((matrix.supportedEnvironments ?? []).map((e) => `\`${e}\``).join(", ") || "—");
  lines.push("");
  lines.push("## CI-trin");
  lines.push("");
  lines.push("| Trin | Blokerer | Kommandoer |");
  lines.push("| --- | --- | --- |");
  for (const s of matrix.stages ?? []) lines.push(`| ${s.title} (\`${s.id}\`) | ${s.blocking ? "ja" : "nej"} | ${s.commands.map((c) => `\`${c}\``).join("<br>")} |`);
  lines.push("");
  lines.push("## Krav");
  lines.push("");
  lines.push("| Krav | Obligatorisk | Testtyper | Checks | Frist (dage) | Uafhængig vurdering |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const r of matrix.requirements ?? []) {
    const assessment = r.independentAssessment?.required ? `ja (${r.independentAssessment.evidenceKind})` : "nej";
    const checks = (r.checks ?? []).map((c) => `\`${c.id}\``).join("<br>") || "—";
    lines.push(`| \`${r.id}\` ${r.title} | ${r.mandatory ? "ja" : "nej"}${r.nonExcepted ? " / nonExcepted" : ""} | ${r.testTypes.join(", ")} | ${checks} | ${r.evidenceFreshnessDays} | ${assessment} |`);
  }
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("En check der ikke er kørt, er sprunget over, er forældet eller er bundet til et andet commit/artefakt, tæller ikke som bestået.");
  lines.push("");
  return lines.join("\n");
}

export function renderThreatModel(register) {
  const lines = [];
  lines.push("# Trusselmodel (DKC-063)");
  lines.push("");
  lines.push(`> Genereret fra \`release/matrix/threats.json\` (version ${register.metadata?.version}). Trusselmodellen er bundet til de testede grænser og til kravene i testmatricen.`);
  lines.push("");
  lines.push(`**Ejer:** ${register.metadata?.accountableHuman?.name ?? "—"} · **Sidst revideret:** ${register.metadata?.lastReviewed ?? "—"}`);
  lines.push("");
  lines.push(register.metadata?.description ?? "");
  lines.push("");

  lines.push("## Grænser");
  lines.push("");
  lines.push("| Grænse | Beskrivelse | Krav |");
  lines.push("| --- | --- | --- |");
  for (const b of register.boundaries ?? []) {
    lines.push(`| ${b.title} (\`${b.id}\`) | ${b.description} | ${b.requirementIds.map((r) => `\`${r}\``).join(", ")} |`);
  }
  lines.push("");

  lines.push("## Trusler");
  lines.push("");
  lines.push("| Trussel | Grænse | Beskrivelse | STRIDE | Krav | Restrisiko |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const t of register.threats ?? []) {
    lines.push(`| \`${t.id}\` ${t.title} | ${t.boundary} | ${t.description} | ${(t.stride ?? []).join(", ") || "—"} | ${t.requirementIds.map((r) => `\`${r}\``).join(", ")} | ${t.residualRisk} |`);
  }
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("En resterende risiko er ikke det samme som et fravær af trussel. Uafklarede risici (\"unassessed\") blokerer release indtil et navngivet menneske har vurderet dem.");
  lines.push("");
  return lines.join("\n");
}
