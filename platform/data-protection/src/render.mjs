/**
 * DKC-047 — generering af den menneskelæste beskyttelsestabel.
 *
 * Renderingen er ren og deterministisk: samme register giver samme Markdown, så
 * `make data-protection-check` kan fejle ved drift mellem register og dokument.
 */
export function renderMarkdown(register, policy) {
  const lines = [];
  lines.push("<!-- GENERERET af data-protection/src/cli.mjs fra data-protection/records/register.json. Redigér registeret, ikke denne fil. -->");
  lines.push("");
  lines.push("# Beskyttede dataklasser (AI-immutable)");
  lines.push("");
  lines.push(register.metadata.description);
  lines.push("");
  lines.push(`Version ${register.metadata.version} · sidst gennemgået ${register.metadata.lastReviewed}.`);
  lines.push("");
  lines.push("Tre forbud holdes adskilt: AI må ikke **ændre** beskyttede data, WORM-retention kræver en vurderet og endelig frist, og **no-AI-access** er et selvstændigt adgangsflag der også udelukker retrieval, prompts, logs og trænings-/analyseflows.");
  lines.push("");

  lines.push("## Register");
  lines.push("");
  lines.push("| Post | Klasse | No-AI-access | Ejer | Nøgledomæne | Retention | Lagerhåndhævelse |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const record of register.records) {
    const retention = record.retention ? `${record.retention.maxDays} dage (${record.retention.purpose})` : "—";
    lines.push(
      `| \`${record.id}\` | ${record.dataClass} | ${record.noAiAccess ? "ja" : "nej"} | ${record.owner.name} | ${record.keyDomain} | ${retention} | ${record.storageEnforcement.status}${record.storageEnforcement.deliveredBy ? ` (${record.storageEnforcement.deliveredBy})` : ""} |`
    );
  }
  lines.push("");

  lines.push("## AI-adgang pr. klasse");
  lines.push("");
  lines.push("| Klasse | AI-operationer tilladt |");
  lines.push("| --- | --- |");
  for (const [cls, ops] of Object.entries(policy.agentOperationMatrix)) {
    lines.push(`| ${cls} | ${ops.join(", ")} |`);
  }
  lines.push("");
  lines.push(`No-AI-access udelukker alle AI-operationer for en post. AI-forbudte operationer uanset klasse: ${policy.aiForbiddenOperations.join(", ")}.`);
  lines.push("");

  lines.push("## Ærlig lagerhåndhævelse");
  lines.push("");
  lines.push("| Post | Status | Leveres af | Begrundelse |");
  lines.push("| --- | --- | --- | --- |");
  for (const record of register.records) {
    lines.push(`| \`${record.id}\` | ${record.storageEnforcement.status} | ${record.storageEnforcement.deliveredBy ?? "—"} | ${record.storageEnforcement.reason} |`);
  }
  lines.push("");

  lines.push("## Forbrugere");
  lines.push("");
  lines.push("| Post | Moduler/routes |");
  lines.push("| --- | --- |");
  for (const record of register.records) {
    lines.push(`| \`${record.id}\` | ${record.consumerModules.join(", ")} |`);
  }
  lines.push("");
  return lines.join("\n");
}
