/**
 * DKC-031 — render den deterministiske migrationsrapport.
 *
 * Samme kilder, politik, korpus og tidspunkt giver byte-identisk output, så
 * `migration-check` kan afvise en rapport der er ude af trit med kilden.
 */
import { REPORT_PATH, REPORT_DOC_PATH } from "./model.mjs";

function renderDoc(report) {
  const lines = [];
  lines.push("# Migrations- og exitværktøjer — rapport");
  lines.push("");
  lines.push("> Genereret af `make migration-render` som en deterministisk kontrol. **Målt:** nej — en rigtig kilde, en rigtig cutover og en menneskelig pilotgodkendelse kræver en ekstern installation.");
  lines.push("");
  lines.push(`- **Genereret:** ${report.generatedAt}`);
  lines.push(`- **Pilotapps:** ${report.totals.pilotApps}, **kilder:** ${report.totals.sources} på ${report.totals.tenants} tenant(s)`);
  lines.push(`- **Poster i det deterministiske løb:** ${report.totals.records}`);
  lines.push(`- **Tabte facetter vist før cutover:** ${report.totals.lostFacets}`);
  lines.push("");
  lines.push("## Valgt kildeformat pr. pilotapp");
  lines.push("");
  lines.push("| Kilde | App | Format | Entiteter |");
  lines.push("| --- | --- | --- | --- |");
  for (const source of report.sourceSummaries) {
    lines.push(`| ${source.sourceId} | ${source.appId} | ${source.format} | ${source.reconciliation.counts.source} |`);
  }
  lines.push("");
  lines.push("## Dækningsmatrix");
  lines.push("");
  lines.push(`- Fuldt understøttet: ${report.coverage.summary.full}`);
  lines.push(`- Delvist: ${report.coverage.summary.partial}`);
  lines.push(`- Ikke understøttet: ${report.coverage.summary.unsupported}`);
  lines.push("");
  lines.push("| App | Entitet | Facet | Status | Kilde | Forklaring |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const row of report.coverage.matrix) {
    lines.push(`| ${row.appId} | ${row.entityType} | ${row.facet} | ${row.status} | ${row.source ?? "—"} | ${row.note ?? "—"} |`);
  }
  lines.push("");
  lines.push("## Scenarier");
  lines.push("");
  lines.push("| Scenarie | Principal | Resultat |");
  lines.push("| --- | --- | --- |");
  for (const s of report.scenarios) {
    lines.push(`| ${s.id} | ${s.principal ?? "—"} | ${(s.problems ?? []).length === 0 ? "PASS" : "FAIL"} |`);
  }
  lines.push("");
  lines.push("## Cutover og rollback");
  lines.push("");
  lines.push(`- Cutover: ${report.cutoverSample?.status ?? "—"}`);
  lines.push(`- Rollback: ${report.cutoverSample?.rollback ?? "—"}`);
  lines.push(`- Tabt funktionalitet i planen: ${report.cutoverSample?.coverageLosses ?? 0}`);
  for (const item of report.cutoverSample?.lostFunctionality ?? []) lines.push(`  - ${item}`);
  lines.push("");
  lines.push("## Exit-eksport");
  lines.push("");
  lines.push(`- Poster: ${report.exportSample?.recordCount ?? "—"}`);
  lines.push(`- Checksum: ${report.exportSample?.checksum ?? "—"}`);
  lines.push(`- Kan læses uden platformen: ${report.exportSample?.readableWithoutPlatform ? "ja" : "nej"}`);
  lines.push(`- Filer: ${(report.exportSample?.files ?? []).map((f) => f.path).join(", ") || "—"}`);
  lines.push("");
  return lines.join("\n") + "\n";
}

export function renderMigrationReport(report) {
  const rendered = new Map();
  rendered.set(REPORT_PATH, JSON.stringify(report, null, 2) + "\n");
  rendered.set(REPORT_DOC_PATH, renderDoc(report));
  return rendered;
}
