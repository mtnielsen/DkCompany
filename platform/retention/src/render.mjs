/**
 * DKC-021 — generering af den menneskelæste dækningstabel.
 *
 * Renderingen er ren og deterministisk: samme politik giver samme Markdown, så
 * `make retention-check` kan fejle ved drift mellem politik og dokument.
 */
export function renderMarkdown(policy) {
  const lines = [];
  lines.push("<!-- GENERERET af retention/src/cli.mjs fra retention/deletion-policy.json. Redigér politikken, ikke denne fil. -->");
  lines.push("");
  lines.push("# Slette- og tilbageholdelsesdækning");
  lines.push("");
  lines.push(policy.metadata.description);
  lines.push("");
  lines.push(`Version ${policy.metadata.version} · sidst gennemgået ${policy.metadata.lastReviewed} · godkendt af ${policy.approvedBy.name} (${policy.approvedAt}).`);
  lines.push("");
  lines.push("Et hold kræver en dokumenteret begrundelse og en **separat** godkender, og AI-principaler kan hverken slette eller lægge hold. Sletning blokeres af aktive holds i scope. En flade der ikke kan slette fysisk står som `partial` eller `unsupported` med en præcis begrundelse — aldrig som fuld.");
  lines.push("");

  lines.push("## Dækning pr. datalag");
  lines.push("");
  lines.push("| Flade | Lag | Dækning | Klasser | Slettemekanisme | Ejerskab | Begrundelse |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const surface of policy.surfaces) {
    lines.push(
      `| \`${surface.id}\` | ${surface.kind} | ${surface.coverage}${surface.external ? " (ekstern)" : ""} | ${surface.dataClasses.join(", ")} | ${surface.deleteMechanism} | ${surface.owner.name} | ${surface.reason ?? "—"} |`
    );
  }
  lines.push("");

  lines.push("## Resterende kopier");
  lines.push("");
  const residual = policy.surfaces.filter((s) => s.coverage !== "full");
  if (residual.length === 0) {
    lines.push("Ingen: alle datalag kan slette fysisk.");
  } else {
    lines.push("| Flade | Lag | Forventet udløb | Begrundelse |");
    lines.push("| --- | --- | --- | --- |");
    for (const surface of residual) {
      lines.push(`| \`${surface.id}\` | ${surface.kind} | ${surface.retentionDays} dage | ${surface.reason} |`);
    }
  }
  lines.push("");

  lines.push("## Ufravigelige regler");
  lines.push("");
  lines.push("| Regel | Værdi |");
  lines.push("| --- | --- |");
  for (const [rule, value] of Object.entries(policy.rules)) {
    lines.push(`| \`${rule}\` | ${value} |`);
  }
  lines.push("");

  lines.push("## Roller");
  lines.push("");
  lines.push(`- Sletning: ${policy.principals.deletionRoles.join(", ")}`);
  lines.push(`- Hold-godkendelse: ${policy.principals.holdApproverRoles.join(", ")}`);
  lines.push(`- AI nægtet: ${policy.principals.aiDenied ? "ja" : "nej"}`);
  lines.push("");
  return lines.join("\n");
}
