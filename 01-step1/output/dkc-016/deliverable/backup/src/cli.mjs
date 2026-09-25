#!/usr/bin/env node
/**
 * DKC-016 — demonstration af en rigtig krypteret backup og isoleret
 * gendannelsesøvelse mod en lokal, syntetisk SQLite-database.
 *
 *   node backup/src/cli.mjs drill
 *
 * Kører på syntetiske data i en midlertidig mappe. Øvelsen tager backup,
 * gendanner i et isoleret miljø, anvender suppressionsjournalen og rapporterer
 * målte RPO/RTO. Afvigelser giver exit != 0.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCheckpointStore, createMigrator, createSqliteAuditLog, openDatabase } from "../../persistence/src/index.mjs";
import { createSqliteActionJournal } from "../../persistence/src/adapters/audit-journal.mjs";
import { createMemoryKeyProvider, createSuppressionLedger, runRestoreDrill } from "./index.mjs";

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

async function main() {
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

if (process.argv[2] === "drill") {
  main().catch((err) => {
    console.error(err.stack ?? err.message);
    process.exit(1);
  });
} else {
  console.error("Brug: node backup/src/cli.mjs drill");
  process.exit(2);
}
