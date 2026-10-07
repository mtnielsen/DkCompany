/**
 * DKC-008 — backup og gendannelse.
 *
 * Backup tages med SQLite's egen online-backup-API (`node:sqlite`'s `backup`),
 * som læser en konsistent snapshot under WAL uden at blokere skrivere. En
 * gendannelse verificeres altid: filen integrritetstjekkes, og antallet af
 * rækker pr. tabel holdes op mod forventningen, før den tages i brug.
 *
 * Strategien (fuld backup + verificeret restore + opgraderingsrækkefølge) er
 * dokumenteret i `docs/spec/persistence.md`.
 */
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { backup as sqliteBackup } from "node:sqlite";
import { openDatabase } from "./db.mjs";

const COUNTED_TABLES = ["approval_requests", "approval_claims", "jobs", "budgets", "audit_events"];

/** Tag en konsistent kopi af `db` til `destination`. */
export async function backupDatabase(db, destination) {
  if (!db) throw new Error("backupDatabase kræver en database");
  mkdirSync(dirname(destination), { recursive: true });
  const pages = await sqliteBackup(db.raw ?? db, destination);
  return { destination, pages, bytes: statSync(destination).size };
}

/** Tæl rækker pr. tabel i en database (findes tabellen ikke, springes den over). */
export function tableCounts(db) {
  const counts = {};
  for (const table of COUNTED_TABLES) {
    const present = db.get("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?", table);
    if (present) counts[table] = db.get(`SELECT COUNT(*) AS n FROM ${table}`).n;
  }
  return counts;
}

/**
 * Gendan `backupPath` til `targetPath`. Returnerer en verifikationsrapport.
 * `targetPath` overskrives kun hvis backupen er intakt.
 */
export async function restoreDatabase({ backupPath, targetPath, expectedCounts = null } = {}) {
  if (!existsSync(backupPath)) throw new Error(`backup findes ikke: ${backupPath}`);
  mkdirSync(dirname(targetPath), { recursive: true });
  // Verificér backupen isoleret før den rører målet.
  const check = openDatabase({ path: backupPath, readOnly: true });
  const integrity = check.get("PRAGMA integrity_check").integrity_check;
  const counts = tableCounts(check);
  check.close();
  if (integrity !== "ok") throw new Error(`backup er korrupt: ${integrity}`);
  if (expectedCounts) {
    for (const [table, expected] of Object.entries(expectedCounts)) {
      if (counts[table] !== expected) throw new Error(`backup-verifikation fejlede: ${table} har ${counts[table]} rækker, forventede ${expected}`);
    }
  }
  copyFileSync(backupPath, targetPath);
  const restored = openDatabase({ path: targetPath, readOnly: true });
  const restoredIntegrity = restored.get("PRAGMA integrity_check").integrity_check;
  const restoredCounts = tableCounts(restored);
  restored.close();
  return { ok: restoredIntegrity === "ok", integrity: restoredIntegrity, bytes: statSync(targetPath).size, counts: restoredCounts, sourceCounts: counts };
}

/**
 * Kombineret backup+gendannelsesøvelse mod et sæt databaser. Returnerer en
 * rapport pr. database, så `make persistence-test` kan bevise at både
 * opgradering og gendannelse virker.
 */
export async function exerciseBackupRestore({ databases, backupDir, targetDir }) {
  mkdirSync(backupDir, { recursive: true });
  mkdirSync(targetDir, { recursive: true });
  const report = {};
  for (const [name, db] of Object.entries(databases)) {
    const backupPath = `${backupDir}/${name}.db`;
    const targetPath = `${targetDir}/${name}.db`;
    const before = tableCounts(db);
    const taken = await backupDatabase(db, backupPath);
    const restored = await restoreDatabase({ backupPath, targetPath, expectedCounts: before });
    report[name] = { ...taken, ...restored, before };
  }
  return report;
}
