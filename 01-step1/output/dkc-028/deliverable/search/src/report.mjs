/**
 * DKC-028 — render den deterministiske søgerapport.
 *
 * Samme korpus, politik og tidspunkt giver byte-identisk output, så
 * `search-check` kan afvise en rapport der er ude af trit med kilden.
 */
import { REPORT_PATH, REPORT_DOC_PATH } from "./model.mjs";

function renderDoc(report) {
  const lines = [];
  lines.push("# Rettighedsbevidst videnssøgning — rapport");
  lines.push("");
  lines.push("> Genereret af `make search-render` som en deterministisk kontrol. **Målt:** nej — en faktisk målt slettefrist på en levende BookStack kræver en ekstern kilde.");
  lines.push("");
  lines.push(`- **Genereret:** ${report.generatedAt}`);
  lines.push(`- **Dokumenter:** ${report.totals.documents} (${report.totals.privateDocuments} fortrolige/personlige), tenants: ${report.totals.tenants}`);
  lines.push(`- **Indeks genindlæst fra disk:** ${report.persistedIndexReloaded ? "ja" : "nej"}`);
  lines.push(`- **Slettefrist:** ${report.deletion.elapsedMs} ms brugt af ${report.deletion.deadlineMs} ms (målt: nej)`);
  lines.push("");
  lines.push("## Scenarier");
  lines.push("");
  lines.push("| Scenarie | Principal | Resultat | Synlige kilder | Skjulte kilder |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const s of report.scenarios) {
    lines.push(`| ${s.id} | ${s.principal ?? "—"} | ${(s.problems ?? []).length === 0 ? "PASS" : "FAIL"} | ${(s.visible ?? []).join(", ") || "—"} | ${(s.hidden ?? []).join(", ") || "—"} |`);
  }
  lines.push("");
  lines.push("## Slettefrist");
  lines.push("");
  lines.push(`- Slettet dokument: \`${report.deletion.documentId}\``);
  lines.push(`- Fjernet fra indeks: ${report.deletion.removedFromIndex ? "ja" : "nej"}`);
  lines.push(`- Cache invalideret: ${report.deletion.cacheInvalidated ? "ja" : "nej"}`);
  lines.push("");
  lines.push("## Injektionsneutralisering");
  lines.push("");
  const injection = report.scenarios.find((s) => s.id === "prompt-injection");
  lines.push(`- Fund: ${(injection?.injectionFindings ?? []).join(", ") || "ingen"}`);
  lines.push("- Værktøjsforslag: 0 (indhold kan ikke aktivere et værktøj)");
  lines.push("");
  return lines.join("\n") + "\n";
}

export function renderSearchReport(report) {
  const rendered = new Map();
  rendered.set(REPORT_PATH, JSON.stringify(report, null, 2) + "\n");
  rendered.set(REPORT_DOC_PATH, renderDoc(report));
  return rendered;
}
