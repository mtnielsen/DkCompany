import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStorageCluster } from "../../storage/src/object-store.mjs";
import { createTenantKeyRing, deriveTestKeyRing } from "../../storage/src/tenant-keys.mjs";
import { loadStoragePlan } from "../../storage/src/plan.mjs";
import { repoRoot } from "../../conformance/src/schemas.mjs";

const plan = loadStoragePlan(repoRoot);

function fixture() {
  const rootDir = mkdtempSync(join(tmpdir(), "dkc-048-worm-"));
  const store = createStorageCluster({ plan, rootDir, keyRing: createTenantKeyRing(deriveTestKeyRing()) });
  return { store, cleanup: () => rmSync(rootDir, { recursive: true, force: true }) };
}

const TENANT = "acme";
const KEY = "protected/audit.log";
const NOW = Date.parse("2026-09-26T00:00:00Z");
const FAR = new Date(NOW + 10 * 365 * 24 * 3600 * 1000).toISOString();

test("en aktiv COMPLIANCE-lås kan ikke slettes, heller ikke med bypass", () => {
  const { store, cleanup } = fixture();
  try {
    const put = store.put(TENANT, KEY, Buffer.from("autoritativ"), { classification: "object-store", now: NOW });
    const lock = store.lockVersion(TENANT, KEY, put.version, { mode: "COMPLIANCE", retainUntil: FAR, now: NOW });
    assert.equal(lock.committed, true);
    const denied = store.deleteVersion(TENANT, KEY, put.version, { bypassGovernance: true, now: NOW });
    assert.equal(denied.deleted, false);
    assert.equal(denied.reason, "compliance-locked");
  } finally {
    cleanup();
  }
});

test("en GOVERNANCE-lås kræver et eksplicit bypass-flag for sletning", () => {
  const { store, cleanup } = fixture();
  try {
    const put = store.put(TENANT, KEY, Buffer.from("gov"), { classification: "object-store", now: NOW });
    store.lockVersion(TENANT, KEY, put.version, { mode: "GOVERNANCE", retainUntil: FAR, now: NOW });
    assert.equal(store.deleteVersion(TENANT, KEY, put.version, { now: NOW }).reason, "governance-locked");
    const bypassed = store.deleteVersion(TENANT, KEY, put.version, { bypassGovernance: true, now: NOW });
    assert.equal(bypassed.deleted, true);
  } finally {
    cleanup();
  }
});

test("retention kan forlænges men aldrig forkortes eller nedgraderes", () => {
  const { store, cleanup } = fixture();
  try {
    const put = store.put(TENANT, KEY, Buffer.from("v1"), { classification: "object-store", now: NOW });
    store.lockVersion(TENANT, KEY, put.version, { mode: "COMPLIANCE", retainUntil: FAR, now: NOW });
    const shorten = store.lockVersion(TENANT, KEY, put.version, { mode: "COMPLIANCE", retainUntil: new Date(NOW + 24 * 3600 * 1000).toISOString(), now: NOW });
    assert.equal(shorten.committed, false);
    assert.equal(shorten.reason, "retention-shorten");
    const downgrade = store.lockVersion(TENANT, KEY, put.version, { mode: "GOVERNANCE", retainUntil: FAR, now: NOW });
    assert.equal(downgrade.committed, false);
    assert.equal(downgrade.reason, "mode-downgrade");
    const extend = store.lockVersion(TENANT, KEY, put.version, { mode: "COMPLIANCE", retainUntil: new Date(NOW + 20 * 365 * 24 * 3600 * 1000).toISOString(), now: NOW });
    assert.equal(extend.committed, true);
  } finally {
    cleanup();
  }
});

test("en ny version skjuler ikke den autoritative låste version", () => {
  const { store, cleanup } = fixture();
  try {
    const first = store.put(TENANT, KEY, Buffer.from("version-1"), { classification: "object-store", now: NOW });
    store.lockVersion(TENANT, KEY, first.version, { mode: "COMPLIANCE", retainUntil: FAR, now: NOW });
    store.put(TENANT, KEY, Buffer.from("version-2"), { classification: "object-store", now: NOW + 1000 });
    const authoritative = store.authoritative(TENANT, KEY);
    assert.equal(authoritative.version, first.version);
    assert.equal(authoritative.locked, true);
    assert.equal(store.getAuthoritative(TENANT, KEY).buffer.toString(), "version-1");
    // Den nyeste version er stadig tilgængelig eksplicit.
    assert.equal(store.get(TENANT, KEY).buffer.toString(), "version-2");
  } finally {
    cleanup();
  }
});

test("versions() og locks() rapporterer låsemetadata", () => {
  const { store, cleanup } = fixture();
  try {
    const put = store.put(TENANT, KEY, Buffer.from("v1"), { classification: "object-store", now: NOW });
    store.lockVersion(TENANT, KEY, put.version, { mode: "GOVERNANCE", retainUntil: FAR, now: NOW });
    const versions = store.versions(TENANT, KEY);
    assert.equal(versions.length, 1);
    assert.equal(versions[0].lock.mode, "GOVERNANCE");
    const locks = store.locks(TENANT);
    assert.equal(locks.length, 1);
    assert.equal(locks[0].lock.retainUntil, FAR);
  } finally {
    cleanup();
  }
});

test("låse replikeres til skrive-quorum", () => {
  const { store, cleanup } = fixture();
  try {
    const put = store.put(TENANT, KEY, Buffer.from("v1"), { classification: "object-store", now: NOW });
    const lock = store.lockVersion(TENANT, KEY, put.version, { mode: "COMPLIANCE", retainUntil: FAR, now: NOW });
    assert.ok(lock.replicas.length >= plan.topology.writeQuorum);
  } finally {
    cleanup();
  }
});
