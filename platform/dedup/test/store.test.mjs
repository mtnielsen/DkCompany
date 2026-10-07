import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDedupStore, normalizeDedupDomain } from "../src/store.mjs";
import { createDedupKeyRing, deriveTestKeyRing } from "../src/keys.mjs";

const DOMAIN = { tenantId: "acme", encryptionDomain: "eu-primary", retentionClass: "financial-7y", category: "backup-blocks" };

function workDir(prefix = "dkc-dedup-store-") {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function newStore(dir, options = {}) {
  const keyRing = createDedupKeyRing(deriveTestKeyRing());
  return createDedupStore({ rootDir: dir, keyRing, ...options });
}

function bytes(size, seed = 1) {
  const buf = Buffer.alloc(size);
  for (let i = 0; i < size; i += 1) buf[i] = (i * seed + 17) % 251;
  return buf;
}

test("identisk indhold gemmes kun én gang og referencetælles", () => {
  const { dir, cleanup } = workDir();
  try {
    const store = newStore(dir);
    const data = bytes(64 * 1024, 3);
    const a = store.putSnapshot({ domain: DOMAIN, snapshotId: "snap-a", buffer: data });
    const b = store.putSnapshot({ domain: DOMAIN, snapshotId: "snap-b", buffer: data });
    assert.ok(a.uniqueChunks > 0);
    assert.equal(b.uniqueChunks, 0, "anden reference må ikke skrive nye chunks");
    assert.deepEqual(store.readSnapshot({ domain: DOMAIN, snapshotId: "snap-a" }), data);
    assert.deepEqual(store.readSnapshot({ domain: DOMAIN, snapshotId: "snap-b" }), data);
    const measure = store.measure({ domain: DOMAIN });
    assert.equal(measure.logicalBytes, data.length * 2);
    assert.ok(measure.physicalBytes < measure.logicalBytes);
    assert.equal(measure.snapshots, 2);
  } finally {
    cleanup();
  }
});

test("sletning af én reference ødelægger ikke en anden", () => {
  const { dir, cleanup } = workDir();
  try {
    const store = newStore(dir);
    const data = bytes(48 * 1024, 5);
    store.putSnapshot({ domain: DOMAIN, snapshotId: "snap-a", buffer: data });
    store.putSnapshot({ domain: DOMAIN, snapshotId: "snap-b", buffer: data });
    const removed = store.removeSnapshot({ domain: DOMAIN, snapshotId: "snap-a" });
    assert.equal(removed.removed, true);
    assert.throws(() => store.readSnapshot({ domain: DOMAIN, snapshotId: "snap-a" }), /findes ikke/);
    assert.deepEqual(store.readSnapshot({ domain: DOMAIN, snapshotId: "snap-b" }), data);
  } finally {
    cleanup();
  }
});

test("et beskyttet snapshot overlever prune, og retention frigiver kun udløbne", () => {
  const { dir, cleanup } = workDir();
  try {
    const store = newStore(dir);
    const protectedData = bytes(20 * 1024, 7);
    const expiredData = bytes(20 * 1024, 9);
    store.putSnapshot({ domain: DOMAIN, snapshotId: "protected", buffer: protectedData, protected: true });
    store.putSnapshot({ domain: DOMAIN, snapshotId: "expired", buffer: expiredData, retentionUntil: "2000-01-01T00:00:00.000Z" });

    const denied = store.prune({ domain: DOMAIN, owner: "gc", fencingToken: 1 });
    assert.equal(denied.pruned, false);
    assert.equal(denied.reason, "lease-not-held");

    const { lease } = store.acquireLease({ domain: DOMAIN, owner: "gc" });
    const wrongOwner = store.prune({ domain: DOMAIN, owner: "someone-else", fencingToken: lease.fencingToken });
    assert.equal(wrongOwner.pruned, false);

    const pruned = store.prune({ domain: DOMAIN, owner: "gc", fencingToken: lease.fencingToken });
    assert.equal(pruned.pruned, true);
    assert.deepEqual(pruned.expiredSnapshots, ["expired"]);
    assert.deepEqual(store.readSnapshot({ domain: DOMAIN, snapshotId: "protected" }), protectedData);
    assert.equal(store.info({ domain: DOMAIN, snapshotId: "expired" }), null);
  } finally {
    cleanup();
  }
});

test("prune afviser en udløbet eller fremmed lease", () => {
  const { dir, cleanup } = workDir();
  try {
    const store = newStore(dir);
    const first = store.acquireLease({ domain: DOMAIN, owner: "gc-1", leaseMs: 1000, now: 0 });
    assert.equal(first.acquired, true);
    const second = store.acquireLease({ domain: DOMAIN, owner: "gc-2", leaseMs: 1000, now: 500 });
    assert.equal(second.acquired, false, "en aktiv lease må ikke overtages");
    const takeover = store.acquireLease({ domain: DOMAIN, owner: "gc-2", leaseMs: 1000, now: 2000 });
    assert.equal(takeover.acquired, true);
    assert.ok(takeover.lease.fencingToken > first.lease.fencingToken, "fencing-token skal hæves ved overtagelse");
    const stale = store.prune({ domain: DOMAIN, owner: "gc-1", fencingToken: first.lease.fencingToken, now: 2000 });
    assert.equal(stale.pruned, false, "et gammelt fencing-token må ikke bruges");
  } finally {
    cleanup();
  }
});

test("en korrupt chunk opdages og de berørte snapshots vises", () => {
  const { dir, cleanup } = workDir();
  try {
    const store = newStore(dir);
    const data = bytes(30 * 1024, 11);
    store.putSnapshot({ domain: DOMAIN, snapshotId: "snap-a", buffer: data });
    store.putSnapshot({ domain: DOMAIN, snapshotId: "snap-b", buffer: data });
    const domain = normalizeDedupDomain(DOMAIN);
    const chunkId = store.info({ domain: DOMAIN, snapshotId: "snap-a" }).chunkIds[0];
    writeFileSync(store.chunkPath(domain, chunkId), Buffer.from("korrupt"));

    const scrub = store.scrub({ domain: DOMAIN });
    assert.equal(scrub.ok, false);
    assert.ok(scrub.corruptions.some((c) => c.chunkId === chunkId));
    assert.deepEqual(scrub.affectedSnapshots, ["snap-a", "snap-b"]);
    assert.throws(() => store.readSnapshot({ domain: DOMAIN, snapshotId: "snap-a" }));
  } finally {
    cleanup();
  }
});

test("et crash efter chunks men før indeks genoprettes fra journalen", () => {
  const { dir, cleanup } = workDir();
  try {
    const crashing = newStore(dir, { failpoint: (step, ctx) => { if (step === "before-index-write" && ctx.snapshotId === "crashed-put") throw new Error("crash"); } });
    const data = bytes(40 * 1024, 13);
    // Første snapshot committer normalt, så domænet har et indeks.
    crashing.putSnapshot({ domain: DOMAIN, snapshotId: "base", buffer: bytes(4 * 1024, 2) });
    assert.throws(() => crashing.putSnapshot({ domain: DOMAIN, snapshotId: "crashed-put", buffer: data }), /crash/);

    const recovered = newStore(dir).recover();
    assert.equal(recovered.recovered >= 1, true);
    const store = newStore(dir);
    assert.deepEqual(store.readSnapshot({ domain: DOMAIN, snapshotId: "crashed-put" }), data);
  } finally {
    cleanup();
  }
});

test("et crash før chunks færdigskrives efterlader en konsistent tilstand", () => {
  const { dir, cleanup } = workDir();
  try {
    const crashing = newStore(dir, { failpoint: (step, ctx) => { if (step === "after-journal" && ctx.snapshotId === "partial") throw new Error("crash"); } });
    crashing.putSnapshot({ domain: DOMAIN, snapshotId: "base", buffer: bytes(4 * 1024, 4) });
    assert.throws(() => crashing.putSnapshot({ domain: DOMAIN, snapshotId: "partial", buffer: bytes(40 * 1024, 6) }), /crash/);

    const recovered = newStore(dir).recover();
    assert.equal(recovered.droppedSnapshots, 1, "et delvist put må ikke committes");
    const store = newStore(dir);
    assert.equal(store.info({ domain: DOMAIN, snapshotId: "partial" }), null);
    assert.deepEqual(store.scrub({ domain: DOMAIN }).corruptions, []);
  } finally {
    cleanup();
  }
});

test("et crash midt i en prune efterlader en genoprettelig tilstand", () => {
  const { dir, cleanup } = workDir();
  try {
    const store = newStore(dir);
    store.putSnapshot({ domain: DOMAIN, snapshotId: "expired", buffer: bytes(30 * 1024, 8), retentionUntil: "2000-01-01T00:00:00.000Z" });
    const { lease } = store.acquireLease({ domain: DOMAIN, owner: "gc" });
    const crashing = newStore(dir, { failpoint: (step) => { if (step === "before-chunk-delete") throw new Error("crash"); } });
    assert.throws(() => crashing.prune({ domain: DOMAIN, owner: "gc", fencingToken: lease.fencingToken }), /crash/);

    const recovered = newStore(dir).recover();
    assert.equal(recovered.recovered >= 1, true);
    assert.equal(newStore(dir).measure({ domain: DOMAIN }).physicalBytes, 0, "de refererede chunks skal være ryddet");
  } finally {
    cleanup();
  }
});

test("fysiske bytes tælles kun én gang pr. unik chunk", () => {
  const { dir, cleanup } = workDir();
  try {
    const store = newStore(dir);
    const data = bytes(100 * 1024, 17);
    store.putSnapshot({ domain: DOMAIN, snapshotId: "one", buffer: data });
    const single = store.measure({ domain: DOMAIN });
    store.putSnapshot({ domain: DOMAIN, snapshotId: "two", buffer: data });
    store.putSnapshot({ domain: DOMAIN, snapshotId: "three", buffer: data });
    const triple = store.measure({ domain: DOMAIN });
    assert.equal(triple.logicalBytes, single.logicalBytes * 3);
    assert.equal(triple.snapshots, 3);
    assert.ok(triple.physicalBytes > 0);
    assert.ok(triple.physicalBytes <= single.physicalBytes + 2100, "fysiske bytes vokser ikke med tre identiske snapshots");
    assert.ok(readdirSync(join(dir, "chunks")).length >= 1);
  } finally {
    cleanup();
  }
});
