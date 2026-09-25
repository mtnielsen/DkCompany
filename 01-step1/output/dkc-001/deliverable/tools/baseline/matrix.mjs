import { LEVELS, COMPONENTS } from "./registry.mjs";

const LEVEL_RANK = { real: 0, mock: 1, fixture: 2, contract: 3, integration: 4 };

const ICON = { pass: "PASS", fail: "FAIL", "not-run": "NOT RUN", error: "ERROR" };
const RESULT_ICON = { pass: "✔", fail: "✘", "not-run": "•", error: "✘" };

function shortCommand(command) {
  return "`" + command.join(" ") + "`";
}

function componentLevel(checkResults) {
  const levels = [...new Set(checkResults.map((c) => c.level))].sort(
    (a, b) => (LEVEL_RANK[a] ?? 9) - (LEVEL_RANK[b] ?? 9)
  );
  return levels.map((l) => LEVELS[l]?.label ?? l).join(" + ");
}

function componentStatus(checkResults) {
  const runnable = checkResults.filter((c) => !c.external && !c.server);
  if (runnable.length === 0) return "not-run";
  if (runnable.some((c) => c.status === "fail" || c.status === "error")) return "fail";
  if (runnable.every((c) => c.status === "pass")) return "pass";
  return "fail";
}

function componentGaps(comp, checkResults) {
  const gaps = [...(comp.gaps ?? [])];
  for (const c of checkResults) {
    if (c.gap) gaps.push(c.gap);
    if ((c.external || c.server) && c.reason) gaps.push(`NOT RUN ${c.id}: ${c.reason}`);
    if (c.status === "fail" || c.status === "error") {
      gaps.push(`${c.id} fejlede (exit ${c.exitCode ?? "?"}): se evidensloggen.`);
    }
  }
  return gaps;
}

/**
 * Renderer docs/status/implementation-matrix.md ud fra en baselinekørsel.
 * Kun faktiske observationer indgår; registrets statiske metadata bruges til
 * at forklare niveauet, ikke til at påstå et resultat.
 */
export function renderMatrix(result) {
  const { environment, checks, generatedAt, summary } = result;
  const byId = new Map(checks.map((c) => [c.id, c]));

  const lines = [];
  lines.push("# Implementation matrix — faktisk modenhed pr. komponent");
  lines.push("");
  lines.push(
    "> Genereret af `tools/baseline/baseline.mjs` fra en konkret kørsel. Denne fil erstatter ikke de historiske bølger i [BACKLOG.md](../../BACKLOG.md); den supplerer dem med, hvad der faktisk kan efterprøves i en ren checkout."
  );
  lines.push("");
  lines.push(
    `**Genereret:** ${generatedAt} · **Commit:** \`${environment.git.shortCommit ?? "?"}\` · **Node:** ${environment.node} · **CI:** ${environment.ci ? "ja" : "nej"}`
  );
  lines.push("");
  lines.push(`**Resultat:** ${summary.fail > 0 || summary.error > 0 ? "FAIL" : "PASS"} — ${summary.pass} pass, ${summary.fail} fail, ${summary.notRun} not run, ${summary.error} error (${summary.total} checks).`);
  lines.push("");

  lines.push("## Sådan læses niveauerne");
  lines.push("");
  lines.push("| Niveau | Betydning |");
  lines.push("| --- | --- |");
  for (const [key, meta] of Object.entries(LEVELS)) {
    lines.push(`| ${meta.label} (\`${key}\`) | ${meta.description} |`);
  }
  lines.push("");
  lines.push(
    "Et niveau beskriver **hvad beviset dækker**, ikke hvor vigtigt komponenten er. En `mock`-check er en ægte test af førstepartskoden, men den siger intet om en rigtig ekstern installation. `NOT RUN` er ikke det samme som PASS."
  );
  lines.push("");

  lines.push("## Miljø");
  lines.push("");
  lines.push("| Felt | Værdi |");
  lines.push("| --- | --- |");
  lines.push(`| Commit | \`${environment.git.commit ?? "?"}\` (${environment.git.branch ?? "?"}) |`);
  lines.push(`| Dirty worktree | ${environment.git.dirty ? `ja (${environment.git.dirtyFiles.length} filer)` : "nej"} |`);
  lines.push(`| Node / npm | ${environment.node} / ${environment.npm ?? "?"} |`);
  lines.push(`| Platform | ${environment.platform} ${environment.arch} (${environment.osRelease}) |`);
  lines.push(`| CI | ${environment.ci ? "ja" : "nej"} |`);
  lines.push(`| Evidens | \`${result.evidencePath ?? "?"}\` |`);
  lines.push("");

  const worktree = result.worktree ?? { before: [], after: [], mutatedFiles: [], reproducible: true };
  lines.push("## Reproducerbarhed");
  lines.push("");
  if (worktree.reproducible) {
    lines.push("Kørslen ændrede ingen sporede filer. En ren checkout forbliver ren efter `make baseline`.");
  } else {
    lines.push(
      `Kørslen ændrede **${worktree.mutatedFiles.length} sporede fil(er)**. Det betyder, at en ren checkout ikke forbliver ren, og at nogle bevisgeneratorer skriver ikke-deterministiske data ind i committede fixtures.`
    );
    lines.push("");
    lines.push("| Ændret fil |");
    lines.push("| --- |");
    for (const f of worktree.mutatedFiles) lines.push(`| \`${f}\` |`);
  }
  lines.push("");

  // --- Fejl og ikke-kørte checks, særskilt -----------------------------------
  const failures = checks.filter((c) => c.status === "fail" || c.status === "error");
  const notRun = checks.filter((c) => c.status === "not-run");
  const passed = checks.filter((c) => c.status === "pass");

  lines.push("## Fejl (skal udbedres)");
  lines.push("");
  if (failures.length === 0) {
    lines.push("Ingen.");
  } else {
    lines.push("Disse checks fejlede i denne kørsel. De er **ikke** deaktiveret for at opnå grøn status.");
    lines.push("");
    lines.push("| Check | Kommando | Exit | Evidenslog |");
    lines.push("| --- | --- | --- | --- |");
    for (const c of failures) {
      lines.push(`| ${c.title} | ${shortCommand(c.command)} | ${c.exitCode ?? "?"} | \`${c.log}\` |`);
    }
  }
  lines.push("");

  lines.push("## NOT RUN (kræver eksternt system, værktøj eller er langtkørende)");
  lines.push("");
  if (notRun.length === 0) {
    lines.push("Ingen.");
  } else {
    lines.push("Disse checks er **ikke** kørt, og deres manglende bevis indgår ikke som PASS.");
    lines.push("");
    lines.push("| Check | Kommando | Grund |");
    lines.push("| --- | --- | --- |");
    for (const c of notRun) {
      lines.push(`| ${c.title} | ${shortCommand(c.command)} | ${c.reason ?? "—"} |`);
    }
  }
  lines.push("");

  lines.push("## PASS (reelt efterprøvet i denne kørsel)");
  lines.push("");
  if (passed.length === 0) {
    lines.push("Ingen.");
  } else {
    lines.push("| Check | Niveau | Kommando |");
    lines.push("| --- | --- | --- |");
    for (const c of passed) {
      lines.push(`| ${c.title} | ${LEVELS[c.level]?.label ?? c.level} | ${shortCommand(c.command)} |`);
    }
  }
  lines.push("");

  // --- Komponentmatrix --------------------------------------------------------
  lines.push("## Komponentmatrix");
  lines.push("");
  lines.push(
    `Alle rækker er kørt mod commit \`${environment.git.shortCommit ?? "?"}\`. Kolonnen **Niveau** angiver bevisets dækning; **Åbne mangler** er det, der endnu ikke er bevist.`
  );
  lines.push("");

  const waves = [...new Set(COMPONENTS.map((c) => c.wave))];
  for (const wave of waves) {
    const comps = COMPONENTS.filter((c) => c.wave === wave);
    lines.push(`### Bølge ${wave}`);
    lines.push("");
    lines.push("| Komponent | Niveau | Testkommando | Resultat | Åbne mangler |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const comp of comps) {
      const results = comp.checks
        .map((id) => byId.get(id))
        .filter(Boolean)
        .sort((a, b) => a.id.localeCompare(b.id));
      const status = componentStatus(results);
      const commands = results.map((r) => shortCommand(r.command)).join("<br>");
      const level = componentLevel(results);
      const gaps = componentGaps(comp, results);
      const gapText = gaps.length ? gaps.join("<br>") : "—";
      lines.push(
        `| ${comp.title} | ${level} | ${commands} | ${RESULT_ICON[status]} ${ICON[status]} | ${gapText} |`
      );
    }
    lines.push("");
  }

  lines.push("## Rå checkliste");
  lines.push("");
  lines.push("| Check | Komponent | Niveau | Status | Exit | Varighed (ms) | Log |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const c of checks) {
    lines.push(
      `| ${c.id} | ${c.component} | ${c.level} | ${ICON[c.status] ?? c.status} | ${c.exitCode ?? "—"} | ${c.durationMs ?? "—"} | \`${c.log}\` |`
    );
  }
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(
    "Filen genereres på ny med `make baseline`. Historiske bølger bevares i [BACKLOG.md](../../BACKLOG.md), og en `NOT RUN`-linje må ikke læses som en godkendelse."
  );
  lines.push("");
  return lines.join("\n");
}
