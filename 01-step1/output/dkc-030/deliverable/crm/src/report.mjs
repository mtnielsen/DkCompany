/**
 * DKC-030 — render den deterministiske CRM-rapport.
 *
 * Samme korpus, politik og tidspunkt giver byte-identisk output, så
 * `crm-check` kan afvise en rapport der er ude af trit med kilden.
 */
import { REPORT_PATH, REPORT_DOC_PATH } from "./model.mjs";

function renderDoc(report) {
  const lines = [];
  lines.push("# CRM med entydigt ejerskab af kundedata — rapport");
  lines.push("");
  lines.push("> Genereret af `make crm-render` som en deterministisk kontrol. **Målt:** nej — en levende EspoCRM-installation og et rigtigt API-token kræver en ekstern kilde.");
  lines.push("");
  lines.push(`- **Genereret:** ${report.generatedAt}`);
  lines.push(`- **Poster:** ${report.totals.records} (${report.totals.accounts} virksomheder, ${report.totals.contacts} kontakter, ${report.totals.opportunities} salgsforløb) på ${report.totals.tenants} tenant(s)`);
  lines.push(`- **Aktiviteter:** ${report.totals.activities}`);
  lines.push(`- **Valgt kandidat:** ${report.candidateSample?.selected ?? "—"}`);
  lines.push("");
  lines.push("## Kandidatcheck");
  lines.push("");
  lines.push("| Produkt | Version | Score | Begrundelser | Gate |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const c of report.candidateSample?.candidates ?? []) {
    lines.push(`| ${c.name} | ${c.exactVersion} | ${c.score} | ${c.reasons.join(", ") || "—"} | ${c.gateStatus} |`);
  }
  lines.push("");
  lines.push("## Scenarier");
  lines.push("");
  lines.push("| Scenarie | Principal | Resultat | Synlige | Skjulte |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const s of report.scenarios) {
    lines.push(`| ${s.id} | ${s.principal ?? "—"} | ${(s.problems ?? []).length === 0 ? "PASS" : "FAIL"} | ${(s.visible ?? []).join(", ") || "—"} | ${(s.hidden ?? []).join(", ") || "—"} |`);
  }
  lines.push("");
  lines.push("## Tværgående sletning");
  lines.push("");
  lines.push(`- Status: ${report.deletionSample?.status ?? "—"}`);
  lines.push(`- Flader: primary=${report.deletionSample?.surfaces?.primary?.status ?? "—"}, activities=${report.deletionSample?.surfaces?.activities?.status ?? "—"}, index=${report.deletionSample?.surfaces?.index?.status ?? "—"}, copies=${report.deletionSample?.surfaces?.copies?.status ?? "—"}, backup=${report.deletionSample?.surfaces?.backup?.status ?? "—"}`);
  lines.push(`- Resterende kopier: ${(report.deletionSample?.remainingCopies ?? []).map((c) => `${c.kind} (${c.expiresAt})`).join(", ") || "ingen"}`);
  lines.push("");
  lines.push("## Backup og gendannelse");
  lines.push("");
  lines.push(`- Poster før/efter: ${report.backup?.recordsBefore ?? "—"} / ${report.backup?.recordsAfter ?? "—"}`);
  lines.push(`- Aktiviteter bevaret: ${report.backup?.ok ? "ja" : "nej"}`);
  lines.push("");
  return lines.join("\n") + "\n";
}

export function renderCrmReport(report) {
  const rendered = new Map();
  rendered.set(REPORT_PATH, JSON.stringify(report, null, 2) + "\n");
  rendered.set(REPORT_DOC_PATH, renderDoc(report));
  return rendered;
}
