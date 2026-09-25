#!/usr/bin/env node
/**
 * DKC-042 — demonstration og skrivning for katastrofegendannelse.
 *
 *   node backup/src/dr/cli.mjs write   # genskab docs/continuity/dr-plan.md
 *   node backup/src/dr/cli.mjs drill   # kør en rigtig PITR + isoleret DR-øvelse
 *
 * `drill` seeder en syntetisk SQLite-database, bygger et hash-kædet WAL-arkiv,
 * erklærer primærklyngen utilgængelig og genopretter til det valgte tidspunkt i
 * et isoleret miljø. Den viser desuden at primærklyngens driftscredentials ikke
 * kan slette en COMPLIANCE-låst backup. Afvigelser giver exit != 0.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createMigrator, openDatabase } from "../../../persistence/src/index.mjs";
import { createStorageCluster } from "../../../storage/src/object-store.mjs";
import { createTenantKeyRing, deriveTestKeyRing } from "../../../storage/src/tenant-keys.mjs";
import { loadStoragePlan } from "../../../storage/src/plan.mjs";
import { createMemoryKeyProvider } from "../keys.mjs";
import { createSuppressionLedger } from "../suppression.mjs";
import { loadDisasterRecoveryPlan, loadRecoveryAccessProfile, DR_PLAN_PATH } from "./plan.mjs";
import { createRecoveryAccessGate } from "./access.mjs";
import { createWalArchive } from "./pitr.mjs";
import { runDisasterRecoveryDrill } from "./drill.mjs";
import { renderDrPlan } from "./render.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");

function seedDatabase() {
  const db = openDatabase({ path: ":memory:" });
  createMigrator({ db }).apply();
  db.exec("CREATE TABLE acl_entries(subject TEXT PRIMARY KEY, role TEXT, updated_at TEXT)");
  db.exec("CREATE TABLE recovery_data(id INTEGER PRIMARY KEY, tenant_id TEXT, value TEXT, at TEXT)");
  db.run("INSERT INTO acl_entries(subject, role, updated_at) VALUES (?, ?, ?)", "oidc|anna.andersen", "platform-owner", "2026-09-20T01:55:00Z");
  db.run("INSERT INTO recovery_data(id, tenant_id, value, at) VALUES (?, ?, ?, ?)", 1, "acme", "base-a", "2026-09-20T01:55:00Z");
  db.run("INSERT INTO recovery_data(id, tenant_id, value, at) VALUES (?, ?, ?, ?)", 2, "acme", "base-b", "2026-09-20T01:56:00Z");
  return db;
}

function writeDoc() {
  const plan = loadDisasterRecoveryPlan(repoRoot);
  const profile = loadRecoveryAccessProfile(repoRoot);
  const md = renderDrPlan(plan, profile);
  const target = join(repoRoot, "docs", "continuity", "dr-plan.md");
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, md);
  console.log(`✔ Skrev ${target.replace(repoRoot + "/", "")} fra ${DR_PLAN_PATH}`);
}

async function drill() {
  const plan = loadDisasterRecoveryPlan(repoRoot);
  const profile = loadRecoveryAccessProfile(repoRoot);
  const work = mkdtempSync(join(tmpdir(), "dkc-dr-cli-"));
  const db = seedDatabase();
  try {
    // 1) WAL-arkiv med applikationskonsistente writes efter base-backup'en.
    const wal = createWalArchive({ dir: join(work, "wal"), engine: plan.pitr.engine });
    const baseAt = "2026-09-20T02:00:00Z";
    wal.append({ at: "2026-09-20T02:01:00Z", tenantId: "acme", table: "recovery_data", sql: "INSERT INTO recovery_data(id, tenant_id, value, at) VALUES (?, ?, ?, ?)", params: [3, "acme", "wal-c", "2026-09-20T02:01:00Z"] });
    wal.append({ at: "2026-09-20T02:02:00Z", tenantId: "acme", table: "recovery_data", sql: "INSERT INTO recovery_data(id, tenant_id, value, at) VALUES (?, ?, ?, ?)", params: [4, "acme", "wal-d", "2026-09-20T02:02:00Z"] });
    wal.append({ at: "2026-09-20T02:04:00Z", tenantId: "acme", kind: "acl", table: "acl_entries", sql: "INSERT INTO acl_entries(subject, role, updated_at) VALUES (?, ?, ?)", params: ["oidc|cont.officer", "continuity-officer", "2026-09-20T02:04:00Z"] });

    const ledger = createSuppressionLedger({ path: join(work, "suppression.ndjson") });
    const { report } = await runDisasterRecoveryDrill({
      plan,
      tenantId: "acme",
      workDir: join(work, "drill"),
      db,
      baseAcl: { "oidc|anna.andersen": "platform-owner" },
      walArchive: wal,
      targetTime: "2026-09-20T02:02:00Z",
      walBaseAt: baseAt,
      keyProvider: createMemoryKeyProvider(),
      suppressionLedger: ledger,
      config: { dns: { zone: "recovery.example.org" }, endpoint: "https://recovery.example.org" },
      objectFiles: [{ name: "reports/tenant.json", bytes: Buffer.from(JSON.stringify({ tenant: "acme" })) }],
      lastCommittedWriteAt: "2026-09-20T02:02:00Z",
    });

    console.log(`DR-øvelse ${report.drillId}: primærklynge tilgængelig = ${report.primaryClusterAvailable}`);
    console.log(`Kendt rent punkt ramt: ${report.restore.knownCleanPoint}; komponenter: ${report.restore.components.join(", ")}`);
    console.log(`Afhængigheder: ${report.dependencyRecovery.map((d) => `${d.component}=${d.recovered}`).join(", ")}`);
    console.log(`RTO samlet brugerflow: ${report.measurements.measuredRtoMinutes} min (database alene ${report.measurements.databaseOnlyRtoMinutes} min, mål ${report.measurements.rtoTargetMinutes})`);
    console.log(`RPO: ${report.measurements.measuredRpoMinutes} min (mål ${report.measurements.rpoTargetMinutes})`);
    console.log(`Gate: ${report.gate.status}${report.gate.reasons.length ? ` — ${report.gate.reasons.join("; ")}` : ""}`);

    // 2) Bevis at primærklyngens driftscredentials ikke kan slette en beskyttet backup.
    const storagePlan = loadStoragePlan(repoRoot);
    const cluster = createStorageCluster({ plan: storagePlan, rootDir: join(work, "storage"), keyRing: createTenantKeyRing(deriveTestKeyRing()) });
    const put = cluster.put("acme", "backups/protected.enc", Buffer.from("backup-bytes"), { classification: "authoritative" });
    cluster.lockVersion("acme", "backups/protected.enc", put.version, { mode: "COMPLIANCE", retainUntil: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString() });
    const gate = createRecoveryAccessGate({ profile, storage: cluster });
    const denial = gate.deleteProtectedBackup({
      principal: { subject: "service:primary-ops", roleId: profile.primaryOperations.roleId, credentialsRef: profile.primaryOperations.credentialsRef },
      tenantId: "acme",
      key: "backups/protected.enc",
      version: put.version,
      copy: plan.copies.find((c) => c.immutable),
      approval: { approver1: { subject: "oidc|anna.andersen", name: "Anna Andersen" }, approver2: { subject: "oidc|cont.officer", name: "Carla Officer" } },
    });
    console.log(`Primær driftscredentials sletning: ${denial.decision} (${denial.code}) — slettet: ${denial.deleted}`);
    const after = cluster.versions("acme", "backups/protected.enc").find((v) => v.version === put.version);
    console.log(`Backup-versionen findes stadig: ${Boolean(after)} (låst: ${after?.lock?.mode ?? "nej"})`);

    db.close();
    if (report.gate.status !== "pass") process.exit(1);
    if (denial.decision !== "deny" || after === null) process.exit(1);
  } finally {
    try {
      db.close();
    } catch {
      /* allerede lukket */
    }
    rmSync(work, { recursive: true, force: true });
  }
}

const command = process.argv[2];
if (command === "write") writeDoc();
else if (command === "drill") await drill();
else {
  console.error("Brug: node backup/src/dr/cli.mjs <write|drill>");
  process.exit(2);
}
