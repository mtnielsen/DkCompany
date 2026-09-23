/**
 * 3.2 — Rendering og konsistenskontrol af kontrolmappingen.
 *
 * Renderingen er ren: den tager et mapping-objekt og giver Markdown. Dermed kan
 * den testes uden filsystem, og docs/compliance/mapping.md kan altid genskabes
 * fra den kanoniske kilde compliance/control-mapping.json.
 */

/** Krydsreferencer og dubletter, som skemaet ikke fanger. */
export function findProblems(mapping) {
  const problems = [];
  const frameworkIds = new Set();
  const requirementIds = new Set();

  for (const framework of mapping.frameworks ?? []) {
    if (frameworkIds.has(framework.id)) problems.push(`framework '${framework.id}' er angivet flere gange`);
    frameworkIds.add(framework.id);
    for (const req of framework.requirements ?? []) {
      if (requirementIds.has(req.id)) problems.push(`krav '${req.id}' er angivet flere gange`);
      requirementIds.add(req.id);
    }
  }

  const controlIds = new Set();
  for (const control of mapping.controls ?? []) {
    if (controlIds.has(control.id)) problems.push(`kontrol '${control.id}' er angivet flere gange`);
    controlIds.add(control.id);
    for (const req of control.satisfies ?? []) {
      if (!requirementIds.has(req)) problems.push(`kontrol '${control.id}' peger på ukendt krav '${req}'`);
    }
  }
  return problems;
}

export function renderMarkdown(mapping) {
  const lines = [];
  lines.push("<!-- GENERERET af compliance/src/cli.mjs fra compliance/control-mapping.json. Redigér registry, ikke denne fil. -->");
  lines.push("");
  lines.push("# Kontrolmapping: NIS2, GDPR og AI Act");
  lines.push("");
  lines.push(mapping.metadata.description);
  lines.push("");
  lines.push(`Version ${mapping.metadata.version} · sidst gennemgået ${mapping.metadata.lastReviewed}.`);
  lines.push("");
  lines.push("## Rollefordeling: udgiver og deployer");
  lines.push("");
  lines.push(`- **Udgiver (platformen):** ${mapping.roleStatement.issuer}`);
  lines.push(`- **Deployer (organisationen):** ${mapping.roleStatement.deployer}`);
  lines.push(`- **Delt ansvar:** ${mapping.roleStatement.shared}`);
  lines.push("");
  lines.push("Kortlægningen er en påstand om mekanismer, ikke om juridisk compliance. Repoet er ikke «compliant software».");
  lines.push("");
  lines.push("## Kontroller");
  lines.push("");
  lines.push("| Kontrol | Titel | Rolle | Opfylder | Evidens |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const control of mapping.controls) {
    lines.push(`| \`${control.id}\` | ${control.title} | ${control.role} | ${control.satisfies.join(", ")} | ${control.evidence.join(", ")} |`);
  }
  lines.push("");
  lines.push("## Krav pr. framework");
  for (const framework of mapping.frameworks) {
    lines.push("");
    lines.push(`### ${framework.name}`);
    if (framework.description) {
      lines.push("");
      lines.push(framework.description);
    }
    lines.push("");
    lines.push("| Krav | Titel | Rolle |");
    lines.push("| --- | --- | --- |");
    for (const req of framework.requirements) {
      lines.push(`| \`${req.id}\` | ${req.title} | ${req.role} |`);
    }
  }
  lines.push("");
  return lines.join("\n");
}
