/**
 * DKC-041 — deterministisk holdbarhedsøvelse for fil- og objektlageret.
 *
 * Øvelsen kører over et rigtigt (midlertidigt) filsystem og bekræfter de fem
 * acceptkrav: workload-flytning giver samme filer og rettigheder, host-/diskfejl
 * og silent corruption opdages og repareres, tab af quorum tillader ikke usikre
 * writes, tab af cache ændrer ikke autoritative data, og repair/rebalance under
 * belastning bevarer de vedtagne SLOer. Resultatet bærer `measured: false`; en
 * målt fejlmodel kræver et levende CSI-/objektlager (NOT RUN).
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStorageCluster } from "./object-store.mjs";
import { createTenantKeyRing, deriveTestKeyRing } from "./tenant-keys.mjs";
import { createEphemeralCache } from "./cache.mjs";
import { createRebuildableIndex } from "./index.mjs";

function tempRoot(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

function corruptOneBlob(cluster, rootDir, hostId, tenantId, key) {
  const keyHash = createHash("sha256").update(key).digest("hex");
  const metaPath = join(rootDir, hostId, "meta", tenantId, `${keyHash}.json`);
  const manifest = JSON.parse(readFileSync(metaPath, "utf8"));
  const entry = manifest.versions.find((v) => v.version === manifest.latest);
  const blobPath = join(rootDir, hostId, "blobs", entry.blob);
  const bytes = readFileSync(blobPath);
  bytes[Math.floor(bytes.length / 2)] ^= 0xff;
  writeFileSync(blobPath, bytes);
  return { key, version: entry.version };
}

/**
 * Kør en deterministisk lager-holdbarhedsøvelse.
 *
 * @param {object} plan
 * @param {object} [options]
 * @param {string} [options.tenantId]
 * @param {number} [options.now]
 */
export function runStorageDrill(plan, { tenantId = "acme", now = Date.now(), rootDir = null } = {}) {
  const root = rootDir ?? tempRoot("dkc-041-drill-");
  const keyRing = createTenantKeyRing(deriveTestKeyRing());
  const cluster = createStorageCluster({ plan, rootDir: root, keyRing, clock: () => now });
  const checks = {};

  // 1) Autoritative objekter for to tenants.
  const files = [
    { key: "docs/contract.pdf", body: Buffer.from("kontrakt-1"), mode: 0o640 },
    { key: "exports/data.csv", body: Buffer.from("a,b,c\n1,2,3\n"), mode: 0o600 },
    { key: "audit/log.bin", body: Buffer.from([0, 1, 2, 3, 4, 255]), mode: 0o640 },
  ];
  for (const file of files) {
    const result = cluster.put(tenantId, file.key, file.body, { classification: "authoritative", mode: file.mode, now });
    if (!result.committed) throw new Error(`write af '${file.key}' blev ikke bekræftet: ${result.reason}`);
  }
  cluster.put("globex", "docs/contract.pdf", Buffer.from("globex-hemmelig"), { classification: "authoritative", mode: 0o600, now });

  // 2) Workload-flytning til en anden server.
  const relocation = cluster.relocateWorkload({ fromHostId: "storage-1", toHostId: "storage-2", tenantId, now });
  checks.relocationSameFiles = relocation.sameFiles && relocation.files === files.length;

  // 3) Tenantisolering: globex' data er ikke synlig for acme.
  const acmeKeys = cluster.list(tenantId).map((k) => k.key);
  const globexKeys = cluster.list("globex").map((k) => k.key);
  checks.tenantIsolation = acmeKeys.includes("docs/contract.pdf") && globexKeys.length === 1 && !acmeKeys.includes("globex-hemmelig") && cluster.get("globex", "docs/contract.pdf").buffer.toString() === "globex-hemmelig";

  // 4) Silent corruption opdages af scrub og repareres fra en sund replika.
  const target = files[0];
  corruptOneBlob(cluster, root, "storage-3", tenantId, target.key);
  const corruptScan = cluster.scrub({ tenantId });
  const repair = cluster.repairAll({ now });
  const afterRepair = cluster.scrub({ tenantId });
  const restored = cluster.get(tenantId, target.key);
  checks.silentCorruptionDetected = corruptScan.corruptions.length === 1 && corruptScan.corruptions[0].host === "storage-3";
  checks.repairRestoresReplica = repair.repaired === 1 && afterRepair.ok && restored.buffer.equals(target.body);

  // 5) Tab af quorum tillader ikke usikre writes.
  cluster.partitionInto([["storage-1"]]);
  const blocked = cluster.put(tenantId, "exports/new.csv", Buffer.from("ny-data"), { classification: "authoritative", now });
  cluster.restoreReachability();
  let unchanged = true;
  try {
    cluster.get(tenantId, "exports/new.csv");
    unchanged = false;
  } catch {
    unchanged = true;
  }
  checks.quorumLossRejectsWrites = blocked.committed === false && blocked.reason === "quorum-loss" && unchanged;

  // 6) Tab af cache ændrer ikke autoritative data.
  const cacheDir = tempRoot("dkc-041-cache-");
  const cache = createEphemeralCache({ rootDir: cacheDir });
  cache.set(tenantId, "docs/contract.pdf", { cached: true });
  const beforeCacheDrop = cluster.get(tenantId, target.key).sha256;
  cache.drop();
  const index = createRebuildableIndex({ store: cluster, rootDir: tempRoot("dkc-041-index-") });
  const built = index.build(tenantId, { now });
  index.drop(tenantId);
  const rebuilt = index.build(tenantId, { now });
  const afterCacheDrop = cluster.get(tenantId, target.key).sha256;
  checks.cacheLossDoesNotChangeAuthoritative = beforeCacheDrop === afterCacheDrop && built.digest === rebuilt.digest && cache.get(tenantId, "docs/contract.pdf") === null;

  // 7) Repair/rebalance under belastning bevarer SLOerne.
  const loadStart = Date.now();
  let loadFailures = 0;
  for (let i = 0; i < 20; i += 1) {
    const result = cluster.put(tenantId, `load/obj-${i}.json`, Buffer.from(JSON.stringify({ i })), { classification: "object-store", now });
    if (!result.committed) loadFailures += 1;
  }
  const rebalance = cluster.rebalance({ now });
  const loadScan = cluster.scrub({ tenantId });
  const repairSeconds = Math.max(0, Math.round((Date.now() - loadStart) / 1000));
  checks.repairUnderLoadPreservesSlo = loadFailures === 0 && loadScan.ok && repairSeconds <= plan.slos.maxRepairSeconds && rebalance.ok;

  const capacityAfter = cluster.capacity();
  rmSync(cacheDir, { recursive: true, force: true });

  const result = {
    measured: false,
    evidenceKind: "simulation",
    requiresLiveMeasurement: true,
    provider: { csi: plan.provider?.csi?.name, objectStore: plan.provider?.objectStore?.name },
    tenantId,
    filesWritten: files.length + 1 + 20,
    quorum: { writeQuorum: plan.topology.writeQuorum, readQuorum: plan.topology.readQuorum, replicaFactor: plan.topology.replicaFactor },
    relocation,
    corruptionsDetected: corruptScan.corruptions.length,
    repaired: repair.repaired,
    rebalanced: rebalance.moved.length,
    checks,
    capacity: { alarms: capacityAfter.alarms.length, hosts: capacityAfter.hosts },
    ok: Object.values(checks).every(Boolean),
  };

  if (!rootDir) rmSync(root, { recursive: true, force: true });
  return result;
}
