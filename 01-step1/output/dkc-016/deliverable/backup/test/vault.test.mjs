import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileKeyProvider, createMemoryKeyProvider, KeyAccessError } from "../src/keys.mjs";
import { createSuppressionLedger } from "../src/suppression.mjs";
import { BackupIntegrityError, computeManifestDigest, createBackup, readBackup } from "../src/vault.mjs";
import { validateBackupManifest } from "../../conformance/src/backup.mjs";
import { createFixture } from "./support/fixtures.mjs";

function workDir() {
  const dir = mkdtempSync(join(tmpdir(), "dkc-vault-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("en krypteret backup kan læses og validerer mod kontrakten", async () => {
  const fixture = createFixture();
  const { dir, cleanup } = workDir();
  try {
    const ledger = createSuppressionLedger({ path: join(dir, "suppression.ndjson") });
    const keyProvider = createMemoryKeyProvider();
    const config = { endpoint: "https://example.org", database: { password: "hunter2" } };
    const objects = [{ name: "reports/q3.json", bytes: Buffer.from(JSON.stringify({ ok: true })) }];
    const { manifest, storeDir } = await createBackup({ db: fixture.db, tenantId: "acme", outDir: join(dir, "backup"), keyProvider, suppressionLedger: ledger, config, objectFiles: objects });

    const validation = validateBackupManifest(manifest);
    assert.equal(validation.ok, true, JSON.stringify(validation.errors));
    assert.equal(manifest.components.some((c) => c.kind === "database"), true);
    assert.equal(manifest.components.some((c) => c.kind === "objects"), true);
    assert.equal(manifest.encryption.storeContainsKey, false);

    // Klartekst-lageret må ikke indeholde nøglen.
    const manifestText = readFileSync(join(storeDir, "manifest.json"), "utf8");
    assert.equal(manifestText.includes(keyProvider.getKey()), false);

    const components = readBackup({ storeDir, manifest, keyProvider });
    assert.equal(components.database.kind, "database");
    // Konfigurationen er redigeret før kryptering.
    const restoredConfig = JSON.parse(components.config.buffer.toString("utf8"));
    assert.equal(restoredConfig.database.password, "[REDACTED]");
    assert.equal(restoredConfig.endpoint, "https://example.org");
    assert.equal(components["reports/q3.json"].buffer.toString("utf8"), JSON.stringify({ ok: true }));
  } finally {
    fixture.cleanup();
    cleanup();
  }
});

test("en ændret manifestdigest afvises", async () => {
  const fixture = createFixture();
  const { dir, cleanup } = workDir();
  try {
    const ledger = createSuppressionLedger({ path: join(dir, "suppression.ndjson") });
    const keyProvider = createMemoryKeyProvider();
    const { manifest } = await createBackup({ db: fixture.db, tenantId: "acme", outDir: join(dir, "backup"), keyProvider, suppressionLedger: ledger });
    const tampered = JSON.parse(JSON.stringify(manifest));
    tampered.components[0].sha256 = "f".repeat(64);
    assert.notEqual(computeManifestDigest(tampered), tampered.checksums.manifestDigest);
    assert.throws(() => readBackup({ storeDir: join(dir, "backup"), manifest: tampered, keyProvider }), /manifestdigesten/);
  } finally {
    fixture.cleanup();
    cleanup();
  }
});

test("ændret chiffertekst og manglende nøgle afvises", async () => {
  const fixture = createFixture();
  const { dir, cleanup } = workDir();
  try {
    const ledger = createSuppressionLedger({ path: join(dir, "suppression.ndjson") });
    const keyProvider = createMemoryKeyProvider();
    const { manifest, storeDir } = await createBackup({ db: fixture.db, tenantId: "acme", outDir: join(dir, "backup"), keyProvider, suppressionLedger: ledger });
    const dbComponent = manifest.components.find((c) => c.kind === "database");
    const file = join(storeDir, dbComponent.uri);
    const bytes = readFileSync(file);
    bytes[0] = bytes[0] ^ 0xff;
    writeFileSync(file, bytes);
    assert.throws(() => readBackup({ storeDir, manifest, keyProvider }), BackupIntegrityError);

    // En separat nøgleprovider uden nøglen må ikke kunne læse backupen.
    const emptyKeyDir = join(dir, "keys");
    const missing = createFileKeyProvider({ keyDir: emptyKeyDir });
    assert.throws(() => missing.getKey(), KeyAccessError);
  } finally {
    fixture.cleanup();
    cleanup();
  }
});
