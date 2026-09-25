/**
 * DKC-059 — render den deterministiske providerrapport.
 *
 * Samme katalog, register, matrix, politik og fixtures giver byte-identisk
 * output, så `provider-check` kan afvise en rapport der er ude af trit med
 * kilden.
 */
import { REPORT_PATH, REPORT_DOC_PATH } from "./provider-model.mjs";

function renderDoc(report) {
  const lines = [];
  lines.push("# Providerkontrakter og migrationskontrol — rapport");
  lines.push("");
  lines.push("> Genereret af `make provider-render` som en deterministisk kontrol. **Målt:** nej — en rigtig backendudskiftning eller appmigration mod en levende upstream kræver ekstern infrastruktur.");
  lines.push("");
  lines.push(`- **Genereret:** ${report.generatedAt}`);
  lines.push(`- **Providerklasser:** ${report.totals.classes}, **capabilities:** ${report.totals.capabilities} (${report.totals.mandatory} obligatoriske, ${report.totals.securityCritical} sikkerhedskritiske)`);
  lines.push(`- **Providere:** ${report.totals.providers}, **kompatibilitetsrækker:** ${report.totals.compatibilityRows}, **fixtures:** ${report.totals.fixtures}`);
  lines.push("");
  lines.push("## Supportmatrix");
  lines.push("");
  lines.push("| Skift | Klasse | Tilstand | Forhandling | Tilladt |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const row of report.compatibility) {
    lines.push(`| ${row.from} → ${row.to} | ${row.class} | ${row.mode} | ${row.status} | ${row.allowed ? "ja" : "nej"} |`);
  }
  lines.push("");
  lines.push("## Scenarier");
  lines.push("");
  lines.push("| Scenarie | Principal | Bevisniveau | Resultat |");
  lines.push("| --- | --- | --- | --- |");
  for (const s of report.scenarios) {
    lines.push(`| ${s.id} | ${s.principal ?? "—"} | ${s.evidenceLevel ?? "real"} | ${(s.problems ?? []).length === 0 ? "PASS" : "FAIL"} |`);
  }
  lines.push("");
  lines.push("## Funktionstab ved appmigration");
  lines.push("");
  const appMigration = report.scenarios.find((s) => s.id === "verified-app-migration");
  for (const entry of appMigration?.functionalityLoss ?? []) {
    lines.push(`- ${entry.entityType}/${entry.facet} (${entry.status}): ${entry.note}`);
  }
  if (!(appMigration?.functionalityLoss ?? []).length) lines.push("- Ingen vist.");
  lines.push("");
  return lines.join("\n") + "\n";
}

export function renderProviderReport(report) {
  const rendered = new Map();
  rendered.set(REPORT_PATH, JSON.stringify(report, null, 2) + "\n");
  rendered.set(REPORT_DOC_PATH, renderDoc(report));
  return rendered;
}
