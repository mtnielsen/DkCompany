import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFilesystemBackend } from "../src/backends/filesystem.mjs";
import {
  canaryTarget,
  fetchBackupFromTarget,
  preflightTarget,
  resolveCredentials,
  syncBackupToTarget,
  targetNeedsCredentials,
} from "../src/targets.mjs";
import { createBackup } from "../src/vault.mjs";
import { functionalChecks, restoreBackup } from "../src/restore.mjs";
import { createMemoryKeyProvider } from "../src/keys.mjs";
import { createSuppressionLedger } from "../src/suppression.mjs";
import { createMockS3 } from "./support/mock-s3.mjs";
import { createFixture } from "./support/fixtures.mjs";

function tmp() {
  const dir = mkdtempSync(join(tmpdir(), "dkc-targets-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function localTarget(localRoot) {
  return {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "BackupTarget",
    metadata: { name: "local-filesystem", version: "1.0.0" },
    environment: "staging",
    targetType: "nas",
    endpoint: { url: `file://${localRoot}`, region: "on-prem", bucket: "backups" },
    credentialsRef: "env:LOCAL",
    tls: { verify: true, minVersion: "1.3" },
    retention: { days: 90, immutability: { required: false, mode: "none", verified: false } },
  };
}

test("credentials opløses fra JSON og accessKeyId:secret", async () => {
  const resolver = async (ref) => ({ "vault:a": '{"accessKeyId":"AK","secretAccessKey":"SK"}', "vault:b": "AK2:SK2", "vault:c": "" }[ref]);
  assert.deepEqual(await resolveCredentials({ credentialsRef: "vault:a", secretResolver: resolver }), { accessKeyId: "AK", secretAccessKey: "SK" });
  assert.deepEqual(await resolveCredentials({ credentialsRef: "vault:b", secretResolver: resolver }), { accessKeyId: "AK2", secretAccessKey: "SK2" });
  await assert.rejects(() => resolveCredentials({ credentialsRef: "vault:c", secretResolver: resolver }), (err) => err.code === "credentials_error");
});

test("preflight mod et lokalt filsystem-mål er read-only og grønt", async () => {
  const { dir, cleanup } = tmp();
  try {
    const report = await preflightTarget({ target: localTarget(dir), localRoot: dir });
    assert.equal(report.ok, true, JSON.stringify(report.errors));
    assert.ok(report.checks.some((c) => c.name === "bucket" && c.status === "pass"));
    assert.equal(targetNeedsCredentials(localTarget(dir)), false);
  } finally {
    cleanup();
  }
});

test("preflight viser credential-fejl før godkendelse for et objektlager", async () => {
  const target = {
    metadata: { name: "offsite" },
    environment: "staging",
    targetType: "object-store",
    endpoint: { url: "https://s3.example.org", region: "eu-west-1", bucket: "b" },
    credentialsRef: "vault:secret/data/backup#access",
    tls: { verify: true, minVersion: "1.3" },
    retention: { days: 90, immutability: { required: false, mode: "none", verified: false } },
  };
  const report = await preflightTarget({ target, secretResolver: async () => { throw new Error("ikke konfigureret"); } });
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => e.code === "credentials_error"));
  assert.ok(report.checks.some((c) => c.name === "credentials" && c.status === "fail"));
});

test("preflight afviser et WORM-krav når object-lock ikke er verificeret", async () => {
  const server = await createMockS3({ objectLock: false });
  try {
    const target = {
      metadata: { name: "offsite" },
      environment: "staging",
      targetType: "object-store",
      endpoint: { url: server.url, region: "eu-west-1", bucket: server.bucket },
      credentialsRef: "vault:secret/data/backup#access",
      tls: { verify: false, minVersion: "1.2" },
      retention: { days: 365, immutability: { required: true, mode: "object-lock-compliance", verified: true, evidenceRef: "x" } },
    };
    const report = await preflightTarget({ target, secretResolver: async () => '{"accessKeyId":"TESTKEY","secretAccessKey":"TESTSECRET"}' });
    assert.equal(report.ok, false);
    assert.ok(report.errors.some((e) => e.code === "retention_error"));
    assert.ok(report.checks.some((c) => c.name === "retention" && c.status === "fail"));
  } finally {
    await server.close();
  }
});

test("canary skriver, læser og sletter mod et lokalt mål", async () => {
  const { dir, cleanup } = tmp();
  try {
    const report = await canaryTarget({ target: localTarget(dir), localRoot: dir });
    assert.equal(report.ok, true, JSON.stringify(report.errors));
    assert.equal(report.cleanup, "deleted");
    assert.ok(report.checks.some((c) => c.name === "canary-read" && c.status === "pass"));
  } finally {
    cleanup();
  }
});

test("canary mod et immutable mål bevarer objektet (object-lock)", async () => {
  const server = await createMockS3({ objectLock: true });
  try {
    const target = {
      metadata: { name: "offsite" },
      environment: "staging",
      targetType: "object-store",
      endpoint: { url: server.url, region: "eu-west-1", bucket: server.bucket },
      credentialsRef: "vault:secret/data/backup#access",
      tls: { verify: false, minVersion: "1.2" },
      retention: { days: 365, immutability: { required: true, mode: "object-lock-compliance", verified: true } },
    };
    const report = await canaryTarget({ target, secretResolver: async () => '{"accessKeyId":"TESTKEY","secretAccessKey":"TESTSECRET"}' });
    assert.equal(report.ok, true, JSON.stringify(report.errors));
    assert.equal(report.cleanup, "retained-by-object-lock");
  } finally {
    await server.close();
  }
});

test("synkronisering frem og tilbage er konsistent", async () => {
  const { dir, cleanup } = tmp();
  try {
    const storeDir = join(dir, "store");
    mkdirSync(join(storeDir, "components"), { recursive: true });
    writeFileSync(join(storeDir, "manifest.json"), JSON.stringify({ tenantId: "acme", backupId: "b1" }));
    writeFileSync(join(storeDir, "components", "database.enc"), Buffer.from("krypteret"));
    const targetRoot = join(dir, "target");
    const backend = createFilesystemBackend({ rootDir: targetRoot });
    const target = localTarget(targetRoot);
    const uploaded = await syncBackupToTarget({ storeDir, target, backend });
    assert.equal(uploaded.uploaded.length, 2);

    const destDir = join(dir, "fetched");
    const fetched = await fetchBackupFromTarget({ target, backend, tenantId: "acme", backupId: "b1", destDir });
    assert.equal(fetched.files, 2);
    assert.equal(readFileSync(join(destDir, "manifest.json"), "utf8"), readFileSync(join(storeDir, "manifest.json"), "utf8"));
    assert.equal(readFileSync(join(destDir, "components", "database.enc"), "utf8"), "krypteret");
  } finally {
    cleanup();
  }
});

test("backup kan gendannes fra det eksterne mål uden den lokale beholder", async () => {
  const fixture = createFixture();
  const { dir, cleanup } = tmp();
  try {
    const ledger = createSuppressionLedger({ path: join(dir, "suppression.ndjson") });
    const keyProvider = createMemoryKeyProvider();
    const { storeDir, manifest } = await createBackup({ db: fixture.db, tenantId: "acme", outDir: join(dir, "store"), keyProvider, suppressionLedger: ledger });
    const targetRoot = join(dir, "target");
    const backend = createFilesystemBackend({ rootDir: targetRoot });
    await syncBackupToTarget({ storeDir, target: localTarget(targetRoot), backend });

    // Simulér at primærmiljøet (den lokale beholder) er væk.
    rmSync(storeDir, { recursive: true, force: true });

    const fetchedDir = join(dir, "fetched");
    const fetched = await fetchBackupFromTarget({ target: localTarget(targetRoot), backend, tenantId: "acme", backupId: manifest.backupId, destDir: fetchedDir });
    assert.ok(fetched.files >= 2);
    const restored = restoreBackup({ storeDir: fetchedDir, manifest, keyProvider, targetDir: join(dir, "restored"), suppressionLedger: ledger });
    assert.equal(restored.integrity, "ok");
    const checks = functionalChecks({ dbPath: restored.dbPath, checkpoint: { anchorDir: fixture.anchorDir, secret: "anchor-secret", tenantId: "acme" } });
    for (const check of checks) assert.equal(check.status, "pass", `${check.name}: ${check.detail}`);
  } finally {
    fixture.cleanup();
    cleanup();
  }
});
