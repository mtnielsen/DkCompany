/**
 * DKC-042 — genererer `docs/continuity/dr-plan.md` fra den kanoniske plan.
 *
 * Dokumentet er en afledt visning. Kilden er `backup/dr/disaster-recovery-plan.json`;
 * `make dr-write` genskaber dokumentet, og `make dr-check` afviser det hvis det
 * er ude af trit.
 */

function table(headers, rows) {
  const lines = [`| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`];
  for (const row of rows) lines.push(`| ${row.join(" | ")} |`);
  return lines;
}

export function renderDrPlan(plan, profile) {
  const lines = [];
  lines.push("# Katastrofegendannelsesplan (DKC-042)");
  lines.push("");
  lines.push(
    "> Genereret fra `backup/dr/disaster-recovery-plan.json` med `make dr-write`. Planen er kilden; dette dokument er en afledt visning. En plan er ikke en målt øvelse."
  );
  lines.push("");
  lines.push(`**Ejer:** ${plan.metadata.accountableHuman.name} (${plan.metadata.accountableHuman.role}) · **Sidst gennemgået:** ${plan.metadata.lastReviewed} · **Princip:** ${plan.principle.designation}`);
  lines.push("");
  lines.push("## 3-2-1-1-0");
  lines.push("");
  lines.push("| Krav | Erklæret | Faktisk |");
  lines.push("| --- | --- | --- |");
  lines.push(`| Kopier | ${plan.principle.copies} | ${plan.copies.length} |`);
  lines.push(`| Medier | ${plan.principle.mediaTypes} | ${new Set(plan.copies.map((c) => c.mediaType)).size} |`);
  lines.push(`| Eksterne kopier | ${plan.principle.offsiteCopies} | ${plan.copies.filter((c) => c.copyType === "offsite").length} |`);
  lines.push(`| Offline/immutable | ${plan.principle.offlineImmutableCopies} | ${plan.copies.filter((c) => c.copyType === "offline-immutable").length} |`);
  lines.push(`| Verificerede restores | ${plan.principle.verifiedRestores} | ≥1 |`);
  lines.push("");
  lines.push("### Kopier");
  lines.push("");
  lines.push("| Kopi | Mål | Type | Medie | Fejldomæne | Adgangsdomæne | Immutable | Sletning |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const c of plan.copies) {
    lines.push(`| \`${c.id}\` | ${c.targetRef} | ${c.copyType} | ${c.mediaType} | ${c.failureDomain} | ${c.accessDomain} | ${c.immutable ? "ja" : "nej"} | ${c.deletePermission} |`);
  }
  lines.push("");
  lines.push("## Primærklyngens grænse");
  lines.push("");
  lines.push(`Driftsrollen \`${plan.primaryCluster.roleId}\` må ikke slette beskyttede backups.`);
  lines.push("");
  lines.push(`- Tilladte operationer: ${plan.primaryCluster.operations.map((o) => `\`${o}\``).join(", ")}`);
  lines.push(`- Forbudte operationer: ${plan.primaryCluster.forbiddenOperations.map((o) => `\`${o}\``).join(", ")}`);
  lines.push("");
  lines.push("## Applikationskonsistent PITR");
  lines.push("");
  lines.push(`- Motor: ${plan.pitr.engine}; base-backup: \`${plan.pitr.baseBackupSchedule}\`; WAL-arkiv: \`${plan.pitr.walArchiveTarget}\`.`);
  lines.push(`- Quiescence: \`${plan.pitr.quiescence.method}\` (maks. ${plan.pitr.quiescence.maxPauseSeconds}s, omfatter ${plan.pitr.quiescence.includes.join(", ")}).`);
  lines.push(`- Valgbart recovery-tidspunkt: ja (${plan.pitr.targetRecoveryTime.granularity}); bundet af RPO for bekræftede writes: ${plan.pitr.targetRecoveryTime.boundByConfirmedWritesRpoMinutes} min.`);
  lines.push(`- ACL-afstemning: \`${plan.pitr.aclReconciliation.method}\` mod ${plan.pitr.aclReconciliation.sources.join(", ")}.`);
  lines.push("");
  lines.push("## Recovery-identitet");
  lines.push("");
  lines.push(`- Profil: \`${plan.recoveryIdentity.profileRef}\``);
  lines.push(`- Adskilt fra primærdriften: ${plan.recoveryIdentity.separateFromPrimaryOperations ? "ja" : "nej"}; kun verificeret menneske: ${plan.recoveryIdentity.humanVerifiedOnly ? "ja" : "nej"}; to-personers: ${plan.recoveryIdentity.twoPersonApproval ? "ja" : "nej"}; stående adgang: ${plan.recoveryIdentity.noStandingAccess ? "nej" : "ja"}.`);
  if (profile) {
    lines.push(`- Nøgle: \`${profile.keys.keyRef}\` (adskilt fra backup-lageret: ${profile.keys.separateFromBackupStore ? "ja" : "nej"}).`);
    lines.push(`- Katalog pinnet på digest: \`${profile.catalog.digest}\`; images pinnet: ${profile.images.length}.`);
  }
  lines.push("");
  lines.push("## Isoleret recovery-miljø");
  lines.push("");
  lines.push(`Netværk: \`${plan.recoveryEnvironment.networkIsolation}\`. Ingen afhængighed af den primære klynge.`);
  lines.push("");
  lines.push(...table(["Afhængighed", "Genoprettes fra", "Metode"], plan.recoveryEnvironment.dependencies.map((d) => [`\`${d.component}\``, `\`${d.recoveredFrom}\``, d.method])));
  lines.push("");
  lines.push("## Kendt rent restorepunkt");
  lines.push("");
  lines.push(`- Backup: \`${plan.knownCleanPoint.backupId}\`, verificeret ${plan.knownCleanPoint.verifiedAt} af ${plan.knownCleanPoint.verifiedBy.name}.`);
  lines.push(`- Metode: ${plan.knownCleanPoint.method}. Evidens: \`${plan.knownCleanPoint.evidenceRef}\`.`);
  lines.push("");
  lines.push("## Slettejournal og failback");
  lines.push("");
  lines.push(`- Slettejournal: \`${plan.deletionJournal.ledgerRef}\` (append-only: ${plan.deletionJournal.appendOnly ? "ja" : "nej"}, hash-kædet: ${plan.deletionJournal.hashChained ? "ja" : "nej"}).`);
  lines.push("- Failback:");
  for (const step of plan.failback.procedure) lines.push(`  1. ${step}`);
  lines.push(`- Switchover-vindue: ${plan.failback.switchoverWindow}; fence påkrævet: ${plan.failback.requiresFence ? "ja" : "nej"}.`);
  lines.push("");
  lines.push("## Samlet brugerflow");
  lines.push("");
  lines.push(`**${plan.userFlow.id} — ${plan.userFlow.name}** (RPO ${plan.userFlow.rpoMinutes} min, RTO ${plan.userFlow.rtoMinutes} min).`);
  lines.push("");
  lines.push(...table(["Trin", "Beskrivelse", "Komponent", "Afhænger af"], plan.userFlow.steps.map((s) => [`\`${s.id}\``, s.description, `\`${s.component}\``, s.dependsOn.map((d) => `\`${d}\``).join(", ") || "—"])));
  lines.push("");
  lines.push("## Beskyttede backups");
  lines.push("");
  lines.push(...table(["Backup", "Kopi", "Retention (dage)", "Sletningsspærring", "To-personers", "Immutabilitet verificeret"], plan.protectedBackups.map((b) => [`\`${b.id}\``, `\`${b.copyRef}\``, String(b.retentionDays), `\`${b.deletionGuard}\``, b.twoPersonRequired ? "ja" : "nej", b.immutableVerified ? "ja" : "nej"])));
  lines.push("");
  return lines.join("\n");
}
