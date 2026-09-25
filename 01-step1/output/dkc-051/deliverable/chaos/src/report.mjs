/**
 * DKC-051 — rendering af fejl- og katastroferapporten.
 *
 * Rapporten er en deterministisk visning af matrixkørslen og bærer
 * `measured: false`. Den levende øvelse ligger i `docs/continuity/chaos-live.md`.
 */

export function renderChaosReport(report) {
  const lines = [];
  lines.push("# Fejl- og katastroferapport");
  lines.push("");
  lines.push("> Genereret fra `chaos/failure-matrix.json` med `make chaos-run`. Tallene er en **deterministisk model** (`measured: false`). En målt fejløvelse på en levende stagingklynge er en ekstern integration, se [`chaos-live.md`](chaos-live.md).");
  lines.push("");
  lines.push(`**Gate:** ${report.gate.status === "pass" ? "PASS" : "BLOCK"}`);
  if (report.gate.reasons.length) {
    lines.push("");
    lines.push("Blokerende afvigelser:");
    for (const reason of report.gate.reasons) lines.push(`- ${reason}`);
  }
  lines.push("");
  lines.push("## Invarianter");
  lines.push("");
  lines.push("| Invariant | Resultat |");
  lines.push("| --- | --- |");
  for (const [name, ok] of Object.entries(report.invariants)) {
    lines.push(`| ${name} | ${ok ? "PASS" : "FAIL"} |`);
  }
  lines.push("");
  lines.push("## Scenarier");
  lines.push("");
  lines.push("| Scenarie | Failure scope | Dataudfald | RPO mål/målt | RTO mål/målt | Autonomi | Split-brain | Tabte writes | Resultat |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const s of report.scenarios) {
    lines.push(
      `| ${s.id} | ${s.failureScope} | ${s.expectedDataOutcome} | ${s.rpoMinutes}/${s.measuredRpoMinutes} | ${s.rtoMinutes}/${s.measuredRtoMinutes} | ${s.allowedAutonomy} | ${s.splitBrain ? "ja" : "nej"} | ${s.lostAcknowledgedWrites} | ${s.status === "pass" ? "PASS" : "FAIL"} |`,
    );
  }
  lines.push("");
  lines.push("## Afvigelser");
  lines.push("");
  if (report.deviations.length === 0) {
    lines.push("Ingen. Alle scenarier og invarianter er opfyldt i modellen.");
  } else {
    for (const d of report.deviations) lines.push(`- **${d.id}** (${d.failureScope}): ${d.reasons.join("; ")}`);
  }
  lines.push("");
  lines.push("## Sådan gentages øvelsen");
  lines.push("");
  lines.push("```sh");
  lines.push("make chaos-run     # kører hele fejlmatrixen deterministisk");
  lines.push("make chaos-check   # validerer matrix og renderede artefakter");
  lines.push("```");
  lines.push("");
  lines.push("Øvelsen bruger kun syntetiske data og midlertidige filer og rydder op efter sig. Den kan køres fra en ren installation uden kundedata.");
  lines.push("");
  return lines.join("\n");
}
