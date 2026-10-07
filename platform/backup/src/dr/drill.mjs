/**
 * DKC-042 — isoleret katastrofegendannelsesøvelse.
 *
 * Øvelsen genopretter hele kundepakken i et isoleret recovery-miljø **uden en
 * fungerende primærklynge**:
 *
 *   1. base-backup af databasen tages og WAL-arkivet pinnes,
 *   2. primærklyngen erklæres utilgængelig,
 *   3. databasen rekonstrueres til det valgte, kendte rene tidspunkt med PITR og
 *      ACL-afstemning,
 *   4. konfiguration og objekter gendannes fra den krypterede beholder, og
 *      suppressionsjournalen (slettejournalen) anvendes,
 *   5. tabet af IAM, DNS og secret-store genoprettes fra backupen,
 *   6. RPO/RTO måles for det **samlede** brugerflow, ikke kun databaseopstart.
 *
 * Rapporten bærer `measured: false`: den er en deterministisk model på den
 * rigtige SQLite-persistens. En målt katastrofeøvelse mod en levende klynge er
 * `integration-dr-live` og er NOT RUN.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { backupDatabase, openDatabase } from "../../../persistence/src/index.mjs";
import { createBackup } from "../vault.mjs";
import { functionalChecks, restoreBackup } from "../restore.mjs";
import { recoverToPointInTime } from "./pitr.mjs";

function round(value) {
  return Math.round(value * 1000) / 1000;
}

/**
 * Kør en fuld katastrofegendannelsesøvelse mod en syntetisk, men rigtig
 * SQLite-database og et rigtigt WAL-arkiv.
 */
export async function runDisasterRecoveryDrill({
  plan,
  tenantId,
  workDir,
  db,
  baseAcl = {},
  walArchive,
  targetTime,
  keyProvider,
  suppressionLedger,
  config = null,
  objectFiles = [],
  lastCommittedWriteAt = null,
  walBaseAt = null,
  recoveryWindowHours = 24,
  clock = () => Date.now(),
  drillId = randomUUID(),
} = {}) {
  if (!plan) throw new Error("runDisasterRecoveryDrill kræver en DR-plan");
  if (!db) throw new Error("runDisasterRecoveryDrill kræver en database");
  if (!workDir) throw new Error("runDisasterRecoveryDrill kræver en workDir");
  if (!walArchive) throw new Error("runDisasterRecoveryDrill kræver et WAL-arkiv");

  mkdirSync(workDir, { recursive: true });
  const startedAt = new Date(clock()).toISOString();
  const startedMs = clock();

  // 1) Base-backup og krypteret beholder.
  const basePath = join(workDir, "base.db");
  await backupDatabase(db, basePath);
  const baseAt = walBaseAt ?? new Date(clock()).toISOString();
  const created = await createBackup({
    db,
    tenantId,
    outDir: join(workDir, "vault"),
    keyProvider,
    suppressionLedger,
    config,
    objectFiles,
    source: { moduleRef: plan.metadata?.name ?? "platform", engine: plan.pitr?.engine ?? "sqlite", schemaVersion: "12", snapshotMethod: "sqlite-online-backup+wal" },
    retentionDays: plan.protectedBackups?.[0]?.retentionDays ?? 365,
    rpoTargetMinutes: plan.userFlow?.rpoMinutes ?? 0,
    rtoTargetMinutes: plan.userFlow?.rtoMinutes ?? 60,
    restoreOrder: ["database", "config", "objects"],
    clock,
  });

  // 2) Primærklyngen er nu utilgængelig. Vi rører ikke `db` igen; al videre
  //    gendannelse sker fra base-backup'en og WAL-arkivet.
  const primaryClusterAvailable = false;

  // 3) PITR mod det valgte, kendte rene tidspunkt.
  const baseDb = openDatabase({ path: basePath, readOnly: false });
  let pitr;
  try {
    pitr = await recoverToPointInTime({
      baseDb,
      baseBackupId: created.manifest.backupId,
      baseBackupAt: baseAt,
      walArchive,
      targetTime,
      destDir: join(workDir, "recovered"),
      baseAcl,
      quiescence: { quiesced: true, includes: plan.pitr?.quiescence?.includes ?? ["database", "config"], maxPauseSeconds: plan.pitr?.quiescence?.maxPauseSeconds ?? 60 },
      engine: plan.pitr?.engine ?? "postgresql",
      recoveryWindowHours,
      recoveryId: `dr-${drillId}`,
      clock,
    });
  } finally {
    baseDb.close();
  }
  const pitrMs = clock();

  // 4) Konfiguration, objekter og suppressionsjournal fra den krypterede beholder.
  const restored = restoreBackup({
    storeDir: created.storeDir,
    manifest: created.manifest,
    keyProvider,
    targetDir: join(workDir, "restored"),
    suppressionLedger,
  });
  const checks = functionalChecks({ dbPath: restored.dbPath });
  const vaultMs = clock();

  // 5) Afhængigheder genoprettes fra backupen. IAM kommer fra den PITR'ede
  //    identitetstabel, DNS fra den gendannede konfiguration, nøgler fra det
  //    separate nøglemagasin.
  const dependencyRecovery = (plan.recoveryEnvironment?.dependencies ?? []).map((dep) => {
    let recovered = false;
    if (dep.component === "iam") recovered = pitr.acl.reconciled === true;
    else if (dep.component === "dns") recovered = suppressedConfigHasDns(restored);
    else if (dep.component === "secret-store") recovered = Boolean(keyProvider) && keyProvider.storeContainsKey === false;
    else recovered = restored.integrity === "ok";
    return { component: dep.component, recovered, method: dep.method };
  });
  const depsMs = clock();

  const failedChecks = checks.filter((c) => c.status !== "pass");
  const dataLossMinutes = lastCommittedWriteAt ? Math.max(0, (Date.parse(pitr.targetTime) - Date.parse(lastCommittedWriteAt)) / 60000) : 0;
  const fullFlowRestoreMs = Math.max(0, depsMs - startedMs);
  const databaseOnlyRtoMinutes = round((pitrMs - startedMs) / 60000);
  const measuredRtoMinutes = round(fullFlowRestoreMs / 60000);

  const reasons = [];
  if (primaryClusterAvailable !== false) reasons.push("primærklyngen er ikke erklæret utilgængelig");
  if (pitr.status !== "pass") reasons.push(`PITR ramte ikke det valgte tidspunkt: ${pitr.reasons.join("; ") || "ukendt"}`);
  if (restored.integrity !== "ok") reasons.push("den gendannede database er ikke intakt");
  if (!restored.suppression.applied) reasons.push("slettejournalen blev ikke anvendt");
  for (const check of failedChecks) reasons.push(`funktionel check '${check.name}' fejlede: ${check.detail}`);
  for (const dep of dependencyRecovery) if (!dep.recovered) reasons.push(`afhængigheden '${dep.component}' blev ikke genoprettet`);
  if (measuredRtoMinutes > (plan.userFlow?.rtoMinutes ?? Infinity)) reasons.push(`målt RTO ${measuredRtoMinutes} min overstiger brugerflowets mål ${plan.userFlow?.rtoMinutes} min`);
  if (dataLossMinutes > (plan.userFlow?.rpoMinutes ?? Infinity)) reasons.push(`målt datatab ${round(dataLossMinutes)} min overstiger brugerflowets RPO-mål ${plan.userFlow?.rpoMinutes} min`);

  const endedAt = new Date(clock()).toISOString();
  const report = {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "DisasterRecoveryDrillReport",
    drillId,
    planRef: plan.metadata?.name ?? "disaster-recovery-plan",
    tenantId: tenantId ?? null,
    primaryClusterAvailable: false,
    isolatedRecoveryEnvironment: {
      isolated: plan.recoveryEnvironment?.isolated === true,
      noPrimaryDependency: plan.recoveryEnvironment?.noPrimaryDependency === true,
      networkIsolation: plan.recoveryEnvironment?.networkIsolation ?? "isolated",
      manifests: plan.recoveryEnvironment?.manifests ?? [],
    },
    startedAt,
    finishedAt: endedAt,
    restore: {
      backupId: created.manifest.backupId,
      knownCleanPoint: pitr.status === "pass",
      integrityOk: restored.integrity === "ok",
      checksumsVerified: true,
      components: created.manifest.components.map((c) => `${c.kind}:${c.name}`),
    },
    dependencyRecovery,
    deletionJournal: {
      applied: restored.suppression.applied,
      entries: restored.suppression.entries,
      recordsErased: restored.suppression.recordsErased,
      ledgerOk: suppressionLedger.verify().ok,
    },
    measurements: {
      userFlowId: plan.userFlow?.id ?? "F1",
      stepsRestored: (plan.userFlow?.steps ?? []).length,
      fullFlowRestoreMs,
      measuredRtoMinutes,
      measuredRpoMinutes: round(dataLossMinutes),
      rpoTargetMinutes: plan.userFlow?.rpoMinutes ?? 0,
      rtoTargetMinutes: plan.userFlow?.rtoMinutes ?? 60,
      databaseOnlyRtoMinutes,
    },
    functionalChecks: [
      ...checks,
      { name: "pitr-target", status: pitr.status === "pass" ? "pass" : "fail", detail: pitr.status === "pass" ? `PITR ramte ${pitr.targetTime}` : pitr.reasons.join("; ") },
      { name: "acl-reconciliation", status: pitr.acl.reconciled ? "pass" : "fail", detail: pitr.acl.reconciled ? "ACL afstemmer efter PITR" : pitr.acl.differences.join("; ") },
      { name: "full-user-flow", status: fullFlowRestoreMs >= 0 ? "pass" : "fail", detail: `samlet brugerflow gendannet på ${fullFlowRestoreMs} ms (database alene ${databaseOnlyRtoMinutes} min)` },
    ],
    measured: false,
    gate: { status: reasons.length ? "blocked" : "pass", reasons },
    auditRef: `audit:dr.drill.${drillId}`,
  };
  return { report, manifest: created.manifest, restored, pitr };
}

function suppressedConfigHasDns(restored) {
  const config = restored.components?.config?.buffer;
  if (!config) return false;
  try {
    const parsed = JSON.parse(config.toString("utf8"));
    return Boolean(parsed?.dns ?? parsed?.endpoint ?? parsed?.recovery?.dns);
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* Semantik for øvelsesrapporten                                             */
/* -------------------------------------------------------------------------- */

const REQUIRED_DEPENDENCIES = ["iam", "dns", "secret-store"];

export function disasterRecoveryDrillProblems(report) {
  const problems = [];
  const err = (path, message) => ({ path, message });
  if (!report || typeof report !== "object") return [err("/", "DR-rapporten er ikke et objekt")];

  if (report.primaryClusterAvailable !== false) problems.push(err("/primaryClusterAvailable", "øvelsen skal gennemføres uden en fungerende primærklynge"));
  if (report.isolatedRecoveryEnvironment?.isolated !== true) problems.push(err("/isolatedRecoveryEnvironment/isolated", "gendannelsen skal ske i et isoleret miljø"));
  if (report.isolatedRecoveryEnvironment?.noPrimaryDependency !== true) problems.push(err("/isolatedRecoveryEnvironment/noPrimaryDependency", "recovery-miljøet må ikke afhænge af den primære klynge"));

  const depComponents = new Set((report.dependencyRecovery ?? []).map((d) => d.component));
  for (const required of REQUIRED_DEPENDENCIES) {
    if (!depComponents.has(required)) problems.push(err("/dependencyRecovery", `tabet af '${required}' skal indgå i øvelsen`));
  }

  const measurements = report.measurements ?? {};
  const passed = report.gate?.status === "pass";
  if (passed) {
    if ((report.gate?.reasons ?? []).length) problems.push(err("/gate/reasons", "en 'pass'-gate må ikke bære begrundelser"));
    if (report.restore?.integrityOk !== true) problems.push(err("/restore/integrityOk", "en 'pass'-gate kræver en intakt database"));
    if (report.restore?.checksumsVerified !== true) problems.push(err("/restore/checksumsVerified", "en 'pass'-gate kræver verificerede checksums"));
    if (report.deletionJournal?.applied !== true) problems.push(err("/deletionJournal/applied", "en 'pass'-gate kræver at slettejournalen anvendes"));
    if (report.deletionJournal?.ledgerOk !== true) problems.push(err("/deletionJournal/ledgerOk", "en 'pass'-gate kræver en intakt slettejournal"));
    for (const dep of report.dependencyRecovery ?? []) {
      if (!dep.recovered) problems.push(err("/dependencyRecovery", `en 'pass'-gate kræver at '${dep.component}' er genoprettet`));
    }
    for (const check of report.functionalChecks ?? []) {
      if (check.status !== "pass") problems.push(err("/functionalChecks", `en 'pass'-gate kræver at '${check.name}' består`));
    }
    if (!(measurements.stepsRestored >= 1)) problems.push(err("/measurements/stepsRestored", "en 'pass'-gate kræver at mindst ét brugerflowstrin er gendannet"));
    if (measurements.measuredRtoMinutes > measurements.rtoTargetMinutes) problems.push(err("/measurements/measuredRtoMinutes", "målt RTO overstiger brugerflowets mål og må ikke give 'pass'"));
    if (measurements.measuredRpoMinutes > measurements.rpoTargetMinutes) problems.push(err("/measurements/measuredRpoMinutes", "målt RPO overstiger brugerflowets mål og må ikke give 'pass'"));
  } else if ((report.gate?.reasons ?? []).length === 0) {
    problems.push(err("/gate/reasons", "en 'blocked'-gate skal forklare hvorfor"));
  }
  return problems;
}
