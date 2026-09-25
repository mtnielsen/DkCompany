/**
 * DKC-062 — render den deterministiske acceptrapport.
 *
 * Samme scenariesæt, gate-politik, RACI og ejeraccept-register giver
 * byte-identisk output, så `acceptance-check` kan afvise en rapport der er ude
 * af trit med kilden. Rapporten måler intet på en levende installation.
 */
import { REPORT_PATH, REPORT_DOC_PATH } from "./acceptance-model.mjs";

function renderDoc(report) {
  const lines = [];
  lines.push("# Installations- og releaseacceptance — rapport");
  lines.push("");
  lines.push("> Genereret af `make acceptance-render` som en deterministisk kontrol. **Målt:** nej — en rigtig VPS/lokal/HA-installation og den menneskelige ejeraccept er særskilt NOT RUN.");
  lines.push("");
  lines.push(`- **Genereret:** ${report.generatedAt}`);
  lines.push(`- **Mål:** ${report.targets.length}, **scenarier:** ${report.scenarioCount}, **rollebrud:** ${report.roleViolations.length}`);
  lines.push("");
  lines.push("## Acceptmål og gates");
  lines.push("");
  lines.push("| Mål | Profil | Beslutning | Aktive gates | Afventer ejeraccept |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const result of report.targets) {
    const active = result.gates.filter((g) => g.applicable).length;
    lines.push(`| ${result.target.id} | ${result.target.profileRef} | ${result.decision} | ${active} | ${result.ownerAcceptance.pendingGates.join(", ") || "—"} |`);
  }
  lines.push("");
  lines.push("## Gate-status pr. mål");
  lines.push("");
  for (const result of report.targets) {
    lines.push(`### ${result.target.id}`);
    lines.push("");
    lines.push("| Gate | Anvendelig | Testbevis | Ejeraccept | Status |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const gate of result.gates) {
      lines.push(`| ${gate.id} | ${gate.applicable ? "ja" : "nej"} | ${gate.evidenceStatus} | ${gate.ownerAcceptanceStatus} | ${gate.status} |`);
    }
    lines.push("");
  }
  lines.push("## Brugerrejser");
  lines.push("");
  lines.push("| Scenarie | Rejse | Profil | Platform | Resultat |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const outcome of report.outcomes) {
    lines.push(`| ${outcome.id} | ${outcome.journey} | ${outcome.profileRef} | ${outcome.platformRef} | ${outcome.status === "passed" ? "PASS" : "FAIL"} |`);
  }
  lines.push("");
  lines.push("## Acceptkriterier");
  lines.push("");
  const activeGates = report.targets.flatMap((r) => r.gates.filter((g) => g.applicable));
  const allEvidence = activeGates.every((g) => g.evidenceStatus === "passed");
  const allOwner = activeGates.every((g) => g.ownerAcceptanceStatus === "accepted");
  const scenariosPass = report.outcomes.every((o) => o.status === "passed");
  const criteria = [
    ["Deterministiske brugerrejser består", scenariosPass],
    ["Alle aktive gates har gyldigt testbevis i fixturekørslen", allEvidence],
    ["Alle aktive gates har registreret menneskelig ejeraccept", allOwner],
    ["Ingen agent kan udføre to roller (rotation/alias/subagent)", report.roleViolations.length === 0],
  ];
  for (const [label, ok] of criteria) lines.push(`- ${ok ? "✔" : "✘"} ${label}`);
  lines.push("");
  lines.push("En `✘` på ejeraccept er forventet, indtil et navngivet menneske registrerer sin accept i `distribution/acceptance/owner-acceptance.json`.");
  lines.push("");
  return lines.join("\n") + "\n";
}

export function renderAcceptanceReport(report) {
  const rendered = new Map();
  rendered.set(REPORT_PATH, JSON.stringify(report, null, 2) + "\n");
  rendered.set(REPORT_DOC_PATH, renderDoc(report));
  return rendered;
}
