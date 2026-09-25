#!/usr/bin/env node
/**
 * DKC-009 — fokuseret kontrol af holdbar audit.
 *
 *   node --no-warnings persistence/src/audit-check.mjs
 *
 * Kontrollerer uden et levende setup at:
 *   - v3-migrationen findes, og intent-/personal-tabellerne er der,
 *   - et intent committes som `pending` og et outcome som `succeeded`,
 *   - et gentaget intent ikke skaber en ny begivenhed (idempotens),
 *   - et checkpoint forankres og verificerer, og en ændring opdages,
 *   - hemmeligheder redigeres væk, og
 *   - skrive-/læserrollerne er adskilte.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "./db.mjs";
import { migrateDatabase } from "./identities.mjs";
import { createSqliteAuditLog } from "./adapters/audit.mjs";
import { createSqliteActionJournal } from "./adapters/audit-journal.mjs";
import { createCheckpointStore } from "./checkpoint.mjs";
import { openAuditWriter, openAuditReader } from "./audit-roles.mjs";

const errors = [];
const notes = [];
const check = (condition, message) => {
  if (!condition) errors.push(message);
};

const dir = mkdtempSync(join(tmpdir(), "dkc-audit-check-"));
try {
  const db = openDatabase({ path: join(dir, "audit.db") });
  migrateDatabase(db);

  check(db.get("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'audit_intents'"), "audit_intents mangler");
  check(db.get("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'audit_personal'"), "audit_personal mangler");

  const audit = createSqliteAuditLog({ db });
  const checkpoints = createCheckpointStore({ audit, anchorDir: join(dir, "anchors"), secret: "check-secret" });
  const journal = createSqliteActionJournal({ db, audit, checkpoint: checkpoints });

  const begun = journal.begin({ tenantId: "acme", idempotencyId: "check-1", verb: "backup", target: "db", request: { password: "hunter2" } });
  check(begun.ok === true, "intent skulle committes");
  check(begun.state === "pending", "intent skulle være pending");
  check(audit.verifyChain("acme").ok, "hash-kæden er brudt");
  check(!JSON.stringify(audit.events("acme")).includes("hunter2"), "en hemmelighed optrådte i loggen");
  check(checkpoints.verify({ tenantId: "acme" }).ok, "checkpointet skulle verificere");

  const duplicate = journal.begin({ tenantId: "acme", idempotencyId: "check-1", verb: "backup", target: "db", request: {} });
  check(duplicate.duplicate === true, "et gentaget intent skulle afvises");
  check(audit.events("acme").filter((e) => e.phase === "intent").length === 1, "et gentaget intent skabte en ny begivenhed");

  const completed = journal.complete({ tenantId: "acme", idempotencyId: "check-1", outcome: "succeeded", result: { ok: true } });
  check(completed.state === "succeeded", "outcome skulle sætte state til succeeded");
  check(journal.verify("acme").ok, "journal-konsistenskontrollen fejlede");
  check(checkpoints.verify({ tenantId: "acme" }).ok, "checkpointet skulle stadig verificere efter outcome");

  // Ændring af en begivenhed skal opdages mod checkpointet (separat tenant, så
  // acme-kæden forbliver intakt til rolletjekket).
  audit.append({ tenantId: "globex", type: "g0", payload: {} });
  audit.append({ tenantId: "globex", type: "g1", payload: {} });
  checkpoints.anchor({ tenantId: "globex" });
  db.prepare("UPDATE audit_events SET payload = '{\"tampered\":true}' WHERE tenant_id = 'globex' AND seq = (SELECT MIN(seq) FROM audit_events WHERE tenant_id = 'globex')").run();
  check(checkpoints.verify({ tenantId: "globex" }).ok === false, "en ændring blev ikke opdaget mod checkpointet");
  const tenants = audit.tenants().length;
  const chains = Object.keys(audit.verifyAll()).length;
  db.close();
  notes.push(`${tenants} tenants, ${chains} kæder`);

  // Rollerne.
  const writer = openAuditWriter({ dataDir: dir, anchorDir: join(dir, "anchors2"), secret: "k" });
  check(writer.role === "audit-writer", "writer-rollen er forkert");
  writer.journal.begin({ tenantId: "acme", idempotencyId: "role-1", verb: "backup", target: "db", request: {} });
  writer.close();
  const reader = openAuditReader({ dataDir: dir, anchorDir: join(dir, "anchors2"), secret: "k" });
  check(reader.readOnly === true, "reader-rollen skal være skrivebeskyttet");
  check(reader.verifyChain("acme").ok, "reader kunne ikke verificere kæden");
  check(typeof reader.append === "undefined", "reader eksponerer en skrive-metode");
  reader.close();
  notes.push("2 adskilte audit-roller");
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (errors.length) {
  console.error("✘ Audit-holdbarhedskontrol fejlede:\n");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`✔ Audit-holdbarhedskontrol bestået (${notes.join("; ")})`);
console.log("✔ intent/outcome, idempotens, checkpoint, redaktion og roller verificeret");
