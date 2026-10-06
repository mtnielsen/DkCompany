/**
 * DKC-056 — operatør-UI for datatjenester.
 *
 * Rækkene er de ansvarsområder, en databaseprofil skal besvare: hvem ejer
 * patching, backup, restore, nøgler og omkostninger. Renderingen er ren og
 * deterministisk (samme data → samme Markdown/HTML), så `data-services-check`
 * kan fejle ved drift mellem registry og dokument.
 */

const RESPONSIBILITIES = [
  ["patching", "Patching"],
  ["backup", "Backup"],
  ["restore", "Restore"],
  ["keys", "Nøgler"],
  ["costs", "Omkostninger"],
  ["monitoring", "Overvågning"],
  ["migration", "Migration"],
];

function ownerCell(entry) {
  if (!entry) return "—";
  return `${entry.owner} — ${entry.accountableHuman?.name ?? "?"} (${entry.accountableHuman?.role ?? "?"})`;
}

function testedVersions(profile) {
  return (profile.engine?.supportedVersions ?? []).map((v) => `${v.range}${v.tested ? "" : " (ikke testet)"}`).join(", ");
}

export function renderMarkdown({ profiles, sources, bindings }) {
  const lines = [];
  lines.push("<!-- GENERERET af data-services/src/cli.mjs fra data-services/. Redigér registry-data, ikke denne fil. -->");
  lines.push("");
  lines.push("# Datatjenester: indbyggede og eksterne kilder");
  lines.push("");
  lines.push("Platformen driver ikke sin egen databaseengine. Den beskriver en administreret profil og en BYO-profil mod understøttede motorer, og den fører et eksplicit ejerskab for patching, backup, restore, nøgler og omkostninger.");
  lines.push("");

  lines.push("## Databaseprofiler");
  lines.push("");
  lines.push("| Profil | Type | Motor | Understøttede versioner | Kryptering i hvile | Tenant-isolation | Backup | Verificeret restore |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const { data: p } of profiles) {
    lines.push(
      `| \`${p.metadata.name}\` | ${p.profileType} | ${p.engine.family} | ${testedVersions(p)} | ${p.secureDefaults.encryptionAtRest.required ? "påkrævet" : "ikke påkrævet"} | ${p.tenantIsolation.strategy} | ${p.backup.enabled ? "til" : "fra"} | ${p.backup.verifiedRestore ? "ja" : "nej"} |`
    );
  }
  lines.push("");

  lines.push("## Ansvarsmatrix");
  lines.push("");
  lines.push(`| Profil | ${RESPONSIBILITIES.map(([, label]) => label).join(" | ")} |`);
  lines.push(`| --- | ${RESPONSIBILITIES.map(() => "---").join(" | ")} |`);
  for (const { data: p } of profiles) {
    lines.push(`| \`${p.metadata.name}\` | ${RESPONSIBILITIES.map(([key]) => ownerCell(p.responsibilityMatrix[key])).join(" | ")} |`);
  }
  lines.push("");

  lines.push("## Datakilder (connectorer)");
  lines.push("");
  lines.push("| Kilde | Type | Dataejer | Klassifikation | Scope | Read-only | Auto-migrate | Auto-backup | Secret-reference |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const { data: s } of sources) {
    const scope = `${s.access.allowedSchemas.join("/")} → ${s.access.allowedTables.join(", ")}`;
    lines.push(
      `| \`${s.metadata.name}\` | ${s.sourceType} | ${s.dataOwnership.owner.name} | ${s.dataOwnership.classification} | ${scope} | ${s.access.readOnly ? "ja" : "nej"} | ${s.externalPolicy.autoMigrate ? "ja" : "nej"} | ${s.externalPolicy.autoBackup ? "ja" : "nej"} | \`${s.connection.secretRef}\` |`
    );
  }
  lines.push("");
  lines.push("En ekstern kilde er ikke platformens egen database: `treatAsOwnDatabase`, `autoMigrate` og `autoBackup` er kontraktuelt låst til `false`.");
  lines.push("");

  lines.push("## Applikationsbindinger");
  lines.push("");
  lines.push("| Binding | Applikation | Databaseprofil | Datakilder | Tenant-scope | Adskilt identitet |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const { data: b } of bindings) {
    lines.push(
      `| \`${b.metadata.name}\` | ${b.application.ref} | \`${b.databaseProfileRef}\` | ${b.dataSourceRefs.map((r) => r.ref).join(", ") || "—"} | ${b.tenantScope.mode} | ${b.tenantScope.separateIdentityPerTenant ? "ja" : "nej"} |`
    );
  }
  lines.push("");
  return lines.join("\n");
}

function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function table(headers, rows) {
  const head = `<tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr>`;
  const body = rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("\n");
  return `<table>\n<thead>${head}</thead>\n<tbody>\n${body}\n</tbody>\n</table>`;
}

/** HTML-operatørvisning (samme data som Markdown). */
export function renderHtml({ profiles, sources, bindings }) {
  const profileRows = profiles.map(({ data: p }) => [
    p.metadata.name,
    p.profileType,
    p.engine.family,
    testedVersions(p),
    p.tenantIsolation.strategy,
    p.backup.verifiedRestore ? "ja" : "nej",
  ]);
  const ownershipRows = profiles.map(({ data: p }) => [
    p.metadata.name,
    ...RESPONSIBILITIES.map(([key]) => ownerCell(p.responsibilityMatrix[key])),
  ]);
  const sourceRows = sources.map(({ data: s }) => [
    s.metadata.name,
    s.sourceType,
    s.dataOwnership.owner.name,
    s.dataOwnership.classification,
    `${s.access.allowedSchemas.join("/")} → ${s.access.allowedTables.join(", ")}`,
    s.externalPolicy.autoMigrate ? "ja" : "nej",
    s.externalPolicy.autoBackup ? "ja" : "nej",
  ]);
  const bindingRows = bindings.map(({ data: b }) => [
    b.metadata.name,
    b.application.ref,
    b.databaseProfileRef,
    b.dataSourceRefs.map((r) => r.ref).join(", ") || "—",
    b.tenantScope.mode,
  ]);

  return `<!doctype html>
<html lang="da">
<head>
<meta charset="utf-8">
<title>Datatjenester: ejerskab og scope</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 2rem; color: #1b1b1b; }
  table { border-collapse: collapse; margin-bottom: 2rem; }
  th, td { border: 1px solid #ccc; padding: 0.4rem 0.6rem; text-align: left; vertical-align: top; }
  th { background: #f0f0f0; }
  caption { text-align: left; font-weight: 600; margin-bottom: 0.5rem; }
</style>
</head>
<body>
<h1>Datatjenester: ejerskab og scope</h1>
<p>Genereret fra <code>data-services/</code>. Platformen driver ikke sin egen databaseengine.</p>
<table><caption>Databaseprofiler</caption><thead><tr><th>Profil</th><th>Type</th><th>Motor</th><th>Versioner</th><th>Tenant-isolation</th><th>Verificeret restore</th></tr></thead><tbody>
${profileRows.map((row) => `<tr>${row.map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`).join("\n")}
</tbody></table>
${table(["Profil", ...RESPONSIBILITIES.map(([, label]) => label)], ownershipRows)}
${table(["Kilde", "Type", "Dataejer", "Klassifikation", "Scope", "Auto-migrate", "Auto-backup"], sourceRows)}
${table(["Binding", "Applikation", "Databaseprofil", "Datakilder", "Tenant-scope"], bindingRows)}
</body>
</html>
`;
}
