import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStorageCluster } from "../src/object-store.mjs";
import { createTenantKeyRing, deriveTestKeyRing } from "../src/tenant-keys.mjs";
import { createEphemeralCache } from "../src/cache.mjs";
import { createRebuildableIndex } from "../src/index.mjs";
import { loadStoragePlan } from "../src/plan.mjs";
import { repoRoot } from "../../conformance/src/schemas.mjs";

const plan = loadStoragePlan(repoRoot);

function tmp(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("tab af cache ændrer ikke autoritative data", () => {
  const store = tmp("dkc-041-cstore-");
  const cacheDir = tmp("dkc-041-cache-");
  const cluster = createStorageCluster({ plan, rootDir: store.dir, keyRing: createTenantKeyRing(deriveTestKeyRing()) });
  const cache = createEphemeralCache({ rootDir: cacheDir.dir });
  try {
    const body = Buffer.from("autoritativ");
    cluster.put("acme", "docs/a.txt", body, { classification: "authoritative" });
    const before = cluster.get("acme", "docs/a.txt").sha256;
    cache.set("acme", "docs/a.txt", { cached: true });
    assert.deepEqual(cache.get("acme", "docs/a.txt"), { cached: true });
    cache.drop();
    assert.equal(cache.get("acme", "docs/a.txt"), null);
    const after = cluster.get("acme", "docs/a.txt").sha256;
    assert.equal(before, after);
    assert.equal(cluster.get("acme", "docs/a.txt").buffer.toString(), "autoritativ");
  } finally {
    store.cleanup();
    cacheDir.cleanup();
  }
});

test("genopbyggeligt indeks giver samme digest efter drop og rebuild", () => {
  const store = tmp("dkc-041-istore-");
  const indexDir = tmp("dkc-041-index-");
  const cluster = createStorageCluster({ plan, rootDir: store.dir, keyRing: createTenantKeyRing(deriveTestKeyRing()) });
  const index = createRebuildableIndex({ store: cluster, rootDir: indexDir.dir });
  try {
    cluster.put("acme", "b.txt", Buffer.from("b"), { classification: "authoritative" });
    cluster.put("acme", "a.txt", Buffer.from("a"), { classification: "object-store" });
    const first = index.build("acme");
    assert.equal(first.entries, 2);
    assert.deepEqual(index.lookup("acme", "a.txt").key, "a.txt");
    index.drop("acme");
    assert.equal(index.lookup("acme", "a.txt"), null);
    const second = index.build("acme");
    assert.equal(first.digest, second.digest);
  } finally {
    store.cleanup();
    indexDir.cleanup();
  }
});

test("cache er tenantadskilt", () => {
  const cacheDir = tmp("dkc-041-cache2-");
  const cache = createEphemeralCache({ rootDir: cacheDir.dir });
  try {
    cache.set("acme", "k", "acme");
    cache.set("globex", "k", "globex");
    assert.equal(cache.get("acme", "k"), "acme");
    assert.equal(cache.get("globex", "k"), "globex");
  } finally {
    cacheDir.cleanup();
  }
});
