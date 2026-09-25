import { test } from "node:test";
import assert from "node:assert/strict";
import { createSqliteDriver } from "../src/drivers/sqlite.mjs";
import { createPostgresDriver } from "../src/drivers/postgres.mjs";
import { createNotesRepository } from "../src/app-repository.mjs";
import { createRecovery, assertBackupAllowed } from "../src/recovery.mjs";
import { createFakePostgres } from "./support/fake-postgres.mjs";
import { BackupScopeError } from "../src/errors.mjs";

const PROFILE = { metadata: { name: "managed-postgres" }, backup: { enabled: true, verifiedRestore: true } };

async function contractAndRecovery(driver) {
  const repo = createNotesRepository(driver);
  await repo.migrate();
  await repo.create({ id: "a", body: "en", createdAt: "2026-01-01T00:00:00.000Z" });
  await repo.create({ id: "b", body: "to", createdAt: "2026-01-02T00:00:00.000Z" });
  assert.equal(await repo.count(), 2);

  const recovery = createRecovery({ store: repo });
  const snapshot = await recovery.backup({ profile: PROFILE });
  assert.equal(snapshot.rowCount, 2);
  assert.equal(snapshot.digest.length, 64);

  await repo.create({ id: "c", body: "tre", createdAt: "2026-01-03T00:00:00.000Z" });
  assert.equal(await repo.count(), 3);

  const restored = await recovery.restore(snapshot);
  assert.equal(restored.restored, 2);
  const verified = await recovery.verifyRestore(snapshot);
  assert.equal(verified.ok, true);
  assert.equal(await repo.count(), 2);
  assert.equal(await repo.get("c"), null);
}

test("samme app-kontrakt og recovery mod den indbyggede SQLite-database", async () => {
  const driver = createSqliteDriver({ path: ":memory:" });
  await driver.connect();
  try {
    await contractAndRecovery(driver);
  } finally {
    await driver.close();
  }
});

test("samme app-kontrakt og recovery mod den eksterne PostgreSQL-database", async () => {
  const server = await createFakePostgres({ auth: "trust" });
  const driver = createPostgresDriver({
    host: server.host,
    port: server.port,
    user: server.user,
    database: server.database,
    ssl: { mode: "disable" },
  });
  await driver.connect();
  try {
    await contractAndRecovery(driver);
  } finally {
    await driver.close();
    await server.close();
  }
});

test("en ekstern kilde må ikke sikkerhedskopieres uden en scope-aftale", () => {
  const source = {
    kind: "DataSource",
    metadata: { name: "hr-source" },
    externalPolicy: { autoBackup: false, scopeAgreementRef: "scope://customer/hr" },
  };
  // autoBackup=false er kontraktuelt låst: hverken med eller uden scope må kilden sikkerhedskopieres.
  assert.throws(() => assertBackupAllowed(source), BackupScopeError);
  assert.throws(() => assertBackupAllowed(source, { scopeAgreementRef: "scope://customer/hr" }), BackupScopeError);

  const scoped = { ...source, externalPolicy: { autoBackup: true, scopeAgreementRef: null } };
  assert.throws(() => assertBackupAllowed(scoped), BackupScopeError);
  assert.deepEqual(assertBackupAllowed(scoped, { scopeAgreementRef: "scope://customer/hr" }), {
    allowed: true,
    reason: "explicit-scope-agreement",
    agreement: "scope://customer/hr",
  });
});

test("en muteret snapshot afvises ved gendannelse", async () => {
  const driver = createSqliteDriver({ path: ":memory:" });
  await driver.connect();
  try {
    const repo = createNotesRepository(driver);
    await repo.migrate();
    await repo.create({ id: "a", body: "en" });
    const recovery = createRecovery({ store: repo });
    const snapshot = await recovery.backup({ profile: PROFILE });
    snapshot.rows[0].body = "manipuleret";
    await assert.rejects(() => recovery.restore(snapshot), BackupScopeError);
  } finally {
    await driver.close();
  }
});
