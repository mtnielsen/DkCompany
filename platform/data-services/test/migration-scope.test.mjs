import { test } from "node:test";
import assert from "node:assert/strict";
import {
  analyzeMigration,
  assertMigrationAllowed,
  applyMigration,
  assertExternalMigrationRefused,
  splitStatements,
} from "../src/migration-scope.mjs";
import { MigrationScopeError } from "../src/errors.mjs";
import { createSqliteDriver } from "../src/drivers/sqlite.mjs";

const PROFILE = {
  metadata: { name: "managed-postgres" },
  migrations: {
    strategy: "versioned-sql",
    ownedSchemas: ["app_dummy_ok"],
    foreignSchemaPolicy: "never",
    backupBeforeMigrate: true,
    destructiveChangesRequireApproval: true,
  },
};

test("statement-splitning rører ikke semikolon i strengliteraler", () => {
  const statements = splitStatements("INSERT INTO app_dummy_ok.t VALUES ('a;b'); CREATE TABLE app_dummy_ok.x (id TEXT)");
  assert.equal(statements.length, 2);
});

test("et fremmed schema afvises", () => {
  const report = analyzeMigration("ALTER TABLE hr.employees ADD COLUMN x TEXT", PROFILE);
  assert.equal(report.ok, false);
  assert.match(report.errors.join(" "), /hr/);
});

test("DROP SCHEMA afvises altid", () => {
  const report = analyzeMigration("DROP SCHEMA hr", PROFILE);
  assert.equal(report.ok, false);
  assert.match(report.errors.join(" "), /DROP SCHEMA/);
});

test("DELETE uden WHERE afvises", () => {
  const report = analyzeMigration("DELETE FROM app_dummy_ok.notes", PROFILE);
  assert.equal(report.ok, false);
  assert.match(report.errors.join(" "), /alle rækker/);
});

test("destruktiv migration kræver en navngivet godkender", () => {
  assert.throws(() => assertMigrationAllowed("DELETE FROM app_dummy_ok.notes WHERE id = 'a'", PROFILE), MigrationScopeError);
  const report = assertMigrationAllowed("DELETE FROM app_dummy_ok.notes WHERE id = 'a'", PROFILE, {
    approvedBy: { subject: "oidc|david.dahl", name: "David Dahl", role: "Service Owner" },
  });
  assert.equal(report.ok, true);
});

test("en ekstern datakilde må ikke migreres", () => {
  assert.throws(() => assertExternalMigrationRefused({ metadata: { name: "hr-source" } }), MigrationScopeError);
});

test("applyMigration ændrer ikke eksisterende data og kalder backup før destruktiv", async () => {
  const driver = createSqliteDriver({ path: ":memory:" });
  await driver.connect();
  try {
    await driver.query("CREATE TABLE foreign_data (id TEXT PRIMARY KEY, value TEXT)");
    await driver.query("INSERT INTO foreign_data VALUES ('f1', 'bevar-mig')");
    await driver.query("CREATE TABLE app_dummy_ok_notes (id TEXT PRIMARY KEY, value TEXT)");
    await driver.query("INSERT INTO app_dummy_ok_notes VALUES ('n1', 'gammel')");

    let backedUp = false;
    await applyMigration(
      driver,
      "CREATE TABLE IF NOT EXISTS app_dummy_ok_extra (id TEXT PRIMARY KEY, value TEXT)",
      { ...PROFILE, migrations: { ...PROFILE.migrations, ownedSchemas: ["main"] } }
    );
    assert.equal(backedUp, false);

    await applyMigration(driver, "DELETE FROM app_dummy_ok_notes WHERE id = 'n1'", { ...PROFILE, migrations: { ...PROFILE.migrations, ownedSchemas: ["main"] } }, {
      approvedBy: { subject: "oidc|david.dahl", name: "David Dahl", role: "Service Owner" },
      onBeforeBackup: async () => {
        backedUp = true;
      },
    });
    assert.equal(backedUp, true);

    const foreign = await driver.query("SELECT * FROM foreign_data");
    assert.deepEqual(foreign.rows.map((row) => ({ ...row })), [{ id: "f1", value: "bevar-mig" }]);
    const owned = await driver.query("SELECT COUNT(*) AS c FROM app_dummy_ok_notes");
    assert.equal(Number(owned.rows[0].c), 0);
  } finally {
    await driver.close();
  }
});
