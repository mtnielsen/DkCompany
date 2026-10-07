/**
 * DKC-016 — isoleret gendannelse med checksums, suppressionsjournal og
 * funktionelle checks.
 *
 * Gendannelsen skriver til et **isoleret** målmiljø (en tom mappe), ikke hen over
 * den kørende database. Derefter:
 *
 *   1. verificeres databasens integritet (`PRAGMA integrity_check`),
 *   2. anvendes suppressionsjournalen, så persondata slettet efter backupen
 *      ikke genindføres,
 *   3. køres funktionelle checks: hash-kæden, tenant-afgrænsning og — hvis en
 *      ekstern checkpoint-store er konfigureret — checkpointet.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createCheckpointStore, createSqliteAuditLog, openDatabase } from "../../persistence/src/index.mjs";
import { BackupIntegrityError, readBackup } from "./vault.mjs";

/**
 * Gendan en verificeret backup til `targetDir`.
 *
 * @returns {{dbPath: string, targetDir: string, integrity: string, suppression: object, components: object}}
 */
export function restoreBackup({ storeDir, manifest, keyProvider, targetDir, suppressionLedger = null, applySuppression = true } = {}) {
  if (!targetDir) throw new BackupIntegrityError("restoreBackup kræver en targetDir", "missing_target");
  const components = readBackup({ storeDir, manifest, keyProvider });

  mkdirSync(targetDir, { recursive: true });
  let dbPath = null;
  for (const component of Object.values(components)) {
    if (component.kind === "database") {
      dbPath = join(targetDir, "database.db");
      writeFileSync(dbPath, component.buffer);
    } else if (component.kind === "config") {
      writeFileSync(join(targetDir, "config.json"), component.buffer);
    } else if (component.kind === "objects") {
      const path = join(targetDir, "objects", component.name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, component.buffer);
    }
  }
  if (!dbPath) throw new BackupIntegrityError("backupen indeholder ingen databasekomponent", "no_database_component");

  const readonly = openDatabase({ path: dbPath, readOnly: true });
  const integrity = readonly.get("PRAGMA integrity_check").integrity_check;
  readonly.close();
  if (integrity !== "ok") throw new BackupIntegrityError(`den gendannede database er korrupt: ${integrity}`, "restored_db_corrupt");

  let suppression = { applied: false, entries: 0, recordsErased: 0, ledgerHead: null };
  if (applySuppression) {
    if (!suppressionLedger) throw new BackupIntegrityError("gendannelse kræver en suppressionsjournal", "missing_suppression_ledger");
    const verification = suppressionLedger.verify();
    if (!verification.ok) throw new BackupIntegrityError("suppressionsjournalen er brudt eller ændret", "suppression_ledger_broken");
    if (!suppressionLedger.isDescendantOf(manifest.suppression?.ledgerDigest)) {
      throw new BackupIntegrityError("suppressionsjournalen er trunkeret i forhold til backup-manifestet", "suppression_ledger_truncated");
    }
    const entries = suppressionLedger.entriesAfter(manifest.createdAt);
    const db = openDatabase({ path: dbPath });
    let recordsErased = 0;
    db.transaction(() => {
      for (const entry of entries) {
        const result = db.run(
          "UPDATE audit_personal SET payload = '{}', subject_key = NULL, erased_at = ? WHERE tenant_id = ? AND digest = ? AND erased_at IS NULL",
          entry.erasedAt,
          entry.tenantId,
          entry.digest
        );
        recordsErased += Number(result.changes ?? 0);
      }
    });
    db.close();
    suppression = { applied: true, entries: entries.length, recordsErased, ledgerHead: suppressionLedger.head() };
  }

  return { dbPath, targetDir, integrity, suppression, components };
}

/**
 * Funktionelle checks på en gendannet, skrivebeskyttet database.
 * Returnerer en liste af `{ name, status: "pass"|"fail", detail }`.
 */
export function functionalChecks({ dbPath, checkpoint = null } = {}) {
  if (!dbPath) throw new BackupIntegrityError("functionalChecks kræver en dbPath", "missing_db");
  const checks = [];
  const db = openDatabase({ path: dbPath, readOnly: true });
  try {
    const integrity = db.get("PRAGMA integrity_check").integrity_check;
    checks.push({ name: "database-integrity", status: integrity === "ok" ? "pass" : "fail", detail: corruptionDetail(integrity) });

    const audit = createSqliteAuditLog({ db });
    const chain = audit.verifyChain();
    checks.push({
      name: "audit-chain",
      status: chain.ok ? "pass" : "fail",
      detail: chain.ok ? "audit-loggens hash-kæde er intakt" : `hash-kæden er brudt ved ${chain.brokenAt ?? "ukendt"}`,
    });

    const tenants = db.all("SELECT DISTINCT tenant_id FROM audit_events WHERE tenant_id IS NOT NULL ORDER BY tenant_id").map((row) => row.tenant_id);
    let isolationOk = true;
    const leaky = [];
    for (const tenant of tenants) {
      db.setTenant(tenant);
      const visible = db.get("SELECT COUNT(*) AS n FROM v_audit_events").n;
      const owned = db.get("SELECT COUNT(*) AS n FROM audit_events WHERE tenant_id = ?", tenant).n;
      const foreign = db.get("SELECT COUNT(*) AS n FROM v_audit_events WHERE tenant_id IS NOT ?", tenant).n;
      if (visible !== owned || foreign !== 0) {
        isolationOk = false;
        leaky.push(tenant);
      }
    }
    checks.push({
      name: "tenant-isolation",
      status: isolationOk ? "pass" : "fail",
      detail: isolationOk ? `${tenants.length} tenant(s) er afgrænset gennem tenant-viewet` : `lækage mellem tenants: ${leaky.join(", ")}`,
    });

    if (checkpoint?.anchorDir && checkpoint?.secret) {
      const store = createCheckpointStore({ audit, anchorDir: checkpoint.anchorDir, secret: checkpoint.secret });
      const result = store.verify({ tenantId: checkpoint.tenantId ?? null });
      checks.push({
        name: "audit-checkpoint",
        status: result.ok ? "pass" : "fail",
        detail: result.ok ? "audit-loggen matcher det eksterne checkpoint" : `checkpointafvigelse: ${result.problems.map((p) => p.type).join(", ")}`,
      });
    }
  } finally {
    db.close();
  }
  return checks;
}

function corruptionDetail(integrity) {
  return integrity === "ok" ? "databaseintegriteten er ok" : `integritetstjek returnerede '${integrity}'`;
}
