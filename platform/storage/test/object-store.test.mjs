import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStorageCluster, sha256Hex } from "../src/object-store.mjs";
import { createTenantKeyRing, deriveTestKeyRing } from "../src/tenant-keys.mjs";
import { loadStoragePlan, capacityStatus } from "../src/plan.mjs";
import { repoRoot } from "../../conformance/src/schemas.mjs";

const plan = loadStoragePlan(repoRoot);

function tempCluster() {
  const root = mkdtempSync(join(tmpdir(), "dkc-041-store-"));
  const cluster = createStorageCluster({ plan, rootDir: root, keyRing: createTenantKeyRing(deriveTestKeyRing()) });
  return { root, cluster, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function corruptBlob(root, hostId, tenantId, key) {
  const keyHash = createHash("sha256").update(key).digest("hex");
  const metaPath = join(root, hostId, "meta", tenantId, `${keyHash}.json`);
  const manifest = JSON.parse(readFileSync(metaPath, "utf8"));
  const entry = manifest.versions.find((v) => v.version === manifest.latest);
  const blobPath = join(root, hostId, "blobs", entry.blob);
  const bytes = readFileSync(blobPath);
  bytes[0] ^= 0xff;
  writeFileSync(blobPath, bytes);
}

test("skriver og læser en version med checksum og rettigheder", () => {
  const { cluster, cleanup } = tempCluster();
  try {
    const body = Buffer.from("autoritativ kundedata");
    const result = cluster.put("acme", "docs/a.txt", body, { classification: "authoritative", mode: 0o600 });
    assert.equal(result.committed, true);
    assert.equal(result.version, 1);
    assert.equal(result.replicas.length, 3);
    const read = cluster.get("acme", "docs/a.txt");
    assert.equal(read.buffer.toString(), body.toString());
    assert.equal(read.sha256, sha256Hex(body));
    assert.equal(read.mode, 0o600);
  } finally {
    cleanup();
  }
});

test("versionsstyrer objekter og bevarer tidligere versioner", () => {
  const { cluster, cleanup } = tempCluster();
  try {
    cluster.put("acme", "docs/a.txt", Buffer.from("v1"), { classification: "authoritative" });
    cluster.put("acme", "docs/a.txt", Buffer.from("v2"), { classification: "authoritative" });
    assert.equal(cluster.get("acme", "docs/a.txt").version, 2);
    assert.equal(cluster.get("acme", "docs/a.txt", { version: 1 }).buffer.toString(), "v1");
  } finally {
    cleanup();
  }
});

test("tenantafgrænsede nøgler: en tenant kan ikke læse en anden tenants data", () => {
  const { cluster, cleanup } = tempCluster();
  try {
    cluster.put("acme", "docs/a.txt", Buffer.from("acme-hemmelig"), { classification: "authoritative" });
    cluster.put("globex", "docs/a.txt", Buffer.from("globex-hemmelig"), { classification: "authoritative" });
    assert.equal(cluster.get("acme", "docs/a.txt").buffer.toString(), "acme-hemmelig");
    assert.equal(cluster.get("globex", "docs/a.txt").buffer.toString(), "globex-hemmelig");
    assert.deepEqual(cluster.list("acme").map((e) => e.key), ["docs/a.txt"]);
  } finally {
    cleanup();
  }
});

test("tab af quorum afviser writen og efterlader ingen delvis tilstand", () => {
  const { cluster, cleanup } = tempCluster();
  try {
    cluster.put("acme", "docs/a.txt", Buffer.from("v1"), { classification: "authoritative" });
    cluster.partitionInto([["storage-1"]]);
    const blocked = cluster.put("acme", "docs/a.txt", Buffer.from("v2"), { classification: "authoritative" });
    assert.equal(blocked.committed, false);
    assert.equal(blocked.reason, "quorum-loss");
    cluster.restoreReachability();
    // Den forrige version er stadig den gældende; der er ingen halvskrevet v2.
    assert.equal(cluster.get("acme", "docs/a.txt").version, 1);
    assert.equal(cluster.get("acme", "docs/a.txt").buffer.toString(), "v1");
  } finally {
    cleanup();
  }
});

test("scrub opdager silent corruption og repair genskaber replikaen", () => {
  const { root, cluster, cleanup } = tempCluster();
  try {
    cluster.put("acme", "docs/a.txt", Buffer.from("autoritativ"), { classification: "authoritative" });
    corruptBlob(root, "storage-3", "acme", "docs/a.txt");
    const scan = cluster.scrub({ tenantId: "acme" });
    assert.equal(scan.ok, false);
    assert.equal(scan.corruptions.length, 1);
    assert.equal(scan.corruptions[0].host, "storage-3");
    const repaired = cluster.repairAll();
    assert.equal(repaired.repaired, 1);
    assert.equal(repaired.ok, true);
    assert.equal(cluster.get("acme", "docs/a.txt").buffer.toString(), "autoritativ");
  } finally {
    cleanup();
  }
});

test("get falder tilbage til en sund replika når én er korrupt", () => {
  const { root, cluster, cleanup } = tempCluster();
  try {
    cluster.put("acme", "docs/a.txt", Buffer.from("autoritativ"), { classification: "authoritative" });
    corruptBlob(root, "storage-1", "acme", "docs/a.txt");
    const read = cluster.get("acme", "docs/a.txt");
    assert.equal(read.buffer.toString(), "autoritativ");
    assert.notEqual(read.host, "storage-1");
  } finally {
    cleanup();
  }
});

test("relokation til en anden host giver samme filer, checksums og rettigheder", () => {
  const { cluster, cleanup } = tempCluster();
  try {
    cluster.put("acme", "docs/a.txt", Buffer.from("data"), { classification: "authoritative", mode: 0o640 });
    const relocation = cluster.relocateWorkload({ fromHostId: "storage-1", toHostId: "storage-2", tenantId: "acme" });
    assert.equal(relocation.sameFiles, true);
    assert.deepEqual(relocation.mismatches, []);
    assert.equal(relocation.files, 1);
  } finally {
    cleanup();
  }
});

test("rebalance genskaber manglende replikaer indtil replikafaktoren er nået", () => {
  const { root, cluster, cleanup } = tempCluster();
  try {
    cluster.put("acme", "docs/a.txt", Buffer.from("data"), { classification: "authoritative" });
    // Fjern en hel replika manuelt.
    rmSync(join(root, "storage-2", "meta", "acme"), { recursive: true, force: true });
    rmSync(join(root, "storage-2", "blobs"), { recursive: true, force: true });
    assert.equal(existsSync(join(root, "storage-2", "meta", "acme")), false);
    cluster.rebalance();
    assert.equal(existsSync(join(root, "storage-2", "meta", "acme")), true);
    const scanAfter = cluster.scrub({ tenantId: "acme" });
    assert.equal(scanAfter.ok, true);
  } finally {
    cleanup();
  }
});

test("kapacitetsstatus udløser alarm og hard-stop under tærsklerne", () => {
  const status = capacityStatus(plan, { "storage-1": 0, "storage-2": plan.capacity.perHostCapacityBytes * 0.9, "storage-3": plan.capacity.perHostCapacityBytes * 0.98 });
  assert.equal(status.ok, false);
  assert.ok(status.alarms.some((a) => a.host === "storage-3" && a.level === "hard-stop"));
  assert.ok(status.alarms.some((a) => a.host === "storage-2" && a.level === "alarm"));
  assert.ok(status.hosts["storage-1"].level === "ok");
});

test("capacity() rapporterer faktisk brug pr. host", () => {
  const { cluster, cleanup } = tempCluster();
  try {
    cluster.put("acme", "docs/a.txt", Buffer.from("1234567890"), { classification: "authoritative" });
    const capacity = cluster.capacity();
    assert.ok(capacity.usedBytesByHost["storage-1"] >= 10);
    assert.equal(capacity.ok, true);
  } finally {
    cleanup();
  }
});
