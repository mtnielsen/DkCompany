/**
 * DKC-019 — holdbart dataregister, retention, blockere og holds.
 *
 * Beviser at registeret gemmes versioneret pr. tenant, at en persondatapost
 * uden ejerbeslutning/aftale markeres som blocker, at tenants ikke kan se
 * hinandens poster gennem lageret, og at et aktivt hold kan sættes og frigives.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "../src/db.mjs";
import { createMigrator } from "../src/migrations.mjs";
import { createSqliteDataRegisterStore, digestOf } from "../src/adapters/data-register.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const examplePath = join(here, "..", "..", "contracts", "examples", "data-register.example.json");
const example = () => JSON.parse(readFileSync(examplePath, "utf8"));

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "dkc-data-register-"));
  const db = openDatabase({ path: join(dir, "register.db") });
  createMigrator({ db }).apply();
  const clock = () => Date.parse("2026-09-23T10:00:00Z");
  return {
    db,
    dir,
    store: createSqliteDataRegisterStore({ db, clock }),
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

test("registerversionen gemmes med digest, poster, retention og subprocessorer", () => {
  const { store, cleanup } = fixture();
  try {
    const register = example();
    const saved = store.saveVersion("acme", register, { createdBy: "oidc|anna", approvedBy: "oidc|anna" });
    assert.equal(saved.entryCount, register.entries.length);
    assert.equal(saved.digest, digestOf(register));

    const entries = store.listEntries("acme");
    assert.equal(entries.length, register.entries.length);
    const personal = entries.find((e) => e.entryId === "example-assistant");
    assert.equal(personal.personal, true);
    assert.equal(personal.status, "approved");
    assert.equal(personal.blockerCount, 0);
    assert.equal(personal.hasContract, true);

    const retention = store.listRetention("acme");
    assert.equal(retention.length, register.entries.length);
    const policy = retention.find((r) => r.entryId === "example-assistant");
    assert.equal(policy.purposeRef, "support-answer");
    assert.equal(policy.version, "1.0.0");

    assert.equal(store.listSubprocessors("acme").length, register.subprocessors.length);
    const versions = store.listVersions("acme");
    assert.equal(versions.length, 1);
    assert.equal(versions[0].digest, saved.digest);
  } finally {
    cleanup();
  }
});

test("tenantgrænsen håndhæves i lageret: fremmed tenant ser ingen poster", () => {
  const { store, cleanup } = fixture();
  try {
    store.saveVersion("acme", example());
    assert.equal(store.listEntries("globex").length, 0);
    assert.equal(store.getEntry("globex", "example-assistant"), null);
    assert.equal(store.listEntries("acme").length, example().entries.length);
    assert.throws(() => store.listEntries("UPPER CASE"), /ugyldig tenant-id/);
  } finally {
    cleanup();
  }
});

test("en persondatapost uden ejerbeslutning og aftale registreres som blocker", () => {
  const { store, cleanup } = fixture();
  try {
    const register = example();
    const entry = register.entries.find((e) => e.id === "example-assistant");
    entry.status = "blocked";
    entry.legalBasis = { status: "pending-owner-decision", ground: null, decidedBy: null, decidedAt: null, note: "Afventer ejer" };
    entry.roles.controller = null;
    entry.location.thirdCountryTransfer = { assessed: false, status: "undetermined", mechanisms: [], assessedBy: null, assessedAt: null };
    store.saveVersion("acme", register);
    const blockers = store.listBlockers("acme");
    assert.equal(blockers.length, 1);
    assert.equal(blockers[0].entryId, "example-assistant");
    assert.ok(blockers[0].blockerCount >= 3);
  } finally {
    cleanup();
  }
});

test("holds kan sættes, ses og frigives", () => {
  const { store, cleanup } = fixture();
  try {
    store.saveVersion("acme", example());
    const hold = store.placeHold("acme", { entryId: "example-assistant", reason: "Verserende retssag", placedBy: "oidc|legal", holdId: "hold-1" });
    assert.equal(hold.holdId, "hold-1");
    assert.equal(store.hasActiveHold("acme", "example-assistant"), true);
    assert.equal(store.hasActiveHold("globex", "example-assistant"), false);
    const released = store.releaseHold("acme", "hold-1", { releasedBy: "oidc|legal" });
    assert.equal(released.changed, true);
    assert.equal(store.hasActiveHold("acme", "example-assistant"), false);
    assert.equal(store.listHolds("acme", "example-assistant").length, 1);
  } finally {
    cleanup();
  }
});

test("en ny registerversion ændrer digesten men bevarer historikken", () => {
  const { store, cleanup } = fixture();
  try {
    const v1 = example();
    const first = store.saveVersion("acme", v1);
    const v2 = JSON.parse(JSON.stringify(v1));
    v2.metadata.version = "1.1.0";
    v2.entries[0].retention.maxDays = 180;
    const second = store.saveVersion("acme", v2, { versionId: "acme@1.1.0" });
    assert.notEqual(second.digest, first.digest);
    assert.equal(store.listVersions("acme").length, 2);
    assert.equal(store.getEntry("acme", "example-assistant").registerVersion, "1.1.0");
  } finally {
    cleanup();
  }
});
