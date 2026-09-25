/**
 * DKC-052 — rendering af overtagelsesplanen og øvelsesrapporten.
 *
 * Dokumenterne er deterministiske visninger af den kanoniske plan og den kørte
 * øvelse. De bærer `measured: false`; en målt øvelse på levende hosts er NOT RUN.
 */

function human(h) {
  return h ? `${h.name} (${h.role})` : "—";
}

function statusLabel(status) {
  if (status === "pass") return "PASS";
  if (status === "validated") return "VALIDERET";
  if (status === "awaiting-human") return "AFVENTER MENNESKE";
  if (status === "blocked") return "BLOKERET";
  if (status === "not-run") return "IKKE KØRT";
  if (status === "pending") return "AFVENTER";
  if (status === "fail") return "FEJL";
  if (status === "blocked") return "BLOKERET";
  return status ?? "—";
}

export function renderTakeoverPlan(plan) {
  const lines = [];
  lines.push("# Overtagelses- og beredskabsplan (DKC-052)");
  lines.push("");
  lines.push("> Genereret fra `continuity/takeover-plan.json` med `make takeover-write`. Planen er kilden; dette dokument er en afledt visning. En plan er ikke en målt øvelse.");
  lines.push("");
  lines.push(`**Ejer:** ${human(plan.metadata?.accountableHuman)} · **Sidst gennemgået:** ${plan.metadata?.lastReviewed} · **Version:** ${plan.metadata?.version}`);
  lines.push("");
  lines.push("## Navngivne roller");
  lines.push("");
  lines.push("| Rolle | Person | Kontakt |");
  lines.push("| --- | --- | --- |");
  for (const [role, value] of Object.entries(plan.roles ?? {})) {
    lines.push(`| ${role} | ${human(value)} | ${value?.channel ?? "—"} ${value?.contact ?? ""} |`);
  }
  lines.push("");
  lines.push("## Uafhængig kontaktkanal og eskalation");
  lines.push("");
  lines.push(`- Kanal: ${plan.contactChannel?.channel}`);
  lines.push(`- Uafhængig af platformen: ${plan.contactChannel?.independent ? "ja" : "nej"}`);
  lines.push(`- Testmodtagere: ${(plan.contactChannel?.testRecipients ?? []).map((r) => r.name).join(", ")}`);
  lines.push("");
  lines.push("| Efter (min) | Eskaleres til |");
  lines.push("| --- | --- |");
  for (const e of plan.contactChannel?.escalation ?? []) lines.push(`| ${e.afterMinutes} | ${human(e.to)} |`);
  lines.push("");
  lines.push("## Offline-runbooks og credentials");
  lines.push("");
  lines.push(`- Offline-medium: ${plan.offlineRunbooks?.independentMedium} (${plan.offlineRunbooks?.location})`);
  lines.push(`- Sidst verificeret: ${plan.offlineRunbooks?.lastVerified}`);
  lines.push(`- Credentials under menneskekontrol: ${plan.credentials?.underHumanControl ? "ja" : "nej"}; depositarer: ${(plan.credentials?.custodians ?? []).map((c) => c.name).join(", ")}`);
  lines.push(`- Break-glass: ${plan.credentials?.breakGlass?.ref} (to-personers: ${plan.credentials?.breakGlass?.requiresTwoPerson ? "ja" : "nej"})`);
  lines.push("");
  lines.push("## Prioriteret restoreplan");
  lines.push("");
  lines.push(`Ejer: ${human(plan.restorePlan?.owner)} · Integritetskontrol: ${plan.restorePlan?.dataIntegrityCheck}`);
  lines.push("");
  lines.push("| Rækkefølge | Komponent | Reference |");
  lines.push("| --- | --- | --- |");
  for (const p of plan.restorePlan?.priority ?? []) lines.push(`| ${p.order} | ${p.component} | \`${p.ref}\` |`);
  lines.push("");
  lines.push("## Formelt valgt profil");
  lines.push("");
  lines.push(`Valgt af ${human(plan.profiles?.chosenBy)} · formelt valgt: ${plan.profiles?.formallyChosen ? "ja" : "nej"}`);
  lines.push("");
  lines.push("| Profil | Reference |");
  lines.push("| --- | --- |");
  for (const key of ["deploymentProfile", "haProfile", "immutableProfile", "selfHealingProfile"]) lines.push(`| ${key} | \`${plan.profiles?.[key]}\` |`);
  lines.push("");
  lines.push("## Øvelsesscenarier");
  lines.push("");
  lines.push("| Scenarie | Kind | Miljø | Trin | Menneskelige trin |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const s of plan.drills?.scenarios ?? []) {
    lines.push(`| ${s.id} | ${s.kind} | ${s.environment} | ${s.steps.length} | ${s.steps.filter((x) => x.kind === "human").length} |`);
  }
  lines.push("");
  lines.push("## Periodisk kontrol");
  lines.push("");
  lines.push("| Kontrol | Kadence (dage) | Sidst gennemført |");
  lines.push("| --- | --- | --- |");
  const sched = plan.drills?.schedule ?? {};
  const last = plan.drills?.lastCompleted ?? {};
  const map = {
    accessReviewDays: "accessReview",
    backupControlDays: "backupControl",
    capacityReviewDays: "capacityReview",
    drDrillDays: "drDrill",
    runbookRecertificationDays: "runbookRecertification",
  };
  for (const [key, label] of Object.entries(map)) lines.push(`| ${label} | ${sched[key]} | ${last[label]} |`);
  lines.push("");
  lines.push("## Sådan gentages øvelsen");
  lines.push("");
  lines.push("```sh");
  lines.push("make takeover-write    # genskab denne plan og rapporten");
  lines.push("make takeover-check    # validér plan, øvelse og renderede artefakter");
  lines.push("make takeover-test     # kør enheds- og konformanstestene");
  lines.push("make takeover-live     # målt øvelse på levende hosts (NOT RUN)");
  lines.push("```");
  lines.push("");
  return lines.join("\n");
}

export function renderRecoveryDrillReport(suite) {
  const lines = [];
  lines.push("# Beredskabsøvelse og overtagelseskontrol (DKC-052)");
  lines.push("");
  lines.push("> Genereret fra `continuity/takeover-plan.json` med `make takeover-run`. Øvelsen er en **deterministisk model** (`measured: false`). Menneskelige trin forbliver AFVENTER, indtil et navngivet menneske faktisk har udført dem; en målt øvelse på levende hosts er en ekstern integration, se [`recovery-drill-live.md`](recovery-drill-live.md).");
  lines.push("");
  lines.push(`**Gate:** ${suite.gate.status === "pass" ? "PASS" : suite.gate.status === "awaiting-human" ? "AFVENTER MENNESKE" : "BLOKERET"}`);
  lines.push(`**Plan:** ${suite.planRef} v${suite.planVersion} · **Genereret:** ${suite.generatedAt}`);
  lines.push("");
  if (suite.gate.reasons.length) {
    lines.push("Grund til at beredskabet ikke er godkendt:");
    for (const r of suite.gate.reasons) lines.push(`- ${r}`);
    lines.push("");
  }
  lines.push("## Opsummering");
  lines.push("");
  const s = suite.summary ?? {};
  lines.push(`- Scenarier: ${s.total} (${s.validated} valideret, ${s.awaitingHuman} afventer menneske, ${s.blocked} blokeret)`);
  lines.push(`- Trin: ${s.machineSteps} maskine, ${s.humanSteps} menneske (${s.humanPending} afventer)`);
  lines.push(`- Eskalationer til mennesker: ${s.escalationsToHumans}`);
  lines.push(`- Agenten kan godkende beredskab: ${suite.agentCanApprove ? "ja" : "nej"}`);
  lines.push("");
  lines.push("## Scenarier");
  lines.push("");
  lines.push("| Scenarie | Kind | Status | Dataintegritet | Restore | Failback | Målte RTO min |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const d of suite.drills) {
    lines.push(`| ${d.scenarioId} | ${d.scenarioKind} | ${statusLabel(d.status)} | ${d.measurements.dataIntegrityOk === null ? "—" : d.measurements.dataIntegrityOk ? "OK" : "FEJL"} | ${d.measurements.restoreVerified === null ? "—" : d.measurements.restoreVerified ? "OK" : "FEJL"} | ${d.measurements.failbackVerified === null ? "—" : d.measurements.failbackVerified ? "OK" : "FEJL"} | ${d.measurements.rtoMinutes ?? "—"} |`);
  }
  lines.push("");
  for (const d of suite.drills) {
    lines.push(`### ${d.scenarioId} — ${statusLabel(d.status)}`);
    lines.push("");
    lines.push(`Miljø: ${d.environment} · Drill-ID: \`${d.drillId}\``);
    lines.push("");
    lines.push("| Trin | Fase | Kind | Status | Operatør | Tid | Resultat |");
    lines.push("| --- | --- | --- | --- | --- | --- | --- |");
    for (const step of d.steps) {
      lines.push(`| ${step.id} | ${step.phase} | ${step.kind} | ${statusLabel(step.status)} | ${step.owner ? step.owner.name : "—"} | ${step.at ?? "—"} | ${(step.result ?? "").replace(/\|/g, "/")} |`);
    }
    const escalations = d.steps.flatMap((step) => (step.escalation ?? []).map((e) => `${step.id} → ${e.to?.name ?? "—"} efter ${e.afterMinutes} min`));
    if (escalations.length) {
      lines.push("");
      lines.push(`Eskalationer: ${escalations.join("; ")}`);
    }
    lines.push("");
  }
  lines.push("## Sådan gentages øvelsen");
  lines.push("");
  lines.push("```sh");
  lines.push("make takeover-run      # kør alle scenarier deterministisk");
  lines.push("make takeover-check    # valider plan, øvelse og artefakter");
  lines.push("```");
  lines.push("");
  return lines.join("\n");
}

export { human };
