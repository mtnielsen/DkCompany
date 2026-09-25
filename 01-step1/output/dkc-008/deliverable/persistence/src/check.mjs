#!/usr/bin/env node
/**
 * DKC-008 — fokuseret kontrol af persistenslaget.
 *
 *   node persistence/src/check.mjs
 *
 * Kontrollerer uden et levende database-setup at:
 *   - migrationsfilerne er sammenhængende nummereret fra 1,
 *   - de kan anvendes på en ren database og efterlader de forventede tabeller,
 *   - en ny kørsel er idempotent, og der ikke er checksum-afvigelser,
 *   - hver databaseidentitet kan åbne+migrere, og
 *   - en skrivebeskyttet identitet faktisk afvises ved skrivning.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, TENANT_TABLES } from "./db.mjs";
import { createMigrator, discoverMigrations } from "./migrations.mjs";
import { DB_IDENTITIES, openIdentity } from "./identities.mjs";

const errors = [];
const notes = [];

function check(condition, message) {
  if (!condition) errors.push(message);
}

// 1) Sammenhængende versionsnumre.
const migrations = discoverMigrations();
check(migrations.length >= 2, "der skal være mindst to versioner for at bevise opgradering");
check(migrations[0]?.version === 1, "første migration skal være version 1");
for (let i = 1; i < migrations.length; i++) {
  check(migrations[i].version === migrations[i - 1].version + 1, `hul i versionsrækken ved v${migrations[i].version}`);
}
notes.push(`${migrations.length} migrationer: ${migrations.map((m) => `v${m.version}`).join(", ")}`);

// 2) Anvend på en ren database.
const dir = mkdtempSync(join(tmpdir(), "dkc-persist-check-"));
try {
  const db = openDatabase({ path: join(dir, "check.db") });
  const migrator = createMigrator({ db });
  const first = migrator.apply();
  check(first.applied.length === migrations.length, "alle migrationer skulle være anvendt");
  check(migrator.status().problems.length === 0, "checksum-historikken er i orden");
  for (const [table, view] of Object.entries(TENANT_TABLES)) {
    const present = db.get("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?", table);
    check(Boolean(present), `tabellen ${table} mangler`);
    db.setTenant("acme");
    const viewPresent = db.get("SELECT 1 AS present FROM sqlite_temp_master WHERE type = 'view' AND name = ?", view);
    check(Boolean(viewPresent), `tenant-viewet ${view} mangler`);
  }
  const second = migrator.apply();
  check(second.applied.length === 0, "en gentagen migrering skal være idempotent");
  db.close();

  // 3) Hver identitet åbner og migrerer; skrivebeskyttet identitet afvises.
  for (const name of Object.keys(DB_IDENTITIES)) {
    const identity = openIdentity(name, { dataDir: dir });
    check(identity.domains.length > 0, `identiteten ${name} har ingen domæner`);
    identity.close();
  }
  const reader = openIdentity("approvals", { dataDir: dir, readOnly: true, migrate: false });
  check(reader.readOnly === true, "rapporteringsidentiteten skal være skrivebeskyttet");
  let blocked = false;
  try {
    reader.db.exec("INSERT INTO approval_requests(tenant_id, id, state, data, updated_at) VALUES('x','y','pending','{}','now')");
  } catch {
    blocked = true;
  }
  check(blocked, "en skrivebeskyttet databaseidentitet må ikke kunne skrive");
  reader.close();
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (errors.length) {
  console.error("✘ Persistenskontrol fejlede:\n");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`✔ Persistenskontrol bestået (${notes.join("; ")})`);
console.log(`✔ ${Object.keys(DB_IDENTITIES).length} databaseidentiteter og ${Object.keys(TENANT_TABLES).length} tenant-views verificeret`);
