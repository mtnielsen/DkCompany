#!/usr/bin/env node
/**
 * DKC-016 / DKC-057 — demonstration af backup, gendannelse og eksterne mål.
 *
 *   node backup/src/cli.mjs drill
 *   node backup/src/cli.mjs preflight backup/targets/local-filesystem.json
 *   node backup/src/cli.mjs canary    backup/targets/local-filesystem.json
 *   node backup/src/cli.mjs sync <storeDir> backup/targets/local-filesystem.json
 *
 * `drill` kører en rigtig krypteret backup og isoleret gendannelsesøvelse mod en
 * syntetisk SQLite-database. `preflight`/`canary` efterprøver et eksternt mål
 * (read-only henholdsvis skriv/læs/slet). Afvigelser giver exit != 0.
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCheckpointStore, createMigrator, createSqliteAuditLog, openDatabase } from "../../persistence/src/index.mjs";
import { createSqliteActionJournal } from "../../persistence/src/adapters/audit-journal.mjs";
import { createMemoryKeyProvider, createSuppressionLedger, runRestoreDrill } from "./index.mjs";
import { canaryTarget, fetchBackupFromTarget, preflightTarget, syncBackupToTarget } from "./targets.mjs";

function seed(dir) {
  const db = openDatabase({ path: join(dir, "synthetic.db") });
  createMigrator({ db }).apply();
  const audit = createSqliteAuditLog({ db });
  const journal = createSqliteActionJournal({ db, audit });
  audit.append({ tenantId: "demo", type: "synthetic.start", payload: { note: "syntetisk" } });
  journal.begin({ tenantId: "demo", idempotencyId: "demo-1", verb: "backup", target: "synthetic", request: { email: "demo@example.org" }, dataCategories: ["personal"] });
  audit.append({ tenantId: "demo-anden", type: "synthetic.other", payload: { note: "anden tenant" } });
  const anchorDir = join(dir, "anchors");
  createCheckpointStore({ audit, anchorDir, secret: "demo-anchor-secret" }).anchor({ tenantId: "demo" });
  return { db, anchorDir };
}

function loadTarget(path) {
  if (!path) throw new Error("et backupmål (JSON) skal angives");
  return JSON.parse(readFileSync(path, "utf8"));
}

async function drill() {
  const dir = mkdtempSync(join(tmpdir(), "dkc-backup-cli-"));
  try {
    const { db, anchorDir } = seed(dir);
    const ledger = createSuppressionLedger({ path: join(dir, "suppression.ndjson") });
    const { report, manifest } = await runRestoreDrill({
      db,
      tenantId: "demo",
      workDir: join(dir, "work"),
      keyProvider: createMemoryKeyProvider(),
      suppressionLedger: ledger,
      source: { moduleRef: "demo", engine: "sqlite", schemaVersion: "10", snapshotMethod: "sqlite-online-backup" },
      config: { endpoint: "https://demo.example.org", database: { password: "syntetisk" } },
      objectFiles: [{ name: "reports/demo.json", bytes: Buffer.from(JSON.stringify({ tenant: "demo" })) }],
      checkpoint: { anchorDir, secret: "demo-anchor-secret", tenantId: "demo" },
      lastCommittedWriteAt: new Date(Date.now() - 30_000).toISOString(),
      rpoTargetMinutes: 5,
      rtoTargetMinutes: 30,
    });

    console.log(`Backup ${manifest.backupId} taget og gendannet i isoleret miljø.`);
    console.log(`Komponenter: ${manifest.components.map((c) => `${c.kind}:${c.name}`).join(", ")}`);
    console.log(`RTO: ${report.measurements.measuredRtoMinutes} min (mål ${report.measurements.rtoTargetMinutes})`);
    console.log(`RPO: ${report.measurements.dataLossMinutes} min (mål ${report.measurements.rpoTargetMinutes})`);
    console.log(`Funktionelle checks: ${report.functionalChecks.map((c) => `${c.name}=${c.status}`).join(", ")}`);
    console.log(`Gate: ${report.gate.status}${report.gate.reasons.length ? ` — ${report.gate.reasons.join("; ")}` : ""}`);
    db.close();
    if (report.gate.status !== "pass") process.exit(1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function preflight(path) {
  const target = loadTarget(path);
  const report = await preflightTarget({ target, localRoot: process.env.DKC_BACKUP_LOCAL_ROOT ?? null });
  for (const check of report.checks) console.log(`${check.status === "pass" ? "✔" : check.status === "warn" ? "•" : "✘"} ${check.name}: ${check.detail}`);
  if (report.capabilities) console.log(`Capabilities: ${JSON.stringify(report.capabilities)}`);
  console.log(`Preflight: ${report.ok ? "OK" : "AFVIST"}`);
  if (!report.ok) process.exit(1);
}

async function canary(path) {
  const target = loadTarget(path);
  const report = await canaryTarget({ target, localRoot: process.env.DKC_BACKUP_LOCAL_ROOT ?? null });
  for (const check of report.checks) console.log(`${check.status === "pass" ? "✔" : check.status === "warn" ? "•" : "✘"} ${check.name}: ${check.detail}`);
  console.log(`Canary: ${report.ok ? "OK" : "AFVIST"} (cleanup: ${report.cleanup})`);
  if (!report.ok) process.exit(1);
}

async function sync(storeDir, path) {
  const target = loadTarget(path);
  const uploaded = await syncBackupToTarget({ storeDir, target, localRoot: process.env.DKC_BACKUP_LOCAL_ROOT ?? null });
  console.log(`Uploadede ${uploaded.uploaded.length} filer (${uploaded.bytes} byte) til '${uploaded.prefix}'.`);
  const dir = mkdtempSync(join(tmpdir(), "dkc-backup-fetch-"));
  try {
    const fetched = await fetchBackupFromTarget({ target, tenantId: uploaded.tenantId, backupId: uploaded.backupId, destDir: dir });
    console.log(`Hentede ${fetched.files} filer tilbage (${fetched.bytes} byte) fra målet.`);
    const original = countFiles(storeDir);
    if (fetched.files !== original) {
      console.error(`✘ filantal stemmer ikke: original ${original}, hentet ${fetched.files}`);
      process.exit(1);
    }
    console.log("✔ synkronisering frem og tilbage er konsistent");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function countFiles(dir) {
  let count = 0;
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(d, entry.name));
      else if (entry.isFile()) count += 1;
    }
  };
  if (statSync(dir, { throwIfNoEntry: false })) walk(dir);
  return count;
}

const [command, ...args] = process.argv.slice(2);
const run = {
  drill: () => drill(),
  preflight: () => preflight(args[0]),
  canary: () => canary(args[0]),
  sync: () => sync(args[0], args[1]),
};

if (!run[command]) {
  console.error("Brug: node backup/src/cli.mjs <drill|preflight|canary|sync> [args]");
  process.exit(2);
}
run[command]().catch((err) => {
  console.error(err.stack ?? err.message);
  process.exit(1);
});
