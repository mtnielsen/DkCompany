#!/usr/bin/env node
/**
 * DKC-043 — CLI for dedup.
 *
 *   node dedup/src/cli.mjs write   # skriv docs/storage/dedup-plan.md fra politikken
 *   node dedup/src/cli.mjs check   # politik, semantik, providers og dokumentsync
 *   node dedup/src/cli.mjs drill   # rigtig backup → dedup → mål → fuld restore
 *
 * En `drill` kører over et rigtigt filsystem og en rigtig SQLite-backup med
 * `measured: true`. En målt dedup-effekt på et levende objektlager er
 * `integration-dedup-live` og er NOT RUN.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createMemoryKeyProvider } from "../../backup/src/keys.mjs";
import { createSuppressionLedger } from "../../backup/src/suppression.mjs";
import { createBackup } from "../../backup/src/vault.mjs";
import { functionalChecks } from "../../backup/src/restore.mjs";
import { createMigrator, createSqliteAuditLog, openDatabase } from "../../persistence/src/index.mjs";
import { loadDedupPolicy } from "./policy.mjs";
import { renderDedupPlan, DEDUP_PLAN_DOC } from "./render.mjs";
import { createDedupStore } from "./store.mjs";
import { createMemoryMasterKey, createDedupKeyRing } from "./keys.mjs";
import { deduplicateBackup, restoreDedupedBackup, snapshotIdFor } from "./backup.mjs";
import { evaluateSavingsGate } from "./measure.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(here, "..", "..");

export function runWrite(root = repoRoot) {
  const policy = loadDedupPolicy(root);
  const path = join(root, DEDUP_PLAN_DOC);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, renderDedupPlan(policy));
  return { path, policy };
}

async function runDrill() {
  const dir = mkdtempSync(join(tmpdir(), "dkc-dedup-drill-"));
  try {
    const db = openDatabase({ path: join(dir, "live.db") });
    createMigrator({ db }).apply();
    const audit = createSqliteAuditLog({ db });
    audit.append({ tenantId: "acme", type: "dedup.drill", payload: { hello: "world" } });

    const ledger = createSuppressionLedger({ path: join(dir, "suppression.ndjson") });
    const keyProvider = createMemoryKeyProvider();
    // Deterministisk payload med gentagne blokke, så dedup faktisk betaler sig.
    const block = Buffer.from("DKC-043 syntetisk blok. ".repeat(256), "utf8");
    const objectFiles = [
      { name: "reports/q3.json", bytes: Buffer.concat([block, block]) },
      { name: "reports/q4.json", bytes: Buffer.concat([block, Buffer.from("kun q4", "utf8")]) },
    ];
    const { manifest, storeDir } = await createBackup({ db, tenantId: "acme", outDir: join(dir, "backup"), keyProvider, suppressionLedger: ledger, config: { endpoint: "https://example.org" }, objectFiles });
    db.close();

    const keyRing = createDedupKeyRing({ masterKey: createMemoryMasterKey(), keyId: "dedup-drill" });
    const store = createDedupStore({ rootDir: join(dir, "dedup"), keyRing });
    const domain = { tenantId: "acme", encryptionDomain: "eu-primary", retentionClass: "financial-7y", category: "backup-blocks" };
    const deduped = deduplicateBackup({ storeDir, manifest, keyProvider, store, domain, protectedSnapshot: true });
    const snapshotIds = manifest.components.map((component) => snapshotIdFor(manifest.backupId, component));
    const gate = evaluateSavingsGate({ store, domain, snapshotIds });
    const restored = restoreDedupedBackup({ store, manifest, domain, targetDir: join(dir, "restore") });
    const checks = functionalChecks({ dbPath: restored.dbPath });
    const drill = {
      measured: true,
      backupId: manifest.backupId,
      componentCount: deduped.componentCount,
      logicalBytes: gate.measurement.logicalBytes,
      physicalBytes: gate.measurement.physicalBytes,
      savedBytes: gate.measurement.savedBytes,
      physicalToLogicalRatio: Number(gate.measurement.physicalToLogicalRatio.toFixed(6)),
      uniqueChunks: gate.measurement.uniqueChunks,
      integrity: gate.integrity,
      restore: gate.restore,
      savingsActive: gate.savingsActive,
      functionalChecks: checks,
      note: "En målt dedup-effekt på et levende objektlager er integration-dedup-live og er NOT RUN.",
    };
    const ok = drill.savingsActive && checks.every((c) => c.status === "pass");
    console.log(JSON.stringify(drill, null, 2));
    if (!ok) {
      console.error("✘ Dedup-drill fejlede: besparelsen blev ikke aktiveret eller en funktionel kontrol fejlede");
      process.exitCode = 1;
    } else {
      console.log("✔ Dedup-drill bestået: besparelse aktiveret efter bestået integritet og fuld restore");
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const command = process.argv[2];
if (command === "write") {
  const { path } = runWrite();
  console.log(`✔ skrev ${path.replace(repoRoot + "/", "")}`);
} else if (command === "check") {
  await import("./check.mjs");
} else if (command === "drill") {
  await runDrill();
} else {
  console.error("Brug: node dedup/src/cli.mjs <write|check|drill>");
  process.exit(2);
}
