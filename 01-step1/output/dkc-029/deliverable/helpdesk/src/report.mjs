/**
 * DKC-029 — render den deterministiske sagsbehandlingsrapport.
 *
 * Samme korpus, politik og tidspunkt giver byte-identisk output, så
 * `helpdesk-check` kan afvise en rapport der er ude af trit med kilden.
 */
import { REPORT_PATH, REPORT_DOC_PATH } from "./model.mjs";

function renderDoc(report) {
  const lines = [];
  lines.push("# Support og sagsbehandling — rapport");
  lines.push("");
  lines.push("> Genereret af `make helpdesk-render` som en deterministisk kontrol. **Målt:** nej — en faktisk Zammad-installation og et rigtigt token kræver en ekstern kilde.");
  lines.push("");
  lines.push(`- **Genereret:** ${report.generatedAt}`);
  lines.push(`- **Sager:** ${report.totals.tickets} på ${report.totals.tenants} tenant(s), ${report.totals.messages} beskeder, ${report.totals.attachments} vedhæftninger (${report.totals.quarantinedAttachments} i karantæne)`);
  lines.push(`- **Butik genindlæst fra disk:** ${report.persistedStoreReloaded ? "ja" : "nej"}`);
  lines.push(`- **Historikdigest:** \`${report.historyDigest}\``);
  lines.push("");
  lines.push("## Scenarier");
  lines.push("");
  lines.push("| Scenarie | Principal | Resultat | Synlige | Skjulte |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const s of report.scenarios) {
    lines.push(`| ${s.id} | ${s.principal ?? "—"} | ${(s.problems ?? []).length === 0 ? "PASS" : "FAIL"} | ${(s.visible ?? []).join(", ") || "—"} | ${(s.hidden ?? []).join(", ") || "—"} |`);
  }
  lines.push("");
  lines.push("## Backup og gendannelse");
  lines.push("");
  lines.push(`- Sager før/efter: ${report.backup?.ticketsBefore ?? "—"} / ${report.backup?.ticketsAfter ?? "—"}`);
  lines.push(`- Historik bevaret: ${report.backup?.ok ? "ja" : "nej"}`);
  lines.push("");
  lines.push("## Retention");
  lines.push("");
  lines.push(`- Sletterapport: ${report.deletionSample?.status ?? "—"}`);
  lines.push(`- Flader: mail=${report.deletionSample?.surfaces?.mail?.status ?? "—"}, bilag=${report.deletionSample?.surfaces?.attachments?.status ?? "—"}, indeks=${report.deletionSample?.surfaces?.index?.status ?? "—"}`);
  lines.push(`- Retention: ${report.retention?.mailExpired ?? 0} mail / ${report.retention?.attachmentsExpired ?? 0} bilag / ${report.retention?.indexExpired ?? 0} indeks ældre end grænsen`);
  lines.push("");
  return lines.join("\n") + "\n";
}

export function renderHelpdeskReport(report) {
  const rendered = new Map();
  rendered.set(REPORT_PATH, JSON.stringify(report, null, 2) + "\n");
  rendered.set(REPORT_DOC_PATH, renderDoc(report));
  return rendered;
}
