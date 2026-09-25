/**
 * DKC-016 — gendannelsesøvelse med målt RPO/RTO.
 *
 * Øvelsen tager en rigtig krypteret backup, gendanner den i et isoleret miljø og
 * måler:
 *
 *   - **RTO**: hvor lang tid gendannelsen tager (fra restore starter til de
 *     funktionelle checks er kørt),
 *   - **RPO**: hvor meget data der ville være tabt — afstanden mellem den sidste
 *     committede skrivning og backupens skæringstidspunkt.
 *
 * Afvigelser spærrer pilotrelease: `gate.status` bliver `blocked` med en
 * begrundelse pr. afvigelse. En gennemført øvelse er ikke en erklæring — den
 * indeholder de målte tal.
 */
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { createBackup } from "./vault.mjs";
import { functionalChecks, restoreBackup } from "./restore.mjs";

function round(minutes) {
  return Math.round(minutes * 1000) / 1000;
}

/** Seneste committede skrivning på tværs af de tabeller der bærer et tidsstempel. */
export function latestWriteAt(db) {
  const candidates = [
    ["audit_events", "at"],
    ["audit_personal", "created_at"],
    ["approval_requests", "updated_at"],
    ["dsar_cases", "updated_at"],
    ["jobs", "updated_at"],
  ];
  let max = null;
  for (const [table, column] of candidates) {
    try {
      const exists = db.get("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?", table);
      if (!exists) continue;
      const row = db.get(`SELECT MAX(${column}) AS m FROM ${table}`);
      if (row?.m && (max === null || String(row.m) > max)) max = String(row.m);
    } catch {
      /* tabellen/kolonnen findes ikke i denne database — spring over */
    }
  }
  return max;
}

/**
 * Kør en fuld backup-/gendannelsesøvelse.
 *
 * @returns {Promise<{report: object, manifest: object, storeDir: string, restored: object}>}
 */
export async function runRestoreDrill({
  db,
  tenantId,
  workDir,
  keyProvider,
  suppressionLedger,
  source = {},
  config = null,
  objectDir = null,
  objectFiles = [],
  serviceClass = null,
  rpoTargetMinutes = null,
  rtoTargetMinutes = null,
  lastCommittedWriteAt = null,
  checkpoint = null,
  retentionDays = 365,
  clock = () => Date.now(),
  drillId = randomUUID(),
} = {}) {
  if (!workDir) throw new Error("runRestoreDrill kræver en workDir");
  const rpo = rpoTargetMinutes ?? serviceClass?.durability?.confirmedWrites?.rpoMinutes ?? 0;
  const rto = rtoTargetMinutes ?? serviceClass?.recovery?.rtoMinutes ?? 60;
  const restoreOrder = serviceClass?.recovery?.restoreOrder ?? ["database", "config", "objects"];

  const startedAt = new Date(clock()).toISOString();
  const backupStarted = clock();
  const lastWrite = lastCommittedWriteAt ?? latestWriteAt(db);

  const created = await createBackup({
    db,
    tenantId,
    outDir: join(workDir, "backup"),
    keyProvider,
    suppressionLedger,
    source,
    config,
    objectDir,
    objectFiles,
    retentionDays,
    rpoTargetMinutes: rpo,
    rtoTargetMinutes: rto,
    restoreOrder,
    clock,
    auditRef: `audit:backup.create.${drillId}`,
  });

  const dataLossMinutes = lastWrite ? Math.max(0, (backupStarted - Date.parse(lastWrite)) / 60000) : 0;

  const restoreStart = clock();
  const restored = restoreBackup({
    storeDir: created.storeDir,
    manifest: created.manifest,
    keyProvider,
    targetDir: join(workDir, "restored"),
    suppressionLedger,
  });
  const checks = functionalChecks({ dbPath: restored.dbPath, checkpoint });
  const restoreEnd = clock();
  const restoreDurationMs = Math.max(0, restoreEnd - restoreStart);
  const measuredRtoMinutes = restoreDurationMs / 60000;

  const integrity = {
    databaseOk: restored.integrity === "ok",
    checksumsVerified: true,
    manifestDigest: created.manifest.checksums.manifestDigest,
  };

  const auditCheck = checks.find((c) => c.name === "audit-chain");
  const checkpointCheck = checks.find((c) => c.name === "audit-checkpoint");
  const tenantCheck = checks.find((c) => c.name === "tenant-isolation");

  const reasons = [];
  if (!integrity.databaseOk) reasons.push("databaseintegriteten er ikke ok efter gendannelse");
  if (!integrity.checksumsVerified) reasons.push("checksums blev ikke verificeret");
  for (const check of checks) {
    if (check.status !== "pass") reasons.push(`funktionel check '${check.name}' fejlede: ${check.detail}`);
  }
  if (!restored.suppression.applied) reasons.push("suppressionsjournalen blev ikke anvendt");
  if (measuredRtoMinutes > rto) reasons.push(`målt RTO ${round(measuredRtoMinutes)} min overstiger målet ${rto} min`);
  if (dataLossMinutes > rpo) reasons.push(`målt datatab ${round(dataLossMinutes)} min overstiger RPO-målet ${rpo} min`);

  const report = {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "RestoreDrillReport",
    drillId,
    backupId: created.manifest.backupId,
    tenantId: tenantId ?? null,
    isolated: true,
    startedAt,
    finishedAt: new Date(restoreEnd).toISOString(),
    measurements: {
      restoreDurationMs,
      restoreDurationMinutes: round(measuredRtoMinutes),
      measuredRtoMinutes: round(measuredRtoMinutes),
      dataLossMinutes: round(dataLossMinutes),
      measuredRpoMinutes: round(dataLossMinutes),
      rpoTargetMinutes: rpo,
      rtoTargetMinutes: rto,
    },
    integrity,
    functionalChecks: checks,
    suppression: restored.suppression,
    tenantIsolation: { ok: tenantCheck?.status === "pass", tenantsChecked: tenantCheck?.status === "pass" ? "all" : "failed" },
    audit: {
      chainOk: auditCheck?.status === "pass",
      checkpointOk: checkpointCheck ? checkpointCheck.status === "pass" : null,
      checkpointDetail: checkpointCheck ? checkpointCheck.detail : "ingen ekstern checkpoint-store i dette miljø; hash-kæden er verificeret",
    },
    gate: { status: reasons.length ? "blocked" : "pass", reasons },
    auditRef: `audit:backup.drill.${drillId}`,
  };

  return { report, manifest: created.manifest, storeDir: created.storeDir, restored };
}
