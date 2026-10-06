/**
 * DKC-032 — rendering af skygge- og autonomirapporten.
 *
 * Rapporten er en deterministisk visning af replay-kørslen og bærer
 * `measured: false`. Den levende måling ligger i `docs/ai-operations/shadow-live.md`.
 */

function pct(value) {
  return value == null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function verdict(run) {
  return run?.verdict === "pass" ? "PASS" : "FAIL";
}

export function renderShadowReport(report) {
  const lines = [];
  lines.push("# AI i skyggetilstand og begrænset autonomi");
  lines.push("");
  lines.push("> Genereret fra `shadow/autonomy-policy.json` og `shadow/replay-dataset.json` med `make shadow-run`. Tallene er en **deterministisk replay** (`measured: false`). En målt kørsel mod en levende model og en levende stagingklynge er en ekstern integration, se [`shadow-live.md`](shadow-live.md).");
  lines.push("");
  lines.push(`**Gate:** ${report.gate.status === "pass" ? "PASS" : "BLOCK"}`);
  lines.push("");
  lines.push(`- Bevillingsversion: ${report.grantVersion}`);
  lines.push(`- Model-/promptfingeraftryk: \`${report.fingerprint}\``);
  lines.push(`- Replayede hændelser: ${report.shadow.eventsReplayed}`);
  lines.push("");
  if (report.gate.reasons.length) {
    lines.push("Blokerende afvigelser:");
    for (const reason of report.gate.reasons) lines.push(`- ${reason}`);
    lines.push("");
  }
  lines.push("## Invarianter");
  lines.push("");
  lines.push("| Invariant | Skyggetilstand | Begrænset autonomi |");
  lines.push("| --- | --- | --- |");
  lines.push(`| Nul muterende handlinger | ${report.shadow.mutationCount === 0 ? "PASS" : "FAIL"} | n/a (staging) |`);
  lines.push(`| Kun forhåndsgodkendte runbooks | PASS | ${report.limitedAutonomy.safety.approvedRunbooksOnly ? "PASS" : "FAIL"} |`);
  lines.push(`| Nødstop respekteret | PASS | ${report.limitedAutonomy.safety.killSwitchClear ? "PASS" : "FAIL"} |`);
  lines.push(`| Governance tilgængelig | PASS | ${report.limitedAutonomy.safety.governanceAvailable ? "PASS" : "FAIL"} |`);
  lines.push(`| Evalueringsfingeraftryk matcher | ${report.shadow.safety.evaluationFingerprintMatch ? "PASS" : "FAIL"} | ${report.limitedAutonomy.safety.evaluationFingerprintMatch ? "PASS" : "FAIL"} |`);
  lines.push(`| Samlet resultat | ${verdict(report.shadow)} | ${verdict(report.limitedAutonomy)} |`);
  lines.push("");
  lines.push("## Målte effekter");
  lines.push("");
  lines.push("| Måling | Skyggetilstand | Begrænset autonomi | Grænse |");
  lines.push("| --- | --- | --- | --- |");
  const s = report.shadow.metrics;
  const l = report.limitedAutonomy.metrics;
  const t = report.thresholds ?? {};
  lines.push(`| Falske alarmer | ${s.falseAlarms} (${pct(s.falseAlarmRate)}) | ${l.falseAlarms} (${pct(l.falseAlarmRate)}) | ${pct(t.maxFalseAlarmRate)} |`);
  lines.push(`| Fejl (forkert handling) | ${s.errors} (${pct(s.errorRate)}) | ${l.errors} (${pct(l.errorRate)}) | ${pct(t.maxErrorRate)} |`);
  lines.push(`| Eskalationer | ${s.escalations} (${pct(s.escalationRate)}) | ${l.escalations} (${pct(l.escalationRate)}) | ${pct(t.maxEscalationRate)} |`);
  lines.push(`| Omkostning (EUR) | ${s.costEur} | ${l.costEur} | ${t.maxCostEur ?? "—"} |`);
  lines.push(`| Reviewerens ekstra fund | ${s.reviewerFindings} | ${l.reviewerFindings} | ${t.maxReviewerFindings ?? "—"} |`);
  lines.push(`| Udførte mutationer | ${s.executedMutations} | ${l.executedMutations} | — |`);
  lines.push("");
  lines.push("## Evalueringshistorik (gentaget evaluering)");
  lines.push("");
  lines.push("| Kørsel | Fingeraftryk | Hændelser | Falsk alarm | Fejl | Eskalering | EUR | Reviewer | Bestået |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const run of report.evaluationRuns ?? []) {
    lines.push(`| ${run.runId} | \`${String(run.fingerprint).slice(0, 12)}…\` | ${run.events} | ${pct(run.falseAlarmRate)} | ${pct(run.errorRate)} | ${pct(run.escalationRate)} | ${run.costEur} | ${run.reviewerFindings} | ${run.passed ? "PASS" : "FAIL"} |`);
  }
  lines.push("");
  lines.push("## Afviste og eskalerede forslag (begrænset autonomi)");
  lines.push("");
  const escalated = report.limitedAutonomy.decisions.filter((d) => !d.execution.executed && d.execution.reason && d.proposal.mutating);
  if (escalated.length === 0) {
    lines.push("Ingen muterende forslag blev afvist.");
  } else {
    for (const d of escalated) lines.push(`- \`${d.eventId}\` ${d.proposal.verb} @ ${d.target}: ${d.execution.reason}`);
  }
  lines.push("");
  lines.push("## Sådan gentages kørslen");
  lines.push("");
  lines.push("```sh");
  lines.push("make shadow-run     # replay i skyggetilstand og simuleret staging");
  lines.push("make shadow-check   # validerer bevilling, datasæt og renderede artefakter");
  lines.push("make shadow-test    # kører enheds- og konformanstestene");
  lines.push("```");
  lines.push("");
  lines.push("Replayet bruger kun anonymiserede, syntetiske hændelser og rydder op efter sig. Det kan køres fra en ren installation uden kundedata.");
  lines.push("");
  return lines.join("\n");
}
