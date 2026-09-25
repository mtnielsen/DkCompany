/**
 * DKC-061 — render den deterministiske livscyklusrapport.
 *
 * Samme releasekatalog, supportpolitik og offlinepakke giver byte-identisk
 * output, så `lifecycle-check` kan afvise en rapport der er ude af trit med
 * kilden.
 */
import { REPORT_PATH, REPORT_DOC_PATH } from "./lifecycle-model.mjs";

function renderDoc(report) {
  const lines = [];
  lines.push("# Produktlivscyklus — rapport");
  lines.push("");
  lines.push("> Genereret af `make lifecycle-render` som en deterministisk kontrol. **Målt:** nej — en rigtig opdatering eller fjernelse på en levende installation kræver ekstern infrastruktur.");
  lines.push("");
  lines.push(`- **Genereret:** ${report.generatedAt}`);
  lines.push(`- **Releases:** ${report.totals.releases} (${report.totals.stableReleases} stabile), **låste komponenter:** ${report.totals.lockedComponents}`);
  lines.push(`- **Support-allowlist:** ${report.totals.supportAllowlist} kilder, **eksterne afhængigheder:** ${report.totals.externalDependencies}, **kerneflows:** ${report.totals.coreFlows}`);
  lines.push("");
  lines.push("## Scenarier");
  lines.push("");
  lines.push("| Scenarie | Principal | Bevisniveau | Resultat |");
  lines.push("| --- | --- | --- | --- |");
  for (const s of report.scenarios) {
    lines.push(`| ${s.id} | ${s.principal ?? "—"} | ${s.evidenceLevel ?? "real"} | ${(s.problems ?? []).length === 0 ? "PASS" : "FAIL"} |`);
  }
  lines.push("");
  lines.push("## Acceptkriterier");
  lines.push("");
  const criteria = [
    ["Delt database/IAM afvises ved aktive moduler", "shared-database-and-iam-removal-rejected"],
    ["Almindelig uninstall bevarer data og recoverymetadata", "uninstall-preserves-data-and-recovery-metadata"],
    ["Udgået/tilbagekaldt pakke viser status og håndtering", "release-catalog-signed-and-lifecycle-visible"],
    ["Afbrudt upgrade genoptages eller gendannes", "update-impact-migration-approval-resume-rollback"],
    ["Supportbundle uden secrets/HR", "support-bundle-redacted-no-secrets-no-hr-no-hidden-access"],
    ["Internet-/LLM-udfald bevarer lokale kerneflows", "offline-local-core-flows-preserved-external-visible"],
  ];
  for (const [label, id] of criteria) {
    const s = report.scenarios.find((x) => x.id === id);
    lines.push(`- ${(s && (s.problems ?? []).length === 0) ? "✔" : "✘"} ${label} (\`${id}\`)`);
  }
  lines.push("");
  return lines.join("\n") + "\n";
}

export function renderLifecycleReport(report) {
  const rendered = new Map();
  rendered.set(REPORT_PATH, JSON.stringify(report, null, 2) + "\n");
  rendered.set(REPORT_DOC_PATH, renderDoc(report));
  return rendered;
}
