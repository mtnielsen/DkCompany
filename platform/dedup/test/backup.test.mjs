import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryKeyProvider } from "../../backup/src/keys.mjs";
import { createSuppressionLedger } from "../../backup/src/suppression.mjs";
import { createBackup, computeManifestDigest } from "../../backup/src/vault.mjs";
import { functionalChecks } from "../../backup/src/restore.mjs";
import { createFixture } from "../../backup/test/support/fixtures.mjs";
import { createDedupStore } from "../src/store.mjs";
import { normalizeDedupDomain } from "../src/store.mjs";
import { createDedupKeyRing, deriveTestKeyRing } from "../src/keys.mjs";
import { deduplicateBackup, restoreDedupedBackup, verifyDedupedRestore, snapshotIdFor } from "../src/backup.mjs";
import { evaluateSavingsGate, buildDedupReceipt } from "../src/measure.mjs";

const DOMAIN = { tenantId: "acme", encryptionDomain: "eu-primary", retentionClass: "financial-7y", category: "backup-blocks" };

function workDir() {
  const dir = mkdtempSync(join(tmpdir(), "dkc-dedup-backup-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function newStore(dir) {
  return createDedupStore({ rootDir: join(dir, "dedup"), keyRing: createDedupKeyRing(deriveTestKeyRing()) });
}

async function makeBackup(dir) {
  const fixture = createFixture();
  const ledger = createSuppressionLedger({ path: join(dir, "suppression.ndjson") });
  const keyProvider = createMemoryKeyProvider();
  const block = Buffer.from("DKC-043 backupblok gentages. ".repeat(300), "utf8");
  const objectFiles = [
    { name: "reports/q3.json", bytes: Buffer.concat([block, block]) },
    { name: "reports/q4.json", bytes: Buffer.concat([block, Buffer.from("kun q4", "utf8")]) },
  ];
  const { manifest, storeDir } = await createBackup({ db: fixture.db, tenantId: "acme", outDir: join(dir, "backup"), keyProvider, suppressionLedger: ledger, config: { endpoint: "https://example.org", database: { password: "hunter2" } }, objectFiles });
  return { fixture, keyProvider, manifest, storeDir };
}

test("en backup kan deduplikeres, måles og gendannes fuldt", async () => {
  const { dir, cleanup } = workDir();
  const { fixture, keyProvider, manifest, storeDir } = await makeBackup(dir);
  try {
    const store = newStore(dir);
    const deduped = deduplicateBackup({ storeDir, manifest, keyProvider, store, domain: DOMAIN, protectedSnapshot: true });
    assert.ok(deduped.componentCount >= 3, "database, config og objekter skal deduplikeres");
    assert.ok(deduped.logicalBytes > 0);

    const verification = verifyDedupedRestore({ store, manifest, domain: DOMAIN });
    assert.equal(verification.ok, true, JSON.stringify(verification.checks));
    assert.equal(verification.manifestDigestOk, true);
    assert.ok(verification.checks.every((check) => check.ok));

    const snapshotIds = manifest.components.map((component) => snapshotIdFor(manifest.backupId, component));
    const gate = evaluateSavingsGate({ store, domain: DOMAIN, snapshotIds });
    assert.equal(gate.integrity.ok, true);
    assert.equal(gate.restore.ok, true);
    assert.equal(gate.savingsActive, true);
    assert.ok(gate.measurement.physicalBytes < gate.measurement.logicalBytes, "dedup skal give en fysisk besparelse");

    const restored = restoreDedupedBackup({ store, manifest, domain: DOMAIN, targetDir: join(dir, "restore") });
    const checks = functionalChecks({ dbPath: restored.dbPath });
    assert.ok(checks.every((check) => check.status === "pass"), JSON.stringify(checks));

    const receipt = buildDedupReceipt({ receiptId: "receipt-1", backupId: manifest.backupId, domain: DOMAIN, store, snapshotIds });
    assert.equal(receipt.savingsActive, true);
    assert.equal(receipt.kind, "DedupReceipt");
    assert.ok(receipt.savedBytes > 0);
  } finally {
    fixture.cleanup();
    cleanup();
  }
});

test("en ændret backup-komponent opdages ved dedup-gendannelse", async () => {
  const { dir, cleanup } = workDir();
  const { fixture, keyProvider, manifest, storeDir } = await makeBackup(dir);
  try {
    const store = newStore(dir);
    deduplicateBackup({ storeDir, manifest, keyProvider, store, domain: DOMAIN });
    // Fjern en chunk-fil for at simulere et tab.
    const snapshotId = snapshotIdFor(manifest.backupId, manifest.components[0]);
    const info = store.info({ domain: DOMAIN, snapshotId });
    const normalized = normalizeDedupDomain(DOMAIN);
    const firstChunk = info.chunkIds[0];
    rmSync(store.chunkPath(normalized, firstChunk), { force: true });
    const verification = verifyDedupedRestore({ store, manifest, domain: DOMAIN });
    assert.equal(verification.ok, false);
    assert.ok(verification.checks.some((check) => check.ok === false));
  } finally {
    fixture.cleanup();
    cleanup();
  }
});

test("en ændret manifestdigest afvises før gendannelse", async () => {
  const { dir, cleanup } = workDir();
  const { fixture, keyProvider, manifest, storeDir } = await makeBackup(dir);
  try {
    const store = newStore(dir);
    deduplicateBackup({ storeDir, manifest, keyProvider, store, domain: DOMAIN });
    const tampered = JSON.parse(JSON.stringify(manifest));
    tampered.components[0].sha256 = "f".repeat(64);
    assert.notEqual(computeManifestDigest(tampered), tampered.checksums.manifestDigest);
    const verification = verifyDedupedRestore({ store, manifest: tampered, domain: DOMAIN });
    assert.equal(verification.manifestDigestOk, false);
    assert.equal(verification.ok, false);
    assert.throws(() => restoreDedupedBackup({ store, manifest: tampered, domain: DOMAIN, targetDir: join(dir, "restore") }), /kunne ikke verificeres/);
  } finally {
    fixture.cleanup();
    cleanup();
  }
});
