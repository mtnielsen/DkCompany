/**
 * DKC-049 — generering af logdækningsdokumentet.
 *
 * Dokumentet er afledt af den kanoniske politik og kontrolleres for sync i
 * `logging/src/check.mjs`, så politik og dokument ikke kan glide fra hinanden.
 */
const RETENTION_CLASSES = ["operational", "personal", "security"];

const DA_LABEL = { operational: "Operationel", personal: "Personhenførbar", security: "Sikkerhed" };

export function renderLogCoverage(policy) {
  const lines = [];
  lines.push("<!-- Genereret af `logging/src/cli.mjs write` fra logging/logging-policy.json — rediger ikke manuelt. -->");
  lines.push("# Logdækning (DKC-049)");
  lines.push("");
  lines.push(`> Kanonisk politik: \`${policy.metadata?.name}\` version \`${policy.metadata?.version}\`.`);
  lines.push("");
  lines.push("## Fælles korrelationsfelter");
  lines.push("");
  lines.push("Hver logpost bærer disse felter, så et forløb kan samles på tværs af servere:");
  lines.push("");
  for (const field of policy.correlationFields ?? []) lines.push(`- \`${field}\``);
  lines.push("");
  lines.push("## Provenance (adskilt)");
  lines.push("");
  lines.push(`Klasser: ${(policy.provenance?.classes ?? []).map((c) => `\`${c}\``).join(", ")}. Adskilte: \`${policy.provenance?.separated}\`.`);
  lines.push("");
  lines.push("Et modeludsagn kan ikke optræde i samme post som en sensorobservation eller et verificeret resultat.");
  lines.push("");
  lines.push("## Retention og arkiv pr. dataklasse");
  lines.push("");
  lines.push("| Dataklasse | Retention (dage) | Immutabelt krav | Arkivmål (fejldomæne) |");
  lines.push("| --- | --- | --- | --- |");
  for (const cls of RETENTION_CLASSES) {
    const targets = (policy.archive?.targets ?? []).filter((t) => (t.dataClasses ?? []).includes(cls));
    const targetText = targets.map((t) => `\`${t.id}\` (${t.failureDomain}${t.immutable ? ", WORM" : ""})`).join(", ") || "—";
    const immutable = (policy.archive?.requireImmutableFor ?? []).includes(cls) ? "ja" : "nej";
    lines.push(`| ${DA_LABEL[cls] ?? cls} | ${policy.retention?.[cls] ?? "—"} | ${immutable} | ${targetText} |`);
  }
  lines.push("");
  lines.push(`Mindste antal uafhængige fejldomæner: **${policy.archive?.minFailureDomains}**.`);
  lines.push("");
  lines.push("## Læseadgang");
  lines.push("");
  lines.push(`Default-deny: \`${policy.access?.defaultDeny}\`. Læseroller: ${(policy.access?.readerRoles ?? []).map((r) => `\`${r}\``).join(", ")}.`);
  lines.push(`Logadgang logges selv: \`${policy.access?.auditAccess}\`.`);
  lines.push("");
  lines.push("## Tidsynkronisering og redaktion");
  lines.push("");
  lines.push(`Maksimal tidsforskydning: **${policy.timeSync?.maxSkewSeconds} s**. Monotone sekvenser: \`${policy.timeSync?.monotonicSequences}\`.`);
  lines.push("");
  lines.push(`Persondatapolitik: \`${policy.redaction?.personalDataPolicy}\`. Skjulte ræsonneringsfelter fjernes: ${(policy.redaction?.forbiddenReasoningKeys ?? []).map((k) => `\`${k}\``).join(", ")}.`);
  lines.push("");
  return lines.join("\n");
}
