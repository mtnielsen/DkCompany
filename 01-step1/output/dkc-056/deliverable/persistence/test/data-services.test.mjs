/**
 * DKC-056 — holdbare datatjenester.
 *
 * Beviser at profiler, kilder, bindinger, discovery-snapshots, migrationslog og
 * revisionsspor gemmes pr. tenant, at digesten er reproducerbar, og at en
 * fremmed tenant ikke kan se en andens datatjenester gennem lageret.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "../src/db.mjs";
import { createMigrator } from "../src/migrations.mjs";
import { createSqliteDataServicesStore } from "../src/adapters/data-services.mjs";
import { digestOf } from "../src/adapters/data-register.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const canonical = (name) => JSON.parse(readFileSync(join(here, "..", "..", "data-services", name), "utf8"));

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "dkc-data-services-"));
  const db = openDatabase({ path: join(dir, "data-services.db") });
  createMigrator({ db }).apply();
  const clock = () => Date.parse("2026-09-23T10:00:00Z");
  return {
    store: createSqliteDataServicesStore({ db, clock }),
    cleanup: () => {
      try {
        db.close();
      } catch {
        /* ignore */
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("migration 8 opretter datatjenestetabellerne", () => {
  const { store, cleanup } = fixture();
  try {
    assert.equal(store.listProfiles("acme").length, 0);
    assert.equal(store.listSources("acme").length, 0);
    assert.equal(store.listBindings("acme").length, 0);
  } finally {
    cleanup();
  }
});

test("profil, kilde og binding gemmes med reproducerbar digest", () => {
  const { store, cleanup } = fixture();
  try {
    const profile = canonical("profiles/managed-postgres.json");
    const source = canonical("sources/hr-source.json");
    const binding = canonical("bindings/dummy-ok-binding.json");

    assert.equal(store.saveProfile("acme", profile).digest, digestOf(profile));
    assert.equal(store.saveSource("acme", source).digest, digestOf(source));
    assert.equal(store.saveBinding("acme", binding).digest, digestOf(binding));

    assert.equal(store.getProfile("acme", "managed-postgres").profileType, "managed");
    const savedSource = store.getSource("acme", "hr-source");
    assert.deepEqual(savedSource.allowedTables, source.access.allowedTables);
    assert.equal(savedSource.readOnly, true);
    assert.deepEqual(savedSource.externalPolicy, { treatAsOwnDatabase: false, autoMigrate: false, autoBackup: false });
    assert.equal(savedSource.secretRef, source.connection.secretRef);
    assert.equal(store.getBinding("acme", "dummy-ok-binding").applicationRef, "dummy-ok");
  } finally {
    cleanup();
  }
});

test("discovery-snapshots, migrationslog og revisionsspor gemmes pr. kilde", () => {
  const { store, cleanup } = fixture();
  try {
    store.recordSchemaSnapshot("acme", "hr-source", { discoveredAt: "2026-09-23T00:00:00.000Z", schemas: [{ name: "hr", tables: [{ name: "employees", columns: [{ name: "id", type: "TEXT" }] }] }] });
    const snapshots = store.listSchemaSnapshots("acme", "hr-source");
    assert.equal(snapshots.length, 1);
    assert.equal(snapshots[0].digest.length, 64);

    const migration = store.recordMigration("acme", {
      profileRef: "managed-postgres",
      report: { ownedSchemas: ["app_dummy_ok"], destructiveCount: 0, statements: [{ operation: "create-table" }] },
      appliedBy: "oidc|david.dahl",
      approvedBy: "oidc|david.dahl",
      sql: "CREATE TABLE app_dummy_ok.notes (id TEXT)",
    });
    assert.equal(migration.appliedAt, "2026-09-23T10:00:00.000Z");
    const migrations = store.listMigrations("acme");
    assert.equal(migrations.length, 1);
    assert.deepEqual(migrations[0].ownedSchemas, ["app_dummy_ok"]);
    assert.equal(migrations[0].approvedBy, "oidc|david.dahl");

    store.recordAudit("acme", { sourceId: "hr-source", operation: "connect", principal: "svc:hr", allowed: true });
    store.recordAudit("acme", { sourceId: "hr-source", operation: "denied", principal: "svc:hr", allowed: false, reason: "scope", sqlDigest: "0".repeat(64) });
    const audit = store.listAudit("acme", { sourceId: "hr-source" });
    assert.equal(audit.length, 2);
    assert.equal(audit.some((e) => e.allowed === false), true);
  } finally {
    cleanup();
  }
});

test("en fremmed tenant kan ikke læse en andens datatjenester", () => {
  const { store, cleanup } = fixture();
  try {
    store.saveProfile("acme", canonical("profiles/managed-postgres.json"));
    store.saveSource("acme", canonical("sources/hr-source.json"));
    store.recordAudit("acme", { sourceId: "hr-source", operation: "connect", principal: "svc:hr", allowed: true });

    assert.deepEqual(store.listProfiles("globex"), []);
    assert.equal(store.getProfile("globex", "managed-postgres"), null);
    assert.deepEqual(store.listSources("globex"), []);
    assert.deepEqual(store.listAudit("globex"), []);
  } finally {
    cleanup();
  }
});
